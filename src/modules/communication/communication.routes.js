const express = require('express');
const router = express.Router();
const controller = require('./communication.controller');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');
const {
  threadIdParamValidation,
  sendMessageValidation,
  createCampaignValidation,
  createTelehealthSessionValidation
} = require('./communication.validation');

const clinicRoles = ['admin', 'billing', 'therapist', 'receptionist', 'administrator', 'superadmin', 'doctor', 'staff'];

// Thread & Direct Message Endpoints
router.get('/threads', verifyToken, authorizeRoles(...clinicRoles), controller.listThreads);
router.post('/threads', verifyToken, authorizeRoles(...clinicRoles), controller.createThread);
router.get('/threads/:threadId/messages', verifyToken, authorizeRoles(...clinicRoles), controller.listMessages);
router.post(
  '/threads/:threadId/messages',
  verifyToken,
  authorizeRoles(...clinicRoles),
  (req, res, next) => {
    const { error } = threadIdParamValidation(req.params);
    if (error) return res.status(400).json({ success: false, message: 'Invalid thread ID' });
    next();
  },
  (req, res, next) => {
    const { error } = sendMessageValidation(req.body);
    if (error) {
      const message = error.details.map((d) => d.message).join(', ');
      return res.status(400).json({ success: false, message });
    }
    next();
  },
  controller.sendMessage
);

// High-Performance Email Hub Endpoints
router.get('/emails', verifyToken, authorizeRoles(...clinicRoles), controller.listEmails);
router.post('/emails', verifyToken, authorizeRoles(...clinicRoles), upload.single('attachment'), controller.sendEmail);
router.post('/emails/reply', verifyToken, authorizeRoles(...clinicRoles), controller.replyEmail);
router.post('/emails/forward', verifyToken, authorizeRoles(...clinicRoles), controller.forwardEmail);

// Campaign & Broadcast Endpoints
router.get('/campaigns', verifyToken, authorizeRoles(...clinicRoles), controller.listCampaigns);
router.post(
  '/campaigns',
  verifyToken,
  authorizeRoles(...clinicRoles),
  (req, res, next) => {
    const { error } = createCampaignValidation(req.body);
    if (error) {
      const message = error.details.map((d) => d.message).join(', ');
      return res.status(400).json({ success: false, message });
    }
    next();
  },
  controller.createCampaign
);

// Telehealth Sessions
router.get('/telehealth/sessions', verifyToken, authorizeRoles(...clinicRoles), controller.listTelehealthSessions);
router.post(
  '/telehealth/sessions',
  verifyToken,
  authorizeRoles(...clinicRoles),
  (req, res, next) => {
    const { error } = createTelehealthSessionValidation(req.body);
    if (error) {
      const message = error.details.map((d) => d.message).join(', ');
      return res.status(400).json({ success: false, message });
    }
    next();
  },
  controller.createTelehealthSession
);

// Document & Email helpers
router.post('/send-email', verifyToken, authorizeRoles(...clinicRoles), upload.single('pdfDocument'), controller.sendDirectEmail);
router.put('/messages/:messageId/flags', verifyToken, authorizeRoles(...clinicRoles), controller.updateMessageFlags);
router.delete('/messages/:messageId', verifyToken, authorizeRoles(...clinicRoles), controller.deleteMessagePermanently);

module.exports = router;
