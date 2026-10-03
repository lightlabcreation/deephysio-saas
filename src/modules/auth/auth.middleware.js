const jwt = require('jsonwebtoken');
const tenantContext = require('../../config/tenantContext');

const verifyToken = (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Feature 10: Check if session has been invalidated by a newer login
    const authService = require('./auth.service');
    if (decoded.sessionId && authService.isSessionTerminated && authService.isSessionTerminated(decoded.id, decoded.sessionId)) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_TERMINATED',
        message: 'Your account was logged in from another device or location. This session has been terminated.'
      });
    }

    req.user = decoded;
    if (decoded && decoded.tenant_id !== undefined && decoded.tenantId === undefined) {
      req.user.tenantId = decoded.tenant_id;
    } else if (decoded && decoded.tenantId !== undefined && decoded.tenant_id === undefined) {
      req.user.tenant_id = decoded.tenantId;
    }

    const tid = req.user.tenant_id !== undefined ? req.user.tenant_id : req.user.tenantId;

    // Use AsyncLocalStorage to provide tenant_id down the stack
    tenantContext.run(tid, () => {
      next();
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid token'
    });
  }
};

module.exports = {
  verifyToken
};
