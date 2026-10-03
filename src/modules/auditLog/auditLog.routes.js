const express = require('express');
const router = express.Router();
const auditLogController = require('./auditLog.controller');
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');

router.use(verifyToken);
router.use(authorizeRoles('superadmin', 'admin'));

router.get('/', auditLogController.getAuditLogs);
router.get('/stats', auditLogController.getAuditStats);
router.get('/tenants', auditLogController.getAuditTenants);
router.get('/export', auditLogController.exportAuditLogsCsv);

module.exports = router;
