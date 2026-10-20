import { useState } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export default function Login({ onSwitch, onBack, onSuccess, onForgotPassword }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let res;
      try {
        res = await fetch(`${API}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(form),
        });
      } catch {
        setError('Could not connect to the sign-in service. Please try again shortly.');
        return;
      }

      const unavailable = 'The sign-in service is temporarily unavailable. Please try again shortly.';
      const unexpected = 'The sign-in service returned an unexpected response. Please try again.';
      let data;
      try {
        data = await res.json();
      } catch {
        setError(res.status >= 500 ? unavailable : unexpected);
        return;
      }

      if (!res.ok) {
        setError(res.status >= 500 ? unavailable : (
          typeof data?.message === 'string' && data.message ? data.message : 'Sign in failed. Please try again.'
        ));
        return;
      }

      if (data?.ok === false) {
        setError(typeof data.message === 'string' && data.message ? data.message : 'Sign in failed. Please try again.');
        return;
      }

      if (data?.ok !== true || typeof data.accessToken !== 'string' || !data.accessToken.trim()) {
        setError(unexpected);
        return;
      }

      // Authentication succeeds in memory; optional browser storage cannot block it.
      onSuccess(data.accessToken);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(to bottom, #020617, #0f172a, #1e1b4b)' }}>
      {/* Nav */}
      <nav className="px-6 h-16 flex items-center border-b border-white/5">
        <button onClick={onBack} className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">SpendSmart</span>
        </button>
      </nav>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-black/40">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm mb-7 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </button>

          <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
          <p className="text-slate-400 text-sm mb-8">Sign in to your SpendSmart account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
              <input
                id="login-username"
                type="text"
                name="username"
                value={form.username}
                onChange={handleChange}
                required
                placeholder="your username"
                className="w-full bg-slate-800 border border-white/10 text-white placeholder-slate-500 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                value={form.password}
                onChange={handleChange}
                required
                placeholder="••••••••"
                className="w-full bg-slate-800 border border-white/10 text-white placeholder-slate-500 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>

            {error && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20 mt-1"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-indigo-400 text-sm font-medium hover:text-indigo-300 transition-colors"
            >
              Forgot password?
            </button>
          </div>

          <p className="text-center text-sm text-slate-500 mt-7">
            Don't have an account?{' '}
            <button onClick={onSwitch} className="text-indigo-400 font-medium hover:text-indigo-300 transition-colors">
              Create one free
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
