const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');
const emailController = require('./emailSettings.controller');

// Allow admin, administrator, superadmin
const allowed = authorizeRoles('admin', 'administrator', 'superadmin');

// 1. GET /api/email-settings - Get current SMTP configuration
router.get('/', verifyToken, allowed, emailController.getSettings);

// 2. POST /api/email-settings - Save or update SMTP configuration (AES-256 encrypted)
router.post('/', verifyToken, allowed, emailController.saveSettings);

// 3. DELETE /api/email-settings & POST /api/email-settings/remove - Remove custom SMTP
router.delete('/', verifyToken, allowed, emailController.removeSettings);
router.post('/remove', verifyToken, allowed, emailController.removeSettings);

// 4. POST /api/email-settings/test - Test connection & live verification email
router.post('/test', verifyToken, allowed, emailController.testSettings);

module.exports = router;
