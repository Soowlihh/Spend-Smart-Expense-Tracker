import { fireEvent, render, screen } from '@testing-library/react';
import { ForgotPassword, ResetPassword } from './PasswordRecovery';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const token = 'a'.repeat(64);
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function requestLink(email = 'alice@example.com') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

function enterNewPassword(password = 'correct-horse-battery', confirmation = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
}

test('requests a reset link and shows the same generic confirmation without exposing server details', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ ok: true, message: 'Account exists: alice@example.com' }) });
  render(<ForgotPassword onBack={jest.fn()} />);
  requestLink();

  expect(await screen.findByRole('status')).toHaveTextContent('If an account matches that email, a reset link will be sent.');
  expect(screen.queryByText(/account exists/i)).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(`${API}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com' }),
  });
});

test('reports unavailable email delivery without falsely confirming that an email was sent', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ ok: false, message: 'Email provider missing' }) });
  render(<ForgotPassword onBack={jest.fn()} />);
  requestLink();

  expect(await screen.findByRole('alert')).toHaveTextContent('Password reset is temporarily unavailable. Please try again later.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
});

test('a connection failure lets the user retry requesting a reset link', async () => {
  global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<ForgotPassword onBack={jest.fn()} />);
  requestLink();

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect to the password reset service. Check your connection and try again.');
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
});

test('an HTML gateway error is reported as temporary service unavailability', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('HTML'); } });
  render(<ForgotPassword onBack={jest.fn()} />);
  requestLink();

  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test.each([
  { ok: true, status: 202, json: async () => ({ message: 'Not a valid success response' }) },
  { ok: true, status: 202, json: async () => { throw new SyntaxError('Not JSON'); } },
])('does not show a reset confirmation for an invalid response', async (response) => {
  global.fetch.mockResolvedValueOnce(response);
  render(<ForgotPassword onBack={jest.fn()} />);
  requestLink();

  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('mismatched passwords do not reach the server', () => {
  render(<ResetPassword token={token} onBack={jest.fn()} onRequestNewLink={jest.fn()} />);
  enterNewPassword('correct-horse-battery', 'different-password');

  expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['short', 'a'.repeat(129)])('rejects passwords outside the allowed length without sending them', (password) => {
  render(<ResetPassword token={token} onBack={jest.fn()} onRequestNewLink={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: password } });
  fireEvent.submit(screen.getByRole('button', { name: 'Reset password' }).closest('form'));

  expect(screen.getByRole('alert')).toHaveTextContent('between 12 and 128 characters');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('updates the password and waits for the user to return to normal sign-in', async () => {
  const onBack = jest.fn();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
  render(<ResetPassword token={token} onBack={onBack} onRequestNewLink={jest.fn()} />);
  enterNewPassword();

  expect(await screen.findByRole('status')).toHaveTextContent('Password updated. Sign in with your new password.');
  expect(global.fetch).toHaveBeenCalledWith(`${API}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' }),
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('an expired reset token offers a new link instead of allowing another password submission', async () => {
  const onRequestNewLink = jest.fn();
  const message = 'This reset link is invalid or has expired. Request a new link.';
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ ok: false, message }) });
  render(<ResetPassword token={token} onBack={jest.fn()} onRequestNewLink={onRequestNewLink} />);
  enterNewPassword();

  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
  expect(onRequestNewLink).toHaveBeenCalledTimes(1);
});

test.each([undefined, 'invalid-token'])('a missing or malformed token offers recovery without sending a request', (invalidToken) => {
  const onRequestNewLink = jest.fn();
  render(<ResetPassword token={invalidToken} onBack={jest.fn()} onRequestNewLink={onRequestNewLink} />);

  expect(screen.getByRole('alert')).toHaveTextContent('This reset link is invalid or has expired.');
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
  expect(onRequestNewLink).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('password validation errors preserve the form so the user can correct their password', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ ok: false, message: 'Password must contain at least 12 characters.' }) });
  render(<ResetPassword token={token} onBack={jest.fn()} onRequestNewLink={jest.fn()} />);
  enterNewPassword();

  expect(await screen.findByRole('alert')).toHaveTextContent('Password must contain at least 12 characters.');
  expect(screen.getByLabelText('New password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reset password' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Request a new link' })).not.toBeInTheDocument();
});

test('a reset response without success confirmation never claims the password changed', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'not-a-reset-result' }) });
  render(<ResetPassword token={token} onBack={jest.fn()} onRequestNewLink={jest.fn()} />);
  enterNewPassword();

  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
