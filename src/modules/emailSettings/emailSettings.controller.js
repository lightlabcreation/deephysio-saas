const emailService = require('./emailSettings.service');

const getSettings = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin';
    const tenantId = isSuperAdmin ? (parseInt(req.query.tenantId, 10) || req.user.tenant_id || null) : req.user.tenant_id;

    const data = await emailService.getEmailSettings(tenantId);
    return res.json({ success: true, tenantId, data });
  } catch (err) {
    next(err);
  }
};

const saveSettings = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin';
    const tenantId = isSuperAdmin ? (parseInt(req.body.tenantId, 10) || req.user.tenant_id || null) : req.user.tenant_id;

    const result = await emailService.saveEmailSettings(tenantId, req.body, req.user?.id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

const removeSettings = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin';
    const tenantId = isSuperAdmin ? (parseInt(req.body?.tenantId || req.query?.tenantId, 10) || req.user.tenant_id || null) : req.user.tenant_id;

    const result = await emailService.removeEmailSettings(tenantId, req.user?.id);
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

const testSettings = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id || req.user?.tenantId;
    const result = await emailService.testConnection(tenantId, req.body, req.user?.email);
    return res.json(result);
  } catch (err) {
    console.error('[EmailSettings Controller Test Error]:', err.message);
    return res.status(400).json({
      success: false,
      message: err.message || 'SMTP Connection Test Failed. Please verify your credentials and security settings.'
    });
  }
};

module.exports = {
  getSettings,
  saveSettings,
  removeSettings,
  testSettings
};
