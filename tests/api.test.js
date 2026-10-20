const { randomBytes } = require('node:crypto');

// These credentials are generated for this process, never read from a real .env.
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = randomBytes(32).toString('hex');
process.env.REFRESH_TOKEN_SECRET = randomBytes(32).toString('hex');

const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../app');
const Transaction = require('../models/Transaction');

const payload = {
  statements: 'Groceries', amount: 25.5, type: 'Expense', date: '2026-10-20',
};
let database;
let alice;
let bob;
let aliceTransaction;
let bobTransaction;

async function registerAndLogin(username) {
  const password = 'test-only-password';
  await request(app).post('/register').send({
    username, password, email: `${username}@example.com`,
  }).expect(201);
  const response = await request(app).post('/login').send({ username, password }).expect(200);
  const token = response.body.accessToken;
  const { userId } = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  return { id: userId, token, cookie: response.headers['set-cookie'] };
}

beforeAll(async () => {
  expect(mongoose.connection.readyState).toBe(0);
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri(), { dbName: 'expense_tracker_test' });
  alice = await registerAndLogin('alice');
  bob = await registerAndLogin('bob');
});

beforeEach(async () => {
  await Transaction.deleteMany({});
  [aliceTransaction, bobTransaction] = await Transaction.create([
    { ...payload, owner: alice.id },
    { ...payload, statements: 'Bob private expense', amount: 70, owner: bob.id },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});

describe('authentication', () => {
  test('health endpoint is public', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toEqual({ ok: true });
  });

  test.each([
    ['alice', 'incorrect-password'],
    ['unknown-user', 'test-only-password'],
  ])('rejects invalid credentials for %s', async (username, password) => {
    await request(app).post('/login').send({ username, password }).expect(401);
  });

  test.each(['missing', 'malformed', 'expired'])('rejects a %s access token', async (kind) => {
    const auth = kind === 'expired'
      ? `Bearer ${jwt.sign({ userId: alice.id }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: -1 })}`
      : 'Bearer not-a-jwt';
    const call = request(app).get('/transactions');
    if (kind !== 'missing') call.set('Authorization', auth);
    await call.expect(401);
  });

  test.each([
    ['post', '/transactions'],
    ['get', '/transactions/id'],
    ['put', '/transactions/id/edit'],
    ['delete', '/transactions/id'],
  ])('%s %s requires authentication before accessing data', async (method, path) => {
    await request(app)[method](path).send(payload).expect(401);
  });

  test('refresh cookie issues a new valid access token', async () => {
    const response = await request(app).post('/refresh').set('Cookie', alice.cookie).expect(200);
    expect(jwt.verify(response.body.accessToken, process.env.ACCESS_TOKEN_SECRET).userId).toBe(alice.id);
  });

  test('refresh without a cookie is rejected', async () => {
    await request(app).post('/refresh').expect(401);
  });

  test('logout clears the refresh cookie', async () => {
    const response = await request(app).post('/logout').set('Cookie', alice.cookie).expect(200);
    expect(response.headers['set-cookie'][0]).toMatch(/refreshToken=;/);
  });
});

describe('transaction ownership', () => {
  test('creates a transaction owned by the authenticated user', async () => {
    const response = await request(app).post('/transactions')
      .set('Authorization', `Bearer ${alice.token}`).send(payload).expect(201);
    expect(response.body.owner).toBe(alice.id);
    expect((await Transaction.findById(response.body._id)).owner.toString()).toBe(alice.id);
  });

  test('does not accept an owner supplied by the client', async () => {
    await request(app).post('/transactions').set('Authorization', `Bearer ${alice.token}`)
      .send({ ...payload, owner: bob.id }).expect(400);
    expect(await Transaction.countDocuments()).toBe(2);
  });

  test('each list includes only that user’s records', async () => {
    for (const [user, transaction] of [[alice, aliceTransaction], [bob, bobTransaction]]) {
      const response = await request(app).get('/transactions')
        .set('Authorization', `Bearer ${user.token}`).expect(200);
      expect(response.body.map(item => item._id)).toEqual([transaction.id]);
    }
  });

  test.each([
    ['get', ''], ['put', '/edit'], ['delete', ''],
  ])('blocks another user’s %s and leaves their record unchanged', async (method, suffix) => {
    await request(app)[method](`/transactions/${aliceTransaction.id}${suffix}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ ...payload, statements: 'Unauthorized change', amount: 999 }).expect(403);
    const stored = await Transaction.findById(aliceTransaction.id);
    expect(stored).not.toBeNull();
    expect(stored.statements).toBe(payload.statements);
    expect(stored.amount).toBe(payload.amount);
    expect(stored.owner.toString()).toBe(alice.id);
  });

  test('owner can read, edit and delete a transaction', async () => {
    const path = `/transactions/${aliceTransaction.id}`;
    const auth = `Bearer ${alice.token}`;
    const read = await request(app).get(path).set('Authorization', auth).expect(200);
    expect(read.body._id).toBe(aliceTransaction.id);
    const edit = await request(app).put(`${path}/edit`).set('Authorization', auth)
      .send({ ...payload, statements: 'Updated groceries', amount: 30 }).expect(200);
    expect(edit.body.amount).toBe(30);
    expect((await Transaction.findById(aliceTransaction.id)).statements).toBe('Updated groceries');
    await request(app).delete(path).set('Authorization', auth).expect(200);
    expect(await Transaction.findById(aliceTransaction.id)).toBeNull();
    expect(await Transaction.findById(bobTransaction.id)).not.toBeNull();
  });

  test('filters and sorts without exposing another user’s records', async () => {
    const income = await Transaction.create({ ...payload, type: 'Income', amount: 100, owner: alice.id });
    const response = await request(app).get('/transactions?minAmount=50&sort=amount')
      .set('Authorization', `Bearer ${alice.token}`).expect(200);
    expect(response.body.map(item => item._id)).toEqual([income.id]);
  });
});

describe('transaction validation', () => {
  test.each([
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -1 }],
    ['invalid type', { type: 'Transfer' }],
    ['invalid date', { date: 'not-a-date' }],
    ['missing statement', { statements: '' }],
  ])('rejects %s on create and edit without changing stored data', async (_label, invalid) => {
    const body = { ...payload, ...invalid };
    await request(app).post('/transactions').set('Authorization', `Bearer ${alice.token}`)
      .send(body).expect(400);
    await request(app).put(`/transactions/${aliceTransaction.id}/edit`)
      .set('Authorization', `Bearer ${alice.token}`).send(body).expect(400);
    expect(await Transaction.countDocuments()).toBe(2);
    const stored = await Transaction.findById(aliceTransaction.id);
    expect(stored.amount).toBe(payload.amount);
    expect(stored.statements).toBe(payload.statements);
  });

  test.each([
    ['invalid-id', 400], [new mongoose.Types.ObjectId().toString(), 404],
  ])('handles transaction id %s with status %s', async (id, status) => {
    for (const [method, suffix] of [['get', ''], ['put', '/edit'], ['delete', '']]) {
      await request(app)[method](`/transactions/${id}${suffix}`)
        .set('Authorization', `Bearer ${alice.token}`).send(payload).expect(status);
    }
  });
});
