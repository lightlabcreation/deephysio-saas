const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../config/prisma');
const nodemailer = require('nodemailer');
const { MODULES } = require('../../config/moduleAccess');
const {
  normalizePermissions,
  normalizeAllowedActions,
  getAssignedPermissions,
  getEffectivePermissions,
  getEffectiveAllowedActions,
  validatePermissionAssignment
} = require('../../config/actionAccess');

const normalizeAllowedMenus = (allowedMenus) => {
  if (!Array.isArray(allowedMenus)) return null;
  const unique = [...new Set(allowedMenus.filter((m) => MODULES.includes(m)))];
  return unique;
};

const buildPermissionBundle = ({ role, allowed_permissions, allowed_actions }) => {
  const normalizedPermissions = normalizePermissions(allowed_permissions);
  if (normalizedPermissions) {
    const validation = validatePermissionAssignment({ role, assignedPermissions: normalizedPermissions });
    if (!validation.valid) {
      const error = new Error(validation.message || 'Invalid permission assignment');
      error.statusCode = 400;
      throw error;
    }
    return {
      assignedPermissions: normalizedPermissions,
      effectivePermissions: getEffectivePermissions({ role, allowed_permissions: normalizedPermissions }),
      legacyActions: getEffectiveAllowedActions({ role, allowed_permissions: normalizedPermissions })
    };
  }

  const normalizedLegacy = normalizeAllowedActions(allowed_actions);
  const baseUserLike = normalizedLegacy
    ? { role, allowed_actions: normalizedLegacy }
    : { role };

  return {
    assignedPermissions: getAssignedPermissions(baseUserLike),
    effectivePermissions: getEffectivePermissions(baseUserLike),
    legacyActions: getEffectiveAllowedActions(baseUserLike)
  };
};

const registerUser = async (userData, reqMeta = {}) => {
  const { name, email, password, role = 'admin', businessName, mobileNumber, selectedPlan, allowed_menus, allowed_actions, allowed_permissions } = userData;
  const safeMenus = normalizeAllowedMenus(allowed_menus);
  const permissionBundle = buildPermissionBundle({ role, allowed_permissions, allowed_actions });

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    const error = new Error('User already exists');
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  let user;

  const isTrial = !userData.razorpayPaymentId && !userData.razorpayOrderId && 
    (selectedPlan === 'Free Trial' || selectedPlan === '7-Day Free Trial' || !selectedPlan);

  if (role === 'admin') {
    // Multi-tenant: Registering a clinic admin creates a new Tenant
    user = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          clinic_name: businessName || `${name}'s Clinic`,
          email: email,
          subscription_status: isTrial ? 'trial' : 'active',
          plan: selectedPlan || 'Free Trial'
        }
      });

      return await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
          tenant_id: tenant.id,
          allowed_menus: safeMenus ? JSON.stringify(safeMenus) : null,
          allowed_permissions: permissionBundle.assignedPermissions ? JSON.stringify(permissionBundle.assignedPermissions) : null,
          allowed_actions: permissionBundle.legacyActions ? JSON.stringify(permissionBundle.legacyActions) : null
        },
        include: { tenant: true }
      });
    });

    // Log the payment to the in-memory SaaS Dashboard if paid via Razorpay
    if (userData.razorpayPaymentId || userData.razorpayOrderId) {
      const saasState = require('../../config/saasState');
      let amount = 99900; // default Starter
      if (selectedPlan === 'Standard') amount = 129900;
      else if (selectedPlan === 'Pro') amount = 149900;
      
      saasState.addPayment({
        name,
        businessName,
        amount,
        plan: selectedPlan,
        razorpayPaymentId: userData.razorpayPaymentId
      });
    }

  } else {
    // For superadmin or staff created within a tenant (if handled here)
    user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
        tenant_id: userData.tenant_id || null, // Allow passing tenant_id for staff
        allowed_menus: safeMenus ? JSON.stringify(safeMenus) : null,
        allowed_permissions: permissionBundle.assignedPermissions ? JSON.stringify(permissionBundle.assignedPermissions) : null,
        allowed_actions: permissionBundle.legacyActions ? JSON.stringify(permissionBundle.legacyActions) : null
      },
      include: { tenant: true }
    });
  }

  // Generate unique session ID and auth token for instant login upon registration
  const sessionId = crypto.randomBytes(16).toString('hex');
  activeSessions.set(user.id, {
    sessionId,
    ip: reqMeta.ip || '127.0.0.1',
    userAgent: reqMeta.userAgent || 'Web/Mobile Client',
    loginTime: new Date()
  });

  const token = jwt.sign(
    { id: user.id, role: user.role, tenant_id: user.tenant_id, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  let parsedMenus = user.allowed_menus;
  if (typeof parsedMenus === 'string') {
    try { parsedMenus = JSON.parse(parsedMenus); } catch (e) { parsedMenus = null; }
  }

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant: user.tenant,
      allowedMenus: parsedMenus,
      effectivePermissions: buildPermissionBundle({ 
        role: user.role, 
        allowed_permissions: user.allowed_permissions, 
        allowed_actions: user.allowed_actions 
      }).effectivePermissions
    }
  };
};

