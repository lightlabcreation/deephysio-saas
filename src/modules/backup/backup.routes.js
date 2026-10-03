const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const backupController = require('./backup.controller');
const backupService = require('./backup.service');
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');

// Configure Multer Storage for Backups Repository
const backupStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, backupService.BACKUP_DIR),
  filename: (req, file, cb) => cb(null, path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_'))
});

const backupUpload = multer({
  storage: backupStorage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB max limit
});

router.use(verifyToken);
router.use(authorizeRoles('superadmin', 'admin'));

router.get('/', backupController.getBackups);
router.get('/live-stats', backupController.getLiveStats);
router.post('/trigger', backupController.triggerBackup);
router.post('/upload', backupUpload.single('backupFile'), backupController.uploadBackup);
router.get('/download/:fileName', backupController.downloadBackup);
router.get('/details/:fileName', backupController.getBackupDetails);
router.post('/restore', backupController.restoreBackup);
router.post('/send-email', backupController.sendBackupToEmail);
router.get('/schedule', backupController.getSchedule);
router.post('/schedule', backupController.updateSchedule);
router.post('/schedule/run-now', backupController.runScheduleNow);
router.delete('/:fileName', backupController.removeBackup);

module.exports = router;
