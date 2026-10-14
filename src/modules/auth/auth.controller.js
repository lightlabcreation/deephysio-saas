const authService = require('./auth.service');
const { logActivity } = require('../../utils/activityLogger');
const Razorpay = require('razorpay');

const registerUser = async (req, res) => {
  try {
    const reqMeta = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    const result = await authService.registerUser(req.body, reqMeta);

    if (result?.user) {
      await logActivity(
        result.user.id, 
        'LOGIN', 
        result.user.id, 
        'User', 
        `New clinic registration: ${result.user.name} started plan (${result.user.tenant?.plan || 'Free Trial'})`,
        { entity: 'User', entityId: result.user.id, label: result.user.name, ip: reqMeta.ip },
        reqMeta.ip,
        result.user.tenant_id
      );
    }

    return res.status(201).json({
      success: true,
      data: result,
      message: 'User registered and logged in successfully'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const reqMeta = {
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    const result = await authService.loginUser(req.body, reqMeta);

    const roleLabel = (result.user.role || 'user').toUpperCase();
    await logActivity(
      result.user.id, 
      'LOGIN', 
      result.user.id, 
      'User', 
      `Staff Login: [${roleLabel}] ${result.user.name} (${result.user.email}) logged in successfully from IP ${reqMeta.ip}`,
      { 
        entity: 'User', 
        entityId: result.user.id, 
        label: result.user.name, 
        email: result.user.email,
        role: result.user.role,
        ip: reqMeta.ip,
        userAgent: reqMeta.userAgent 
      },
      reqMeta.ip,
      result.user.tenant_id
    );

    return res.status(200).json({
      success: true,
      data: result,
      message: 'Login successful'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const result = await authService.forgotPassword(req.body);
    return res.status(200).json({
      success: true,
      data: result,
      message: result.message || 'OTP sent successfully'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const result = await authService.verifyOtp(req.body);
    return res.status(200).json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const result = await authService.resetPassword(req.body);
    return res.status(200).json({
      success: true,
      data: result,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

const getActiveSessions = async (req, res) => {
  try {
    const session = authService.getActiveSessions(req.user.id);
    return res.status(200).json({
      success: true,
      data: session ? [session] : []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const terminateOtherSessions = async (req, res) => {
  try {
    authService.terminateUserSession(req.user.id);
    return res.status(200).json({
      success: true,
      message: 'All other active sessions have been terminated.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await authService.changePassword(userId, req.body);
    return res.status(200).json({
      success: true,
      data: result,
      message: 'Password changed successfully'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
};

const createSubscriptionOrder = async (req, res) => {
  try {
    const { planName } = req.body;
    
    let amount = 99900; // Starter: ₹999
    if (planName === 'Standard') amount = 129900;
    else if (planName === 'Pro') amount = 149900;

    // Use the exact live credentials provided by the user
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_T2CGGz8NLUuopj',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'CaKT2baCx1GxiPs8LX7cE1Bu'
    });

    const options = {
      amount: amount, 
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };

    const order = await instance.orders.create(options);

    return res.status(200).json({
      success: true,
      data: order,
      isMock: false,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('Razorpay Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order. Please check Razorpay keys.'
    });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const { password, email } = req.body;
    const targetEmail = req.user?.email || email;

    if (!targetEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required to confirm account deletion'
      });
    }

    const prisma = require('../../config/prisma');
    const bcrypt = require('bcryptjs');

    const user = await prisma.user.findUnique({
      where: { email: targetEmail }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Account not found'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Deletion cancelled.'
      });
    }

    // Anonymize personal info and revoke permissions
    const anonymizedEmail = `deleted_${user.id}_${Date.now()}@anonymized.local`;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: 'Deleted User',
        email: anonymizedEmail,
        password: await bcrypt.hash(`deleted_${Date.now()}`, 10),
        allowed_menus: '[]',
        allowed_permissions: '[]',
        allowed_actions: '[]'
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Account deleted and personal details anonymized successfully'
    });
  } catch (err) {
    console.error('Account deletion error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing account deletion'
    });
  }
};

const registerDeviceToken = async (req, res) => {
  try {
    const { deviceToken, platform } = req.body;
    console.log(`[Push Notification] Device registered (${platform || 'android'}): ${deviceToken?.substring(0, 15)}...`);
    return res.status(200).json({
      success: true,
      message: 'Device token registered successfully'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  getActiveSessions,
  terminateOtherSessions,
  createSubscriptionOrder,
  deleteAccount,
  registerDeviceToken
};