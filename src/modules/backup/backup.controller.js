const fs = require('fs');
const path = require('path');
const backupService = require('./backup.service');
const { logActivity } = require('../../utils/activityLogger');

/**
 * GET /api/backup
 * List all available backups
 */
const getBackups = async (req, res) => {
  try {
    const tenantId = req.user?.role === 'superadmin' ? null : req.user?.tenant_id;
    const backups = await backupService.listBackups(tenantId);
    return res.status(200).json({
      success: true,
      count: backups.length,
      data: backups
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * GET /api/backup/live-stats
 * Live database counts and engine health
 */
const getLiveStats = async (req, res) => {
  try {
    const tenantId = req.user?.role === 'superadmin' ? null : req.user?.tenant_id;
    const stats = await backupService.getLiveDatabaseStats(tenantId);
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/trigger
 * Create a new backup (Database JSON/GZ, SQL Dump, or Uploads Zip)
 */
const triggerBackup = async (req, res) => {
  try {
    const { type = 'JSON', tenantId: requestedTenantId = null, compress = true, emailTo = null } = req.body;
    const isSuperAdmin = req.user?.role === 'superadmin';
    const effectiveTenantId = isSuperAdmin ? requestedTenantId : req.user?.tenant_id;

    let backup;
    if (type.toUpperCase() === 'UPLOADS' || type.toUpperCase() === 'ZIP') {
      backup = await backupService.generateUploadsBackup();
    } else {
      backup = await backupService.generateDatabaseBackup({
        tenantId: effectiveTenantId,
        type,
        compress: compress !== false
      });
    }

    let emailDispatch = null;
    if (emailTo && String(emailTo).includes('@')) {
      try {
        emailDispatch = await backupService.sendBackupToEmail({
          email: String(emailTo).trim(),
          fileName: backup.fileName,
          backupType: backup.type,
          tenantId: effectiveTenantId,
          user: req.user
        });
      } catch (eErr) {
        emailDispatch = { success: false, message: eErr.message };
      }
    }

    if (req.user?.id) {
      await logActivity(
        req.user.id,
        'UPDATE_SETTINGS',
        backup.fileName,
        'Backup',
        `Backup created: ${backup.fileName} (${backup.sizeFormatted})${emailTo ? ` and dispatched to ${emailTo}` : ''}`,
        { fileName: backup.fileName, size: backup.sizeFormatted, type: backup.type, emailTo, emailSuccess: emailDispatch?.success },
        req.ip,
        effectiveTenantId
      );
    }

    return res.status(201).json({
      success: true,
      data: backup,
      emailDispatch,
      message: emailDispatch
        ? `${backup.type} backup created. ${emailDispatch.message}`
        : `${backup.type} backup created successfully`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/upload
 * Upload backup file archive (.json.gz, .json, .zip, .sql) and optionally restore immediately
 */
const uploadBackup = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No backup file uploaded.' });
    }

    const { filename, size } = req.file;
    const restoreImmediately = req.body.restoreImmediately === 'true' || req.body.restoreImmediately === true;

    let restoreResult = null;
    if (restoreImmediately && (filename.endsWith('.json.gz') || filename.endsWith('.json') || filename.endsWith('.gz'))) {
      restoreResult = await backupService.restoreBackup(filename, req.user, req.body.targetTenantId || null);
    }

    if (req.user?.id) {
      await logActivity(
        req.user.id,
        'UPDATE_SETTINGS',
        filename,
        'Backup',
        `Backup file uploaded: ${filename} (${backupService.formatBytes(size)})${restoreImmediately ? ' and restored immediately' : ''}`,
        { filename, size, restored: !!restoreResult }
      );
    }

    return res.status(200).json({
      success: true,
      message: restoreResult
        ? (restoreResult.message || 'Backup uploaded and database restored successfully!')
        : 'Backup archive uploaded successfully.',
      filename,
      sizeBytes: size,
      sizeFormatted: backupService.formatBytes(size),
      restored: !!restoreResult,
      restoreResult
    });
  } catch (error) {
    console.error('[Upload Backup Controller Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/backup/download/:fileName
 * Download a backup archive securely
 */
const downloadBackup = async (req, res) => {
  try {
    const { fileName } = req.params;
    const filePath = backupService.getBackupFilePath(fileName);

    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileName)}"`);
    if (fileName.endsWith('.json.gz')) {
      res.setHeader('Content-Type', 'application/gzip');
    } else if (fileName.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    } else if (fileName.endsWith('.sql')) {
      res.setHeader('Content-Type', 'application/sql');
    } else if (fileName.endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }

    return res.download(filePath, path.basename(fileName));
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * GET /api/backup/details/:fileName
 * Inspect backup file contents and metadata
 */
const getBackupDetails = async (req, res) => {
  try {
    const { fileName } = req.params;
    const details = await backupService.getBackupDetails(fileName);
    return res.status(200).json({
      success: true,
      data: details
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/restore
 * Restore database from an existing backup file
 */
const restoreBackup = async (req, res) => {
  try {
    const { fileName, targetTenantId } = req.body;
    if (!fileName) {
      return res.status(400).json({ success: false, message: 'Backup fileName is required.' });
    }

    const tenantId = req.user?.role === 'superadmin' ? (targetTenantId || null) : req.user?.tenant_id;
    const result = await backupService.restoreBackup(fileName, req.user, tenantId);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * DELETE /api/backup/:fileName
 * Delete a backup file
 */
const removeBackup = async (req, res) => {
  try {
    const { fileName } = req.params;
    const result = await backupService.deleteBackup(fileName);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/send-email
 * Dispatch a backup snapshot to a verified admin email
 */
const sendBackupToEmail = async (req, res) => {
  try {
    const { email, backupType, fileName, targetTenantId } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Admin email address is required.' });
    }

    const isSuperAdmin = req.user?.role === 'superadmin';
    const effectiveTenantId = isSuperAdmin ? (targetTenantId || null) : req.user?.tenant_id;

    const result = await backupService.sendBackupToEmail({
      email,
      backupType,
      fileName,
      tenantId: effectiveTenantId,
      user: req.user
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[Send Backup Email Error]:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to dispatch backup to email.'
    });
  }
};

/**
 * GET /api/backup/schedule
 * Fetch current auto-backup schedule config & status
 */
const getSchedule = async (req, res) => {
  try {
    const backupScheduler = require('./backupScheduler.service');
    const config = await backupScheduler.getScheduleConfig();
    return res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/schedule
 * Update auto-backup schedule configuration
 */
const updateSchedule = async (req, res) => {
  try {
    const backupScheduler = require('./backupScheduler.service');
    const updated = await backupScheduler.updateScheduleConfig(req.body);
    return res.status(200).json({
      success: true,
      message: 'Automatic 7-day backup schedule updated successfully.',
      data: updated
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * POST /api/backup/schedule/run-now
 * Manually trigger the 7-day scheduled backup job right now
 */
const runScheduleNow = async (req, res) => {
  try {
    const backupScheduler = require('./backupScheduler.service');
    const result = await backupScheduler.executeScheduledBackupJob(`MANUAL_TRIGGER_BY_${req.user?.name || 'ADMIN'}`);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = {
  getBackups,
  getLiveStats,
  triggerBackup,
  uploadBackup,
  downloadBackup,
  removeBackup,
  getBackupDetails,
  restoreBackup,
  sendBackupToEmail,
  getSchedule,
  updateSchedule,
  runScheduleNow
};