// Session store for Feature 10 (Single Active Session & Concurrent Login Prevention)
const activeSessions = new Map(); // userId -> { sessionId, ip, userAgent, loginTime }

const isSessionTerminated = (userId, sessionId) => {
  if (!activeSessions.has(userId)) return false;
  const current = activeSessions.get(userId);
  return current && current.sessionId !== sessionId;
};

const getActiveSessions = (userId) => {
  return activeSessions.get(userId) || null;
};

const terminateUserSession = (userId) => {
  activeSessions.delete(userId);
  return true;
};

const loginUser = async (credentials, reqMeta = {}) => {
  const { email, password } = credentials;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: true }
  });

  if (!user) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // Check if tenant is blocked
  if (user.tenant && user.tenant.subscription_status === 'canceled') {
    const error = new Error('Your account has been blocked by the administrator. Please contact support.');
    error.statusCode = 403;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // Feature 10: Generate unique session ID for single-device/IP enforcement
  const sessionId = crypto.randomBytes(16).toString('hex');
  activeSessions.set(user.id, {
    sessionId,
    ip: reqMeta.ip || '127.0.0.1',
    userAgent: reqMeta.userAgent || 'Web/Mobile Client',
    loginTime: new Date()
  });

  const token = jwt.sign(
    { id: user.id, role: user.role, tenant_id: user.tenant_id, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Parse JSON string fields from DB before sending to frontend
  let parsedMenus = user.allowed_menus;
  if (typeof parsedMenus === 'string') {
    try { parsedMenus = JSON.parse(parsedMenus); } catch (e) { parsedMenus = null; }
  }

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      tenant: user.tenant,
      allowedMenus: parsedMenus,
      effectivePermissions: buildPermissionBundle({ 
        role: user.role, 
        allowed_permissions: user.allowed_permissions, 
        allowed_actions: user.allowed_actions 
      }).effectivePermissions
    }
  };
};

/**
 * 🔑 FEATURE 4: Forgot Password with 6-digit OTP & Token link
 */
const forgotPassword = async ({ email }) => {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    throw error;
  }

  // Generate 6-digit OTP and token
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 3600000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: `${otp}:${token}`,
      resetPasswordExpires: expiry
    }
  });

  // Construct reset link
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  console.log(`[PASSWORD RESET OTP] For user ${user.email} -> OTP: ${otp} | Token: ${token}`);

  return { 
    email: user.email,
    otp, // Returned for UI testing & mobile simulation
    token,
    message: `Password reset OTP has been sent. Your 6-digit verification code is: ${otp}`
  };
};

const verifyOtp = async ({ email, otp }) => {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !user.resetPasswordToken) {
    const error = new Error('Invalid or expired OTP code');
    error.statusCode = 400;
    throw error;
  }

  const [storedOtp, token] = user.resetPasswordToken.split(':');
  if (storedOtp !== String(otp).trim()) {
    const error = new Error('Incorrect 6-digit OTP code');
    error.statusCode = 400;
    throw error;
  }

  if (new Date() > new Date(user.resetPasswordExpires)) {
    const error = new Error('OTP has expired. Please request a new code.');
    error.statusCode = 400;
    throw error;
  }

  return {
    valid: true,
    token: token || user.resetPasswordToken,
    message: 'OTP verified successfully'
  };
};

const resetPassword = async ({ token, otp, email, newPassword }) => {
  let user;

  if (token) {
    user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: { contains: token },
        resetPasswordExpires: { gt: new Date() }
      }
    });
  } else if (email && otp) {
    const candidate = await prisma.user.findUnique({ where: { email } });
    if (candidate && candidate.resetPasswordToken) {
      const [storedOtp] = candidate.resetPasswordToken.split(':');
      if (storedOtp === String(otp).trim() && new Date() < new Date(candidate.resetPasswordExpires)) {
        user = candidate;
      }
    }
  }

  if (!user) {
    const error = new Error('Password reset token / OTP is invalid or has expired');
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpires: null
    }
  });

  return { email: user.email, message: 'Password updated successfully' };
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    const error = new Error('Current password is incorrect');
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  });

  return { id: user.id, email: user.email };
};

module.exports = {
  registerUser,
  loginUser,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  isSessionTerminated,
  getActiveSessions,
  terminateUserSession
};

