const cron = require('node-cron');
const prisma = require('../../config/prisma');
const backupService = require('./backup.service');
const { logActivity } = require('../../utils/activityLogger');

const SETTINGS_KEY = 'auto_backup_schedule_config';

// Default configuration: Every 7 days (Weekly on Sunday at 02:00 AM)
const DEFAULT_CONFIG = {
  enabled: true,
  frequency: 'EVERY_7_DAYS', // EVERY_7_DAYS | DAILY | BI_WEEKLY | MONTHLY
  cronExpression: '0 2 * * 0', // At 02:00 AM on Sunday
  executionTime: '02:00',
  dayOfWeek: 0, // 0 = Sunday
  backupType: 'DATABASE', // Full database snapshot (All tables)
  recipientEmails: [], // Empty means all registered Admin & Superadmin users
  lastRunAt: null,
  lastStatus: 'PENDING',
  lastMessage: 'Automated 7-day backup schedule initialized.',
  nextRunAt: null
};

let currentCronTask = null;

/**
 * Calculate the next run date based on frequency and time
 */
const calculateNextRun = (frequency = 'EVERY_7_DAYS', executionTime = '02:00', dayOfWeek = 0) => {
  const [hours, minutes] = executionTime.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);

  next.setHours(hours || 2, minutes || 0, 0, 0);

  if (frequency === 'DAILY') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'EVERY_7_DAYS') {
    // Target next occurrence of dayOfWeek (0 = Sunday)
    const currentDay = next.getDay();
    let daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
    if (daysUntilTarget === 0 && next <= now) {
      daysUntilTarget = 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (frequency === 'BI_WEEKLY') {
    next.setDate(next.getDate() + 14);
  } else if (frequency === 'MONTHLY') {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setDate(next.getDate() + 7);
  }

  return next.toISOString();
};

/**
 * Convert user settings to valid cron expression
 */
const getCronExpression = (frequency = 'EVERY_7_DAYS', executionTime = '02:00', dayOfWeek = 0) => {
  const [hours, minutes] = executionTime.split(':').map(Number);
  const m = isNaN(minutes) ? 0 : minutes;
  const h = isNaN(hours) ? 2 : hours;

  switch (frequency) {
    case 'DAILY':
      return `${m} ${h} * * *`;
    case 'EVERY_7_DAYS':
      return `${m} ${h} * * ${dayOfWeek % 7}`;
    case 'BI_WEEKLY':
      return `${m} ${h} 1,15 * *`;
    case 'MONTHLY':
      return `${m} ${h} 1 * *`;
    default:
      return `${m} ${h} * * 0`;
  }
};

/**
 * Get current persisted schedule configuration
 */
const getScheduleConfig = async () => {
  try {
    const record = await prisma.globalSettings.findFirst({
      where: { key: SETTINGS_KEY, tenant_id: null }
    });

    if (record?.value) {
      const parsed = JSON.parse(record.value);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        isSchedulerRunning: Boolean(currentCronTask)
      };
    }
  } catch (err) {
    console.warn('[Backup Scheduler] Failed to load settings from DB:', err.message);
  }

  return {
    ...DEFAULT_CONFIG,
    nextRunAt: calculateNextRun('EVERY_7_DAYS', '02:00', 0),
    isSchedulerRunning: Boolean(currentCronTask)
  };
};

/**
 * Persist schedule configuration
 */
const saveScheduleConfig = async (config) => {
  const value = JSON.stringify(config);
  const existing = await prisma.globalSettings.findFirst({
    where: { key: SETTINGS_KEY, tenant_id: null }
  });
  if (existing) {
    await prisma.globalSettings.update({
      where: { id: existing.id },
      data: { value }
    });
  } else {
    await prisma.globalSettings.create({
      data: { key: SETTINGS_KEY, value, tenant_id: null }
    });
  }
};

/**
 * Execute the automated backup job
 * - Dumps all tables & important software data
 * - Dispatches file via Nodemailer attachment to admin email(s)
 * - Updates status and nextRunAt
 */
