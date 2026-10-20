import { useState } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const UNAVAILABLE = 'Password reset is temporarily unavailable. Please try again later.';
const UNEXPECTED = 'The password reset service returned an unexpected response. Please try again.';
const CONNECTION_ERROR = 'Could not connect to the password reset service. Check your connection and try again.';
const RESET_SENT = 'If an account matches that email, a reset link will be sent.';
const INVALID_LINK = 'This reset link is invalid or has expired. Request a new link.';
const inputClass = 'w-full bg-slate-800 border border-white/10 text-white placeholder-slate-500 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all';
const buttonClass = 'w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20 mt-1';

function RecoveryLayout({ title, description, onBack, children }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(to bottom, #020617, #0f172a, #1e1b4b)' }}>
      <nav className="px-6 h-16 flex items-center border-b border-white/5" aria-label="Password recovery navigation">
        <button type="button" onClick={onBack} className="flex items-center gap-2.5" aria-label="SpendSmart — back to sign in">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">SpendSmart</span>
        </button>
      </nav>
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-black/40">
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-7 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to sign in
          </button>
          <h1 className="text-2xl font-bold text-white mb-1">{title}</h1>
          <p className="text-slate-400 text-sm mb-8">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorMessage({ children }) {
  return <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{children}</div>;
}

function SuccessMessage({ children }) {
  return <div role="status" className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-xl px-4 py-3">{children}</div>;
}

async function recoveryRequest(path, payload) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: CONNECTION_ERROR };
  }

  // Gateway failures may return HTML or no body, rather than application JSON.
  if (response.status >= 500) return { error: UNAVAILABLE };

  try {
    return { response, data: await response.json() };
  } catch {
    return { error: UNEXPECTED };
  }
}

export function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const { response, data, error: requestError } = await recoveryRequest('/forgot-password', { email: normalizedEmail });
      if (requestError) {
        setError(requestError);
      } else if (response.ok && response.status === 202 && data?.ok === true) {
        // Always use the same message; never disclose whether the email is registered.
        setSent(true);
      } else if (response.status === 429) {
        setError('Too many password reset requests. Please try again later.');
      } else if (response.status === 400) {
        setError('Enter a valid email address.');
      } else {
        setError(UNEXPECTED);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <RecoveryLayout title="Reset your password" description="Enter your account email to request a password reset link." onBack={onBack}>
      {sent ? <SuccessMessage>{RESET_SENT}</SuccessMessage> : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="recovery-email" className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input id="recovery-email" type="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" className={inputClass} />
          </div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <button type="submit" disabled={loading} className={buttonClass}>{loading ? 'Sending link…' : 'Send reset link'}</button>
        </form>
      )}
    </RecoveryLayout>
  );
}

export function ResetPassword({ token, onBack, onRequestNewLink }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const validToken = typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading || !validToken) return;
    setError('');
    if (password.length < 12 || password.length > 128) {
      setError('Use a password between 12 and 128 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { response, data, error: requestError } = await recoveryRequest('/reset-password', { token, password, confirmPassword });
      if (requestError) {
        setError(requestError);
      } else if (response.ok && response.status === 200 && data?.ok === true) {
        setPassword('');
        setConfirmPassword('');
        setComplete(true);
      } else if (response.status === 400 && data?.ok === false && typeof data.message === 'string' && data.message) {
        setError(data.message);
        setLinkExpired(/reset link|expired|invalid token/i.test(data.message));
      } else if (response.status === 429) {
        setError('Too many password reset attempts. Please try again later.');
      } else {
        setError(UNEXPECTED);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <RecoveryLayout title="Choose a new password" description="Choose a new password for your SpendSmart account." onBack={onBack}>
      {complete ? <SuccessMessage>Password updated. Sign in with your new password.</SuccessMessage> : !validToken ? (
        <div className="space-y-4">
          <ErrorMessage>{INVALID_LINK}</ErrorMessage>
          <button type="button" onClick={onRequestNewLink} className={buttonClass}>Request a new link</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!linkExpired && <>
            <div>
              <label htmlFor="reset-password" className="block text-xs font-medium text-slate-400 mb-1.5">New password</label>
              <input id="reset-password" type="password" name="password" autoComplete="new-password" aria-describedby="reset-password-help" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
              <p id="reset-password-help" className="text-slate-500 text-xs mt-1.5">Use 12–128 characters.</p>
            </div>
            <div>
              <label htmlFor="reset-password-confirm" className="block text-xs font-medium text-slate-400 mb-1.5">Confirm new password</label>
              <input id="reset-password-confirm" type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={inputClass} />
            </div>
          </>}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {linkExpired ? <button type="button" onClick={onRequestNewLink} className={buttonClass}>Request a new link</button> : <button type="submit" disabled={loading} className={buttonClass}>{loading ? 'Updating password…' : 'Reset password'}</button>}
        </form>
      )}
    </RecoveryLayout>
  );
}
