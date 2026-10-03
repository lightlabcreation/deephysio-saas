const auditLogService = require('./auditLog.service');

const getAuditLogs = async (req, res) => {
  try {
    const result = await auditLogService.getAuditLogs(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const exportAuditLogsCsv = async (req, res) => {
  try {
    const csv = await auditLogService.exportAuditLogsCsv(req.query, req.user);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${Date.now()}.csv`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getAuditTenants = async (req, res) => {
  try {
    const tenants = await auditLogService.getAuditTenants(req.user);
    return res.status(200).json({
      success: true,
      data: tenants
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const getAuditStats = async (req, res) => {
  try {
    const stats = await auditLogService.getAuditStats(req.query, req.user);
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

module.exports = {
  getAuditLogs,
  getAuditTenants,
  getAuditStats,
  exportAuditLogsCsv
};
