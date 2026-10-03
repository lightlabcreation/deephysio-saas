const whatsappService = require('./whatsapp.service');
const { logActivity } = require('../../utils/activityLogger');

const getReqTenantId = (req) => {
  const raw = req.user?.tenant_id !== undefined ? req.user?.tenant_id : req.user?.tenantId;
  const parsed = parseInt(raw, 10);
  if (!parsed || isNaN(parsed)) return null;
  return parsed;
};

/**
 * GET /api/settings/whatsapp/status
 */
const getStatus = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const statusData = await whatsappService.getTenantStatus(tenantId);
    return res.status(200).json({
      success: true,
      data: statusData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/whatsapp/qr
 */
const getQr = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const qrData = await whatsappService.getTenantQr(tenantId);
    return res.status(200).json({
      success: true,
      data: qrData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/connect
 */
const connect = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    const { phoneNumber } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'WhatsApp phone number is required.' });
    }

    const result = await whatsappService.startTenantConnection(tenantId, phoneNumber);

    if (req.user?.id) {
      await logActivity(
        req.user.id,
        'UPDATE_SETTINGS',
        phoneNumber,
        'WhatsApp',
        `Initiated WhatsApp connection for number: ${phoneNumber}`,
        { phoneNumber },
        req.ip,
        tenantId
      );
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/disconnect
 */
const disconnect = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const result = await whatsappService.disconnectTenant(tenantId);

    if (req.user?.id) {
      await logActivity(
        req.user.id,
        'UPDATE_SETTINGS',
        'DISCONNECTED',
        'WhatsApp',
        'WhatsApp session was disconnected.',
        {},
        req.ip,
        tenantId
      );
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/reconnect
 */
const reconnect = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const { phoneNumber } = req.body || {};
    const statusData = await whatsappService.getTenantStatus(tenantId);
    const targetPhone = phoneNumber || statusData.phoneNumber;

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        message: 'No registered WhatsApp number found. Please enter your number to connect.'
      });
    }

    const result = await whatsappService.startTenantConnection(tenantId, targetPhone);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/whatsapp/logs
 */
const getLogs = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const limit = parseInt(req.query.limit, 10) || 500;
    const logs = await whatsappService.getTenantLogs(tenantId, limit);
    return res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/test
 * Send live test message to verified phone
 */
const sendTestMessage = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    const { recipientPhone, message, recipientName, recipientType, eventType } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    if (!recipientPhone) {
      return res.status(400).json({ success: false, message: 'Recipient phone number is required.' });
    }

    const testBody = message && message.trim() ? message.trim() : 
`*DeePhysio Platform — Test Message*

✅ Hello! Your clinic WhatsApp connectivity is active and working properly.

Date: ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
Time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}

Role-based notifications (Attendance, Appointments, Billing, Care Plans) are enabled.`;

    const result = await whatsappService.sendWhatsAppMessage({
      tenantId,
      recipientPhone,
      recipientName: recipientName || 'Clinic Contact',
      recipientType: recipientType || 'OUTBOUND',
      eventType: eventType || 'MANUAL_CHAT',
      messageText: testBody
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message || `WhatsApp message sent successfully to ${recipientName || recipientPhone}!`,
        data: result
      });
    } else {
      return res.status(503).json({
        success: false,
        message: result.error || result.reason || 'WhatsApp message delivery failed. Connection is offline or reconnecting.',
        data: result
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/ensure-session
 */
const ensureSession = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    await whatsappService.ensureTenantSession(tenantId);
    const statusData = await whatsappService.getTenantStatus(tenantId);
    return res.status(200).json({
      success: true,
      data: statusData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/whatsapp/pairing-code
 */
const getPairingCode = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    const { phoneNumber } = req.body;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'WhatsApp phone number is required.' });
    }

    const result = await whatsappService.requestTenantPairingCode(tenantId, phoneNumber);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/whatsapp/groups
 */
const getGroups = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    const groups = await whatsappService.getTenantGroups(tenantId);
    return res.status(200).json({
      success: true,
      data: groups
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/whatsapp/profile-picture?phone=...
 */
const getProfilePicture = async (req, res) => {
  try {
    const tenantId = getReqTenantId(req);
    const { phone } = req.query;

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context is missing.' });
    }

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone or JID is required.' });
    }

    const url = await whatsappService.getProfilePictureUrl(tenantId, phone);
    return res.status(200).json({
      success: true,
      data: { url }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getStatus,
  getQr,
  connect,
  disconnect,
  reconnect,
  getPairingCode,
  getLogs,
  getGroups,
  getProfilePicture,
  sendTestMessage,
  ensureSession
};
