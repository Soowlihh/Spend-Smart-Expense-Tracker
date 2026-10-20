const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { createHash } = require('node:crypto');
const User = require('../models/user');
const catchAsync = require('../utilities/catchAsync');
const {
  loginLimiter, registerLimiter, forgotPasswordLimiter,
  forgotPasswordEmailLimiter, resetPasswordLimiter
} = require('../rateLimiter');
const {
  getMailConfiguration, enqueuePasswordReset, enqueuePasswordChangedNotice
} = require('../utilities/passwordResetMail');

const router = express.Router();
const genericResetMessage = 'If an account matches that email, a reset link will be sent.';
const invalidResetMessage = 'This reset link is invalid or has expired. Request a new link.';
const emailSchema = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required()
  .messages({ 'any.required': 'Enter your email address.', 'string.empty': 'Enter your email address.',
    'string.email': 'Enter a valid email address.' });
const passwordSchema = Joi.string().min(12).max(128).required().messages({
  'string.min': 'Password must be between 12 and 128 characters.',
  'string.max': 'Password must be between 12 and 128 characters.',
  'string.empty': 'Enter a password.', 'any.required': 'Enter a password.'
});

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body ?? {}, { abortEarly: true });
    if (error) return res.status(400).json({ ok: false, message: error.details[0].message });
    req.body = value;
    return next();
  };
}

function cookieOptions() {
  const production = process.env.NODE_ENV === 'production';
  return { httpOnly: true, secure: production, sameSite: production ? 'none' : 'lax', path: '/' };
}

function tokenPayload(user) {
  return { userId: user._id.toString(), tokenVersion: user.tokenVersion ?? 0 };
}

router.get('/register', (_req, res) => res.send('Register page'));
router.post('/register', registerLimiter, validate(Joi.object({
  email: emailSchema,
  username: Joi.string().trim().min(3).max(32).pattern(/^[a-z\d_.-]+$/i).required().messages({
    'string.min': 'Username must be between 3 and 32 characters.',
    'string.max': 'Username must be between 3 and 32 characters.',
    'string.pattern.base': 'Username can contain letters, numbers, underscores, periods, and hyphens.'
  }),
  password: passwordSchema
})), catchAsync(async (req, res) => {
  const { email, username, password } = req.body;
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (await User.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') })) {
    return res.status(409).json({ ok: false, message: 'Email is already in use.' });
  }
  try {
    await User.register(new User({ email, username }), password);
    return res.status(201).json({ ok: true, message: 'Registered successfully.' });
  } catch (error) {
    if (error.name === 'UserExistsError' || error.code === 11000) {
      return res.status(409).json({ ok: false, message: 'Email or username is already in use.' });
    }
    throw error;
  }
}));

router.get('/login', (_req, res) => res.send('Login page'));
router.post('/login', loginLimiter, validate(Joi.object({
  username: Joi.string().trim().min(1).max(128).required(),
  password: Joi.string().min(1).max(128).required()
})), catchAsync(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findByUsername(username);
  if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials' });
  const { user: authUser } = await user.authenticate(password);
  if (!authUser) return res.status(401).json({ ok: false, message: 'Invalid credentials' });

  const payload = tokenPayload(authUser);
  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  return res.json({ ok: true, accessToken });
}));

router.post('/refresh', catchAsync(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ ok: false, message: 'No refresh token' });
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    if (!decoded || !/^[a-f\d]{24}$/i.test(decoded.userId)) throw new Error('Invalid user');
  } catch {
    return res.status(403).json({ ok: false, message: 'Invalid or expired token' });
  }
  const user = await User.findById(decoded.userId).select('tokenVersion');
  if (!user || (decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
    return res.status(403).json({ ok: false, message: 'Your session has expired. Sign in again.' });
  }
  const accessToken = jwt.sign(tokenPayload(user), process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
  return res.json({ ok: true, accessToken });
}));

router.post('/logout', (_req, res) => {
  res.clearCookie('refreshToken', cookieOptions());
  return res.json({ ok: true, message: 'Logged out' });
});

router.post('/forgot-password', forgotPasswordLimiter,
  validate(Joi.object({ email: emailSchema })),
  (req, res, next) => {
    const configuration = getMailConfiguration();
    if (!configuration) {
      return res.status(503).json({ ok: false,
        message: 'Password reset email is temporarily unavailable. Please try again later.' });
    }
    req.resetMailConfiguration = configuration;
    return next();
  }, forgotPasswordEmailLimiter, (req, res) => {
    enqueuePasswordReset(req.body.email, req.resetMailConfiguration);
    return res.status(202).json({ ok: true, message: genericResetMessage });
  });

router.post('/reset-password', resetPasswordLimiter, validate(Joi.object({
  token: Joi.string().hex().length(64).required().messages({
    'string.base': invalidResetMessage,
    'string.hex': invalidResetMessage, 'string.length': invalidResetMessage,
    'string.empty': invalidResetMessage, 'any.required': invalidResetMessage
  }),
  password: passwordSchema,
  confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
    'any.only': 'Passwords do not match.', 'string.empty': 'Confirm your new password.',
    'any.required': 'Confirm your new password.'
  })
})), catchAsync(async (req, res) => {
  const { token, password } = req.body;
  const resetTokenHash = createHash('sha256').update(token).digest('hex');
  const candidate = await User.findOne({ resetTokenHash, resetTokenExpiresAt: { $gt: new Date() } }).select('_id');
  if (!candidate) return res.status(400).json({ ok: false, message: invalidResetMessage });

  // Derive first; consume the token and replace the password in one atomic update.
  const pending = new User();
  await pending.setPassword(password);
  const changed = await User.findOneAndUpdate({
    _id: candidate._id, resetTokenHash, resetTokenExpiresAt: { $gt: new Date() }
  }, {
    $set: { hash: pending.get('hash'), salt: pending.get('salt') },
    $unset: { resetTokenHash: '', resetTokenExpiresAt: '' },
    $inc: { tokenVersion: 1 }
  }, { new: true }).select('email');
  if (!changed) return res.status(400).json({ ok: false, message: invalidResetMessage });

  res.clearCookie('refreshToken', cookieOptions());
  enqueuePasswordChangedNotice(changed.email);
  return res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
}));

module.exports = router;
