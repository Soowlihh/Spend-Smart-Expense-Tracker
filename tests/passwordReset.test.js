const { randomBytes, createHash } = require('node:crypto');

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.REFRESH_TOKEN_SECRET = randomBytes(32).toString('hex');

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ipKeyGenerator } = require('express-rate-limit');
const app = require('../app');
const User = require('../models/user');
const limiters = require('../rateLimiter');
const { waitForPendingPasswordResetMail } = require('../utilities/passwordResetMail');

const originalFetch = global.fetch;
const envNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'PASSWORD_RESET_URL', 'RESEND_API_KEY'];
const originalMailEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const oldPassword = 'original-test-password';
const newPassword = 'replacement-test-password';
const email = 'alice@example.com';
const generic = { ok: true, message: 'If an account matches that email, a reset link will be sent.' };
const invalid = { ok: false, message: 'This reset link is invalid or has expired. Request a new link.' };
let database;
let sendMail;
let close;
let errorLog;

function emailKey(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clearEmailCooldown(value = email) {
  limiters.forgotPasswordEmailLimiter.resetKey(emailKey(value));
}

function tokenFromMessage(message) {
  const link = message.text.match(/https?:\/\/\S+/)[0];
  const url = new URL(link);
  expect(url.search).toBe('');
  expect(url.origin).toBe('http://localhost:3001');
  const token = new URLSearchParams(url.hash.slice('#reset-password?'.length)).get('token');
  expect(token).toMatch(/^[a-f\d]{64}$/);
  return token;
}

async function issueToken() {
  await request(app).post('/forgot-password').send({ email }).expect(202, generic);
  await waitForPendingPasswordResetMail();
  return tokenFromMessage(sendMail.mock.calls[0][0]);
}

function resetRequest(token, password = newPassword, confirmPassword = password) {
  return request(app).post('/reset-password').send({ token, password, confirmPassword });
}

async function storedUser() {
  return User.findOne({ email }).select('+resetTokenHash +resetTokenExpiresAt +hash +salt');
}

async function authenticates(password) {
  const user = await User.findByUsername('alice', true);
  return Boolean((await user.authenticate(password)).user);
}

beforeAll(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { dbName: 'expense_tracker_password_reset_test' });
});

