const express = require('express');
const router = express.Router();
const { registerUser, loginUser, forgotPassword, verifyOtp, resetPassword, changePassword, getActiveSessions, terminateOtherSessions, createSubscriptionOrder, deleteAccount, registerDeviceToken } = require('./auth.controller');
const { registerValidation, loginValidation, forgotPasswordValidation, resetPasswordValidation, changePasswordValidation } = require('./auth.validation');
const { verifyToken } = require('./auth.middleware');

router.post('/create-subscription-order', createSubscriptionOrder);

router.post('/register', (req, res, next) => {
  const { error, value } = registerValidation(req.body);
  if (error) {
    const message = error.details.map(err => err.message).join(', ');
    return res.status(400).json({
      success: false,
      message
    });
  }
  req.body = value;
  next();
}, registerUser);

router.post('/login', (req, res, next) => {
  const { error } = loginValidation(req.body);
  if (error) {
    const message = error.details.map(err => err.message).join(', ');
    return res.status(400).json({
      success: false,
      message
    });
  }
  next();
}, loginUser);

router.post('/forgot-password', (req, res, next) => {
  const { error } = forgotPasswordValidation(req.body);
  if (error) {
    const message = error.details.map(err => err.message).join(', ');
    return res.status(400).json({
      success: false,
      message
    });
  }
  next();
}, forgotPassword);

router.post('/verify-otp', verifyOtp);

router.post('/reset-password', resetPassword);

router.get('/active-sessions', verifyToken, getActiveSessions);
router.post('/terminate-sessions', verifyToken, terminateOtherSessions);

router.post('/change-password', verifyToken, (req, res, next) => {
  const { error } = changePasswordValidation(req.body);
  if (error) {
    const message = error.details.map(err => err.message).join(', ');
    return res.status(400).json({
      success: false,
      message
    });
  }
  next();
}, changePassword);

router.post('/delete-account', deleteAccount);
router.post('/register-device', registerDeviceToken);

module.exports = router;