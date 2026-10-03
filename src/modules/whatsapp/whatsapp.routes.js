const express = require('express');
const router = express.Router();
const whatsappController = require('./whatsapp.controller');
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');

// All WhatsApp routes require active authentication
router.use(verifyToken);

// Connection configuration routes reserved for Admin / Superadmin
router.get('/qr', authorizeRoles('admin', 'superadmin'), whatsappController.getQr);
router.post('/connect', authorizeRoles('admin', 'superadmin'), whatsappController.connect);
router.post('/pairing-code', authorizeRoles('admin', 'superadmin'), whatsappController.getPairingCode);
router.post('/disconnect', authorizeRoles('admin', 'superadmin'), whatsappController.disconnect);
router.post('/reconnect', authorizeRoles('admin', 'superadmin'), whatsappController.reconnect);

// Operational routes (Status, Logs, Send Message, Groups) accessible to all clinic roles
router.get('/status', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.getStatus);
router.get('/logs', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.getLogs);
router.get('/groups', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.getGroups);
router.get('/profile-picture', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.getProfilePicture);
router.post('/test', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.sendTestMessage);
router.post('/send', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.sendTestMessage);
router.post('/ensure-session', authorizeRoles('admin', 'superadmin', 'therapist', 'receptionist', 'billing', 'staff', 'administrator'), whatsappController.ensureSession);

module.exports = router;
