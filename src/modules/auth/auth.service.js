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

const registerUser = async (userData) => {
  const { name, email, password, role, businessName, mobileNumber, selectedPlan, allowed_menus, allowed_actions, allowed_permissions } = userData;
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

  if (role === 'admin') {
    // Multi-tenant: Registering a clinic admin creates a new Tenant
    user = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          clinic_name: businessName || `${name}'s Clinic`,
          email: email,
          subscription_status: 'active', // You could use 'trial' based on paymentData
          plan: selectedPlan || 'Starter'
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
        }
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
      }
    });
  }

  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

const loginUser = async (credentials) => {
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

  const token = jwt.sign(
    { id: user.id, role: user.role, tenant_id: user.tenant_id },
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

const forgotPassword = async ({ email }) => {
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    throw error;
  }

  // Generate token
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 3600000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: token,
      resetPasswordExpires: expiry
    }
  });

  // Construct reset link
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  // 2. Setup Transporter or Twilio Test Mode (Same logic as communication service)
  const smtpPass = process.env.SMTP_PASS;
  const twilioTestSid = process.env.TWILIO_TEST_ACCOUNT_SID;
  const twilioTestToken = process.env.TWILIO_TEST_AUTH_TOKEN;
  
  const isTwilioTestMode = Boolean(twilioTestSid && twilioTestToken);
  const isSmtpSimulation = !smtpPass || smtpPass === 'your-app-password';
  const isSimulation = isTwilioTestMode || isSmtpSimulation;

  if (!isSimulation) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
          user: process.env.SMTP_USER || 'deephysioclinic@gmail.com',
          pass: smtpPass
      }
    });

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"DeePhysio Clinic" <deephysioclinic@gmail.com>',
        to: user.email,
        subject: 'Password Reset Request',
        text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n` +
              `Please click on the following link, or paste this into your browser to complete the process within one hour of receiving it:\n\n` +
              `${resetLink}\n\n` +
              `If you did not request this, please ignore this email and your password will remain unchanged.\n`
      });
    } catch (mailError) {
      console.error('Nodemailer Error:', mailError);
      // We don't throw here to not expose email issues, but in a real app we might
    }
  } else {
    if (isTwilioTestMode) {
      console.log(`[TWILIO AUTH TEST] Password reset link for ${user.email}: ${resetLink}`);
    } else {
      console.log(`[AUTH SIMULATION] Password reset link for ${user.email}: ${resetLink}`);
    }
  }

  return { 
    email: user.email, 
    isSimulation,
    message: isTwilioTestMode ? 'Twilio Auth Test Successful (Reset Link Logged)' : 'If that email is in our system, a reset link has been sent.'
  };
};

const resetPassword = async ({ token, newPassword }) => {
  const user = await prisma.user.findFirst({
    where: {
      resetPasswordToken: token,
      resetPasswordExpires: {
        gt: new Date()
      }
    }
  });

  if (!user) {
    const error = new Error('Password reset token is invalid or has expired');
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

  return { email: user.email };
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
  resetPassword,
  changePassword
};
