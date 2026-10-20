const request = require('supertest');
const app = require('../app');
const User = require('../models/user');

afterEach(() => jest.restoreAllMocks());

test('unexpected login failures return a safe service error without leaking internals', async () => {
  jest.spyOn(User, 'findByUsername').mockRejectedValueOnce(new Error('database password=not-real-secret'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).post('/login')
    .send({ username: 'alice', password: 'test-only-password' }).expect(500);
  expect(response.body).toEqual({
    ok: false, message: 'The server could not complete this request. Please try again shortly.',
  });
  expect(JSON.stringify(response.body)).not.toContain('not-real-secret');
  expect(JSON.stringify(log.mock.calls)).not.toContain('not-real-secret');
});

test('malformed JSON has a clear validation response', async () => {
  const response = await request(app).post('/login')
    .set('Content-Type', 'application/json').send('{ invalid-json').expect(400);
  expect(response.body).toEqual({ ok: false, message: 'The request body must be valid JSON.' });
});
