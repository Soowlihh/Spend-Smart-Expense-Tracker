import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected API request'));
});

afterEach(() => {
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
  global.fetch.mockResolvedValueOnce({ json: async () => ({ ok: true }) });
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
    .mockResolvedValueOnce({ json: async () => ({ ok: true, accessToken: 'test-access-token' }) })
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
  global.fetch.mockResolvedValueOnce({ json: async () => ({ ok: false, message: 'Invalid credentials' }) });
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