const executeScheduledBackupJob = async (triggerSource = 'AUTOMATED_CRON') => {
  console.log(`⏰ [Backup Scheduler] Starting automated backup job (${triggerSource})...`);
  const config = await getScheduleConfig();

  if (!config.enabled && triggerSource === 'AUTOMATED_CRON') {
    console.log('[Backup Scheduler] Schedule is disabled. Skipping.');
    return;
  }

  const startTime = new Date();

  try {
    // 1. Identify recipient admin emails
    let targetEmails = [];
    if (Array.isArray(config.recipientEmails) && config.recipientEmails.length > 0) {
      targetEmails = config.recipientEmails.filter(e => e && e.includes('@'));
    }

    if (targetEmails.length === 0) {
      // Find all active admins & superadmins
      const adminUsers = await prisma.user.findMany({
        where: {
          role: { in: ['admin', 'superadmin'] }
        },
        select: { email: true, name: true, role: true }
      });

      targetEmails = adminUsers.map(u => u.email.trim().toLowerCase());
    }

    if (targetEmails.length === 0) {
      throw new Error('No registered Admin or Superadmin emails found to receive backup.');
    }

    // 2. Generate a fresh, comprehensive full database snapshot (ALL tables)
    console.log('[Backup Scheduler] Generating full database snapshot of all tables...');
    const snapshot = await backupService.generateDatabaseBackup({
      type: 'JSON',
      compress: true,
      filenamePrefix: 'weekly_autobackup'
    });

    console.log(`[Backup Scheduler] Snapshot generated: ${snapshot.fileName} (${snapshot.sizeFormatted})`);

    // 3. Dispatch backup snapshot email to all target admin emails
    const dispatchResults = [];
    for (const email of targetEmails) {
      try {
        const result = await backupService.sendBackupToEmail({
          email,
          fileName: snapshot.fileName,
          backupType: 'DATABASE'
        });
        dispatchResults.push({ email, success: true, message: result.message });
      } catch (sendErr) {
        console.error(`[Backup Scheduler] Failed to send backup to ${email}:`, sendErr.message);
        dispatchResults.push({ email, success: false, error: sendErr.message });
      }
    }

    const successCount = dispatchResults.filter(r => r.success).length;
    const summaryMsg = `Automatic weekly backup (${snapshot.sizeFormatted}) sent to ${successCount}/${targetEmails.length} Admin(s).`;

    // 4. Update schedule config record
    const nextRun = calculateNextRun(config.frequency, config.executionTime, config.dayOfWeek);
    const updatedConfig = {
      ...config,
      lastRunAt: startTime.toISOString(),
      lastStatus: successCount > 0 ? 'SUCCESS' : 'FAILED',
      lastMessage: summaryMsg,
      lastFileName: snapshot.fileName,
      lastFileSize: snapshot.sizeFormatted,
      nextRunAt: nextRun,
      dispatchResults
    };

    await saveScheduleConfig(updatedConfig);

    // 5. System Activity Audit Log
    try {
      const firstAdmin = await prisma.user.findFirst({
        where: { role: { in: ['admin', 'superadmin'] } }
      });

      if (firstAdmin) {
        await logActivity(
          firstAdmin.id,
          'UPDATE_SETTINGS',
          snapshot.fileName,
          'Backup',
          `Automated 7-day database backup generated and emailed: ${summaryMsg}`,
          {
            triggerSource,
            recipients: targetEmails,
            fileName: snapshot.fileName,
            sizeFormatted: snapshot.sizeFormatted,
            durationMs: Date.now() - startTime.getTime()
          },
          '127.0.0.1'
        );
      }
    } catch (logErr) {
      console.warn('[Backup Scheduler] Audit log warning:', logErr.message);
    }

    console.log(`✅ [Backup Scheduler] Completed: ${summaryMsg}`);
    return {
      success: true,
      message: summaryMsg,
      snapshot: {
        fileName: snapshot.fileName,
        sizeFormatted: snapshot.sizeFormatted
      },
      recipients: targetEmails,
      nextRunAt: nextRun
    };
  } catch (error) {
    console.error('❌ [Backup Scheduler] Execution failed:', error.message);

    const nextRun = calculateNextRun(config.frequency, config.executionTime, config.dayOfWeek);
    await saveScheduleConfig({
      ...config,
      lastRunAt: startTime.toISOString(),
      lastStatus: 'FAILED',
      lastMessage: `Automated backup failed: ${error.message}`,
      nextRunAt: nextRun
    }).catch(() => {});

    throw error;
  }
};

