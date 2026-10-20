import { useState, useEffect, useRef } from 'react';
import Landing from './components/Landing';
import Login from './components/Login';
import Register from './components/Register';
import Transactions from './components/Transactions';
import { ForgotPassword, ResetPassword } from './components/PasswordRecovery';
import { removeStorage } from './utils/storage';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const REFRESH_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

function readResetLink() {
  const [route, query = ''] = window.location.hash.slice(1).split('?');
  return route === 'reset-password' ? new URLSearchParams(query).get('token') || '' : null;
}

function App() {
  const [resetToken, setResetToken] = useState(readResetLink);
  const [page, setPage] = useState(() => resetToken === null ? 'landing' : 'reset-password');
  const [accessToken, setAccessToken] = useState(null);
  const refreshTimer = useRef(null);

  useEffect(() => {
    const captureResetLink = () => {
      const token = readResetLink();
      if (token === null) return;
      setResetToken(token);
      setPage('reset-password');
      // Keep the recovery secret out of the address bar and subsequent links.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    captureResetLink();
    window.addEventListener('hashchange', captureResetLink);
    return () => window.removeEventListener('hashchange', captureResetLink);
  }, []);

  const handleLoginSuccess = (token) => {
    setAccessToken(token);
    setPage('transactions');
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // best-effort
    }
    clearInterval(refreshTimer.current);
    setAccessToken(null);
    removeStorage('accessToken');
    setPage('landing');
  };

  useEffect(() => {
    if (!accessToken) return;

    const refresh = async () => {
      try {
        const res = await fetch(`${API}/refresh`, { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (data.ok) {
          setAccessToken(data.accessToken);
        } else {
          // Refresh token invalid — send user back to landing
          setAccessToken(null);
          setPage('landing');
        }
      } catch {
        // Network error — leave user logged in and retry next interval
      }
    };

    refreshTimer.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(refreshTimer.current);
  }, [accessToken]);

  const showLogin = () => {
    setResetToken(null);
    setPage('login');
  };

  if (page === 'forgot-password') {
    return <ForgotPassword onBack={showLogin} />;
  }

  if (page === 'reset-password') {
    return <ResetPassword key={resetToken} token={resetToken} onBack={showLogin} onRequestNewLink={() => {
      setResetToken(null);
      setPage('forgot-password');
    }} />;
  }
  
  if (page === 'transactions') {
    return <Transactions accessToken={accessToken} onLogout={handleLogout} />;
  }

  if (page === 'landing') {
    return <Landing onLogin={() => setPage('login')} onRegister={() => setPage('register')} />;
  }

  if (page === 'login') {
    return (
      <Login
        onSwitch={() => setPage('register')}
        onBack={() => setPage('landing')}
        onSuccess={handleLoginSuccess}
        onForgotPassword={() => setPage('forgot-password')}
      />
    );
  }

  if (page === 'register') {
    return (
      <Register
        onSwitch={() => setPage('login')}
        onBack={() => setPage('landing')}
        onSuccess={() => setPage('login')}
      />
    );
  }

  return null;
}

export default App;