beforeEach(async () => {
  await waitForPendingPasswordResetMail();
  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASS: 'test-only-secret',
    MAIL_FROM: 'SpendSmart <no-reply@example.com>', PASSWORD_RESET_URL: 'http://localhost:3001'
  });
  process.env.NODE_ENV = 'test';
  for (const limiter of Object.values(limiters)) {
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) limiter.resetKey(ipKeyGenerator(ip));
  }
  for (const address of [email, 'unknown@example.com']) clearEmailCooldown(address);
  await User.deleteMany({});
  await User.register(new User({ email, username: 'alice' }), oldPassword);
  sendMail = jest.fn().mockResolvedValue({ accepted: [email] });
  close = jest.fn();
  nodemailer.createTransport.mockReset().mockReturnValue({ sendMail, close });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'mock-email-id' }) });
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await waitForPendingPasswordResetMail();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await waitForPendingPasswordResetMail();
  await mongoose.disconnect();
  if (database) await database.stop();
  global.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalMailEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('reset requests', () => {
  test('known and unknown addresses receive the same response without an exposed token', async () => {
    const known = await request(app).post('/forgot-password').send({ email }).expect(202);
    const unknown = await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(202);
    expect(known.body).toEqual(generic);
    expect(unknown.body).toEqual(generic);
    await waitForPendingPasswordResetMail();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe(email);
    expect(JSON.stringify(known.body)).not.toContain(tokenFromMessage(sendMail.mock.calls[0][0]));
  });

  test('stores only a hidden token hash with a fifteen-minute expiry', async () => {
    const started = Date.now();
    const token = await issueToken();
    const user = await storedUser();
    expect(user.resetTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(user.resetTokenHash).not.toBe(token);
    expect(user.resetTokenExpiresAt.getTime()).toBeGreaterThanOrEqual(started + 15 * 60 * 1000);
    expect(user.resetTokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    const publicUser = await User.findOne({ email });
    expect(publicUser.resetTokenHash).toBeUndefined();
    expect(publicUser.resetTokenExpiresAt).toBeUndefined();
  });

  test('accepts normalized email input and suppresses repeated requests for the same email', async () => {
    await request(app).post('/forgot-password').send({ email: '  ALICE@EXAMPLE.COM  ' }).expect(202, generic);
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test('requires a complete mail configuration uniformly without looking up accounts', async () => {
    delete process.env.SMTP_PASS;
    const lookup = jest.spyOn(User, 'findOne');
    const known = await request(app).post('/forgot-password').send({ email }).expect(503);
    const unknown = await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(503);
    expect(known.body).toEqual(unknown.body);
    expect(lookup).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test.each(['not-an-email', { $ne: null }, ''])('rejects malformed email input %#', async (value) => {
    await request(app).post('/forgot-password').send({ email: value }).expect(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('rejects an untrusted reset URL configuration', async () => {
    process.env.PASSWORD_RESET_URL = 'javascript:alert(1)';
    await request(app).post('/forgot-password').send({ email }).expect(503);
  });

  test('requires HTTPS reset links in production', async () => {
    process.env.NODE_ENV = 'production';
    await request(app).post('/forgot-password').send({ email }).expect(503);
    process.env.NODE_ENV = 'test';
  });

  test('never sends an HTTP recovery link to a remote host even outside production mode', async () => {
    process.env.PASSWORD_RESET_URL = 'http://example.com';
    await request(app).post('/forgot-password').send({ email }).expect(503);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('limits repeated IP requests independently of the email cooldown', async () => {
    for (let index = 0; index < 10; index += 1) {
      await request(app).post('/forgot-password').send({ email: `unknown${index}@example.com` }).expect(202);
    }
    await request(app).post('/forgot-password').send({ email: 'last@example.com' }).expect(429);
  });

  test('a delivery failure returns the same response and removes only its undelivered token', async () => {
    sendMail.mockRejectedValueOnce(new Error('Sensitive provider details and token must not be logged'));
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await request(app).post('/forgot-password').send({ email: 'unknown@example.com' }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect((await storedUser()).resetTokenHash).toBeUndefined();
    expect(errorLog.mock.calls).toEqual([['Password reset email delivery failed.']]);
  });

  test('an older delivery failure cannot erase a newer token', async () => {
    let rejectDelivery;
    sendMail.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDelivery = reject; }));
    await request(app).post('/forgot-password').send({ email }).expect(202);
    for (let attempt = 0; attempt < 100 && !rejectDelivery; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(rejectDelivery).toBeDefined();
    const newerHash = createHash('sha256').update('newer-issued-token').digest('hex');
    await User.updateOne({ email }, { $set: { resetTokenHash: newerHash } });
    rejectDelivery(new Error('Old delivery failed'));
    await waitForPendingPasswordResetMail();
    expect((await storedUser()).resetTokenHash).toBe(newerHash);
  });
});

describe('password replacement', () => {
  test('changes the password once, signs out old sessions, and sends a confirmation without automatic login', async () => {
    const login = await request(app).post('/login').send({ username: 'alice', password: oldPassword }).expect(200);
    const token = await issueToken();
    const userId = jwt.decode(login.body.accessToken).userId;
    const legacyToken = jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
    await request(app).get('/transactions').set('Authorization', `Bearer ${legacyToken}`).expect(200);
    const reset = await resetRequest(token).expect(200, {
      ok: true, message: 'Password updated. Sign in with your new password.'
    });
    expect(reset.body.accessToken).toBeUndefined();
    expect(reset.headers['set-cookie'][0]).toMatch(/refreshToken=;/);
    expect(await authenticates(oldPassword)).toBe(false);
    expect(await authenticates(newPassword)).toBe(true);
    await request(app).get('/transactions').set('Authorization', `Bearer ${login.body.accessToken}`).expect(401);
    await request(app).get('/transactions').set('Authorization', `Bearer ${legacyToken}`).expect(401);
    await request(app).post('/refresh').set('Cookie', login.headers['set-cookie']).expect(403);
    const nextLogin = await request(app).post('/login').send({ username: 'alice', password: newPassword }).expect(200);
    expect(jwt.decode(nextLogin.body.accessToken).tokenVersion).toBe(1);
    await request(app).get('/transactions').set('Authorization', `Bearer ${nextLogin.body.accessToken}`).expect(200);
    await resetRequest(token).expect(400, invalid);
    const user = await storedUser();
    expect(user.resetTokenHash).toBeUndefined();
    expect(user.resetTokenExpiresAt).toBeUndefined();
    await waitForPendingPasswordResetMail();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[1][0].subject).toBe('Your SpendSmart password was changed');
    expect(sendMail.mock.calls[1][0].text).not.toContain(token);
  });

  test('concurrent uses of one link yield exactly one password change', async () => {
    const token = await issueToken();
    const alternatives = ['first-new-password', 'second-new-password'];
    const responses = await Promise.all(alternatives.map(password => resetRequest(token, password)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    const winner = responses.findIndex(response => response.status === 200);
    expect(await authenticates(alternatives[winner])).toBe(true);
    expect(await authenticates(alternatives[1 - winner])).toBe(false);
    expect((await storedUser()).tokenVersion).toBe(1);
    await waitForPendingPasswordResetMail();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  test('an expired link cannot change the password', async () => {
    const token = await issueToken();
    await User.updateOne({ email }, { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } });
    await resetRequest(token).expect(400, invalid);
    expect(await authenticates(oldPassword)).toBe(true);
  });

  test.each(['bad-token', 'a'.repeat(64), { $ne: null }])('rejects an invalid token %#', async (token) => {
    await resetRequest(token).expect(400, invalid);
    expect(await authenticates(oldPassword)).toBe(true);
  });

  test.each([
    ['short password', 'short', 'short'],
    ['long password', 'a'.repeat(129), 'a'.repeat(129)],
    ['confirmation mismatch', newPassword, 'different-password']
  ])('rejects %s without consuming a valid link', async (_label, password, confirmation) => {
    const token = await issueToken();
    const before = await storedUser();
    await resetRequest(token, password, confirmation).expect(400);
    expect((await storedUser()).resetTokenHash).toBe(before.resetTokenHash);
    expect(await authenticates(oldPassword)).toBe(true);
    await resetRequest(token).expect(200);
  });

  test('a credential derivation failure does not consume the link', async () => {
    const token = await issueToken();
    const derive = jest.spyOn(User.prototype, 'setPassword').mockRejectedValueOnce(new Error('Derivation failed'));
    await resetRequest(token).expect(500);
    derive.mockRestore();
    expect((await storedUser()).resetTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    await resetRequest(token).expect(200);
  });

  test('requires password confirmation', async () => {
    const token = await issueToken();
    await request(app).post('/reset-password').send({ token, password: newPassword }).expect(400);
    expect(await authenticates(oldPassword)).toBe(true);
  });
});

describe('mail providers', () => {
  test.each([465, 587])('uses encrypted SMTP on port %s', async (port) => {
    process.env.SMTP_PORT = String(port);
    await issueToken();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      port, secure: port === 465, requireTLS: port === 587, tls: { minVersion: 'TLSv1.2' }
    }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('prefers the HTTPS provider and sends the token only in the email body', async () => {
    process.env.RESEND_API_KEY = 'test-only-api-key';
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer test-only-api-key', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal)
    }));
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toEqual([email]);
    tokenFromMessage(body);
  });

  test.each([401, 429, 500])('keeps provider HTTP %s failures private', async (status) => {
    process.env.RESEND_API_KEY = 'test-only-api-key';
    global.fetch.mockResolvedValueOnce({ ok: false, status });
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect((await storedUser()).resetTokenHash).toBeUndefined();
    expect(errorLog.mock.calls).toEqual([['Password reset email delivery failed.']]);
  });

  test('handles an HTTPS timeout without leaking details or retaining the unsent token', async () => {
    process.env.RESEND_API_KEY = 'test-only-api-key';
    global.fetch.mockRejectedValueOnce(new DOMException('Provider connection timed out', 'TimeoutError'));
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect((await storedUser()).resetTokenHash).toBeUndefined();
    expect(errorLog.mock.calls).toEqual([['Password reset email delivery failed.']]);
  });

  test('rejects a provider response without a delivery identifier', async () => {
    process.env.RESEND_API_KEY = 'test-only-api-key';
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await request(app).post('/forgot-password').send({ email }).expect(202, generic);
    await waitForPendingPasswordResetMail();
    expect((await storedUser()).resetTokenHash).toBeUndefined();
  });
});

describe('registration validation', () => {
  test.each(['/register', '/login', '/forgot-password', '/reset-password'])('rejects an empty %s request clearly', async (path) => {
    const response = await request(app).post(path).expect(400);
    expect(response.body.ok).toBe(false);
    expect(typeof response.body.message).toBe('string');
  });

  test.each([
    ['short password', { password: 'short' }],
    ['long password', { password: 'a'.repeat(129) }],
    ['invalid email', { email: 'not-an-email' }],
    ['invalid username', { username: 'bad user name' }],
    ['short username', { username: 'ab' }],
    ['non-string password', { password: { $gt: '' } }]
  ])('rejects %s before creating an account', async (_label, value) => {
    await request(app).post('/register').send({
      email: 'new@example.com', username: 'new-user', password: newPassword, ...value
    }).expect(400);
    expect(await User.countDocuments()).toBe(1);
  });

  test('normalizes email and returns clear duplicate errors', async () => {
    await request(app).post('/register').send({
      email: '  NEW@EXAMPLE.COM ', username: 'new-user', password: newPassword
    }).expect(201);
    expect(await User.findOne({ email: 'new@example.com' })).not.toBeNull();
    await request(app).post('/register').send({ email: 'ALICE@EXAMPLE.COM', username: 'different', password: newPassword }).expect(409);
    await request(app).post('/register').send({ email: 'other@example.com', username: 'alice', password: newPassword }).expect(409);
  });
});
