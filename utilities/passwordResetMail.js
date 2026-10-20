const { randomBytes, createHash } = require('node:crypto');
const nodemailer = require('nodemailer');
const User = require('../models/user');

const pendingTasks = new Set();

function getMailConfiguration() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM, PASSWORD_RESET_URL, RESEND_API_KEY } = process.env;
  if (!MAIL_FROM || /[\r\n]/.test(MAIL_FROM) || !PASSWORD_RESET_URL) return null;
  let resetUrl;
  try {
    resetUrl = new URL(PASSWORD_RESET_URL);
    if (!['http:', 'https:'].includes(resetUrl.protocol) || resetUrl.username || resetUrl.password) return null;
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(resetUrl.hostname);
    if (resetUrl.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || !localHost)) return null;
  } catch { return null; }

  if (RESEND_API_KEY?.trim()) {
    return { provider: 'resend', apiKey: RESEND_API_KEY.trim(), from: MAIL_FROM, resetUrl: resetUrl.toString() };
  }
  const port = Number(process.env.SMTP_PORT);
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || ![465, 587].includes(port)) return null;
  return { provider: 'smtp', host: SMTP_HOST, port, user: SMTP_USER, password: SMTP_PASS,
    from: MAIL_FROM, resetUrl: resetUrl.toString() };
}

async function sendMail(configuration, message) {
  if (configuration.provider === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${configuration.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: configuration.from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Email delivery failed');
    const result = await response.json();
    if (typeof result.id !== 'string' || !result.id) throw new Error('Email delivery failed');
    return;
  }
  const transport = nodemailer.createTransport({
    host: configuration.host, port: configuration.port,
    secure: configuration.port === 465, requireTLS: configuration.port === 587,
    auth: { user: configuration.user, pass: configuration.password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000
  });
  try {
    const result = await transport.sendMail({ from: configuration.from, ...message });
    if (!Array.isArray(result.accepted) || result.accepted.length === 0) throw new Error('Email delivery failed');
  } finally {
    transport.close();
  }
}

function enqueue(task) {
  const pending = Promise.resolve().then(task).catch(() => {
    // Deliberately omit provider errors, recipients, links, and credentials.
    console.error('Password reset email delivery failed.');
  });
  pendingTasks.add(pending);
  pending.finally(() => pendingTasks.delete(pending));
}

function enqueuePasswordReset(email, configuration) {
  enqueue(async () => {
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({ email: new RegExp(`^${escapedEmail}$`, 'i') }).select('email');
    if (!user) return;
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await User.updateOne({ _id: user._id }, { $set: {
      resetTokenHash: tokenHash, resetTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000)
    } });
    const resetUrl = new URL(configuration.resetUrl);
    resetUrl.hash = `reset-password?token=${token}`;
    try {
      await sendMail(configuration, {
        to: user.email, subject: 'Reset your SpendSmart password',
        text: `A password reset was requested for your SpendSmart account.\n\nOpen this link to choose a new password:\n${resetUrl.toString()}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, you can ignore this email.`
      });
    } catch (error) {
      await User.updateOne({ _id: user._id, resetTokenHash: tokenHash }, {
        $unset: { resetTokenHash: '', resetTokenExpiresAt: '' }
      });
      throw error;
    }
  });
}

function enqueuePasswordChangedNotice(email) {
  const configuration = getMailConfiguration();
  if (!configuration) return;
  enqueue(() => sendMail(configuration, {
    to: email, subject: 'Your SpendSmart password was changed',
    text: 'Your SpendSmart password was changed. Previous sessions have been signed out. If you did not make this change, request a password reset immediately.'
  }));
}

async function waitForPendingPasswordResetMail() {
  while (pendingTasks.size) await Promise.all([...pendingTasks]);
}

module.exports = {
  getMailConfiguration, enqueuePasswordReset, enqueuePasswordChangedNotice, waitForPendingPasswordResetMail
};