/**
 * Setup or reconfigure the node-cron background schedule
 */
const setupCronTask = (config) => {
  if (currentCronTask) {
    currentCronTask.stop();
    currentCronTask = null;
  }

  if (!config.enabled) {
    console.log('⏸️  [Backup Scheduler] Automatic backup is currently disabled.');
    return;
  }

  const cronExpr = getCronExpression(config.frequency, config.executionTime, config.dayOfWeek);
  console.log(`⏰ [Backup Scheduler] Registering cron task with expression: "${cronExpr}"`);

  if (!cron.validate(cronExpr)) {
    console.error(`❌ [Backup Scheduler] Invalid cron expression: "${cronExpr}". Falling back to weekly.`);
    return;
  }

  currentCronTask = cron.schedule(cronExpr, async () => {
    try {
      await executeScheduledBackupJob('AUTOMATED_CRON');
    } catch (err) {
      console.error('[Backup Scheduler] Scheduled cron execution error:', err.message);
    }
  });

  console.log(`✅ [Backup Scheduler] Active: Backup will run automatically every 7 days at ${config.executionTime}.`);
};

/**
 * Initialize the backup scheduler on server startup
 */
const initBackupScheduler = async () => {
  try {
    let config = await getScheduleConfig();

    if (!config.nextRunAt) {
      config.nextRunAt = calculateNextRun(config.frequency, config.executionTime, config.dayOfWeek);
      await saveScheduleConfig(config);
    }

    setupCronTask(config);
  } catch (err) {
    console.error('❌ [Backup Scheduler] Failed to initialize:', err.message);
  }
};

/**
 * Update schedule configuration from Admin UI
 */
const updateScheduleConfig = async (newConfigInput = {}) => {
  const current = await getScheduleConfig();

  const frequency = newConfigInput.frequency || current.frequency || 'EVERY_7_DAYS';
  const executionTime = newConfigInput.executionTime || current.executionTime || '02:00';
  const dayOfWeek = newConfigInput.dayOfWeek !== undefined ? parseInt(newConfigInput.dayOfWeek, 10) : current.dayOfWeek;
  const enabled = newConfigInput.enabled !== undefined ? Boolean(newConfigInput.enabled) : current.enabled;

  let recipientEmails = current.recipientEmails || [];
  if (newConfigInput.recipientEmails !== undefined) {
    if (Array.isArray(newConfigInput.recipientEmails)) {
      recipientEmails = newConfigInput.recipientEmails;
    } else if (typeof newConfigInput.recipientEmails === 'string') {
      recipientEmails = newConfigInput.recipientEmails
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@'));
    }
  }

  const cronExpression = getCronExpression(frequency, executionTime, dayOfWeek);
  const nextRunAt = calculateNextRun(frequency, executionTime, dayOfWeek);

  const updated = {
    ...current,
    enabled,
    frequency,
    executionTime,
    dayOfWeek,
    cronExpression,
    recipientEmails,
    nextRunAt
  };

  await saveScheduleConfig(updated);
  setupCronTask(updated);

  return {
    ...updated,
    isSchedulerRunning: Boolean(currentCronTask)
  };
};

module.exports = {
  SETTINGS_KEY,
  DEFAULT_CONFIG,
  getScheduleConfig,
  updateScheduleConfig,
  executeScheduledBackupJob,
  initBackupScheduler
};
