import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected API request'));
});

afterEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function openLogin() {
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /sign in/i }));
}

function fillLogin() {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } });
}

test('opens sign-in and registration from the landing page and returns home', () => {
  render(<App />);

  openLogin();
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /back to home/i }));

  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /get started free/i }));
  expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /back to home/i }));

  expect(within(screen.getByRole('navigation')).getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('submits registration and sends the new user to sign in after success', async () => {
  jest.useFakeTimers();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true }) });
  render(<App />);
  openLogin();
  fireEvent.click(screen.getByRole('button', { name: /create one free/i }));

  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /create free account/i }));

  expect(await screen.findByText(/account created!/i)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(`${API}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', username: 'alice', password: 'correct-horse-battery' }),
  });

  act(() => {
    jest.advanceTimersByTime(1500);
  });
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
});

test('successful sign-in loads the dashboard using the issued access token', async () => {
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, accessToken: 'test-access-token' }) })
    .mockResolvedValueOnce({ json: async () => [] });
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenNthCalledWith(1, `${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username: 'alice', password: 'correct-horse-battery' }),
  });
  expect(global.fetch).toHaveBeenNthCalledWith(2, `${API}/transactions`, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token' },
    credentials: 'include',
  });
  expect(screen.queryByRole('heading', { name: /welcome back/i })).not.toBeInTheDocument();
});

test('rejected sign-in shows the server error without opening the dashboard', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ ok: false, message: 'Invalid credentials' }) });
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled());
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
  expect(localStorage.getItem('accessToken')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['SecurityError', 'QuotaExceededError'])(
  'sign-in, budget editing and logout still work when browser storage throws %s',
  async (errorName) => {
    const failStorage = () => { throw new DOMException('Storage unavailable', errorName); };
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(failStorage);
    if (errorName === 'SecurityError') {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(failStorage);
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(failStorage);
    }
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, accessToken: 'test-access-token' }) })
      .mockResolvedValueOnce({ json: async () => [] })
      .mockResolvedValueOnce({ json: async () => ({ ok: true }) });
    render(<App />);
    openLogin();
    fillLogin();
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('$1000 left')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit budget/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByText('$2500 left')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^logout$/i }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument());
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenLastCalledWith(`${API}/logout`, { method: 'POST', credentials: 'include' });
  },
);

test('connection failure has an actionable message and leaves sign-in usable', async () => {
  global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect to the sign-in service');
  expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
});

test('an HTML or empty gateway response is reported as service unavailability', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('Not JSON'); } });
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
});

test('a success body without an access token does not open the dashboard', async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('unexpected response');
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('a failed HTTP response cannot authenticate using a success-shaped body', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ ok: true, accessToken: 'untrusted-token' }) });
  render(<App />);
  openLogin();
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('forgot-password navigation opens recovery and returns to sign in', () => {
  render(<App />);
  openLogin();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in', exact: true }));
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a recovery link opens the password form and removes the token from the address bar', () => {
  window.history.replaceState(null, '', `/#reset-password?token=${'a'.repeat(64)}`);
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in', exact: true }));
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
});

test.each([
  ['connection', () => Promise.reject(new TypeError('Failed to fetch')), 'Could not connect to the registration service'],
  ['service', () => Promise.resolve({ ok: false, status: 503 }), 'Registration is temporarily unavailable'],
  ['duplicate email', () => Promise.resolve({ ok: false, status: 409, json: async () => ({ ok: false, message: 'Email is already in use.' }) }), 'Email is already in use.'],
  ['empty error response', () => Promise.resolve({ ok: false, status: 400, json: async () => null }), 'Registration failed'],
])('registration reports a clear %s error', async (_label, response, message) => {
  global.fetch.mockImplementationOnce(response);
  render(<App />);
  openLogin();
  fireEvent.click(screen.getByRole('button', { name: /create one free/i }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'alice@example.com' } });
  fillLogin();
  fireEvent.click(screen.getByRole('button', { name: /create free account/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: /create free account/i })).toBeEnabled();
  expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
});

test('opening a new reset link clears the previous expired-link state', async () => {
  window.history.replaceState(null, '', `/#reset-password?token=${'a'.repeat(64)}`);
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({
    ok: false, message: 'This reset link is invalid or has expired. Request a new link.',
  }) });
  render(<App />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-test-password' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();

  act(() => {
    window.history.replaceState(null, '', `/#reset-password?token=${'b'.repeat(64)}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(screen.getByLabelText('New password')).toHaveValue('');
  expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(window.location.hash).toBe('');
});
