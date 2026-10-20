import { useState, useEffect, useCallback, useMemo } from 'react';
import { readStorage, writeStorage } from '../utils/storage';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const TODAY = new Date().toISOString().split('T')[0];
const EMPTY_FORM = { statements: '', amount: '', type: 'Expense', date: TODAY };
const INPUT = "w-full bg-slate-800 border border-white/10 text-white placeholder-slate-500 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";

// Convert any date value to a local YYYY-MM-DD string for safe comparison
const toLocalDate = (d) => new Date(d).toLocaleDateString('en-CA');

export default function Transactions({ accessToken, onLogout }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [modal, setModal]               = useState(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [deleteId, setDeleteId]         = useState(null);

  // Keep budget editing usable even when browser storage is unavailable.
  const [monthlyBudget, setMonthlyBudget] = useState(() => {
    const savedBudget = Number(readStorage('spendsmart_budget'));
    return Number.isFinite(savedBudget) && savedBudget > 0 ? savedBudget : 1000;
  });
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput]     = useState('');

  const saveBudget = () => {
    const v = Number(budgetInput);
    if (Number.isFinite(v) && v > 0) {
      setMonthlyBudget(v);
      writeStorage('spendsmart_budget', String(v));
    }
    setEditingBudget(false);
  };

  // ── API helpers ──────────────────────────────────────────────
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const fetchTransactions = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API}/transactions`, { headers: authHeaders, credentials: 'include' });
      const data = await res.json();
      if (Array.isArray(data)) setTransactions(data);
      else setError(data.message || 'Failed to load transactions');
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const openAdd  = () => { setForm(EMPTY_FORM); setModal({ mode: 'add' }); };
  const openEdit = (tx) => {
    setForm({ statements: tx.statements, amount: String(tx.amount), type: tx.type, date: new Date(tx.date).toISOString().split('T')[0] });
    setModal({ mode: 'edit', tx });
  };
  const closeModal = () => { setModal(null); setForm(EMPTY_FORM); };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const body = { ...form, amount: parseFloat(form.amount) };
    try {
      const url = modal.mode === 'add' ? `${API}/transactions` : `${API}/transactions/${modal.tx._id}/edit`;
      const res = await fetch(url, { method: modal.mode === 'add' ? 'POST' : 'PUT', headers: authHeaders, credentials: 'include', body: JSON.stringify(body) });
      if (res.ok) { await fetchTransactions(); closeModal(); }
      else { const d = await res.json(); setError(d.message || 'Save failed'); }
    } catch { setError('Could not reach server'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      const res = await fetch(`${API}/transactions/${id}`, { method: 'DELETE', headers: authHeaders, credentials: 'include' });
      if (res.ok) setTransactions((prev) => prev.filter((t) => t._id !== id));
      else { const d = await res.json(); setError(d.message || 'Delete failed'); }
    } catch { setError('Could not reach server'); }
    finally { setDeleteId(null); }
  };

  // ── Dashboard computations ───────────────────────────────────
  const monthlySpent = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return transactions
      .filter((t) => t.type === 'Expense' && toLocalDate(t.date).startsWith(prefix))
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions]);

  const lastMonthSpent = useMemo(() => {
    const now = new Date();
    const d   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return transactions
      .filter((t) => t.type === 'Expense' && toLocalDate(t.date).startsWith(prefix))
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions]);

  const monthlyChange = lastMonthSpent > 0
    ? Math.round(((monthlySpent - lastMonthSpent) / lastMonthSpent) * 100)
    : null;

  const budgetRemaining = Math.max(monthlyBudget - monthlySpent, 0);
  const budgetPercent   = Math.min(Math.round((monthlySpent / monthlyBudget) * 100), 100);
  const barColor = budgetPercent >= 90 ? 'bg-red-500' : budgetPercent >= 70 ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500';

  // Last 7 days spending
  const weekData = useMemo(() => {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toLocaleDateString('en-CA');
      const isToday = i === 6;
      const total = transactions
        .filter((t) => t.type === 'Expense' && toLocalDate(t.date) === dateStr)
        .reduce((s, t) => s + t.amount, 0);
      return { label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()], total, isToday };
    });
  }, [transactions]);

  const maxBar = Math.max(...weekData.map((d) => d.total), 1);

  // 4 most recent transactions
  const recentTx = useMemo(() =>
    [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4),
  [transactions]);

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="bg-slate-950/80 backdrop-blur-md border-b border-white/5 px-6 h-16 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">SpendSmart</span>
        </div>
        <button
          onClick={onLogout}
          className="text-sm text-slate-400 hover:text-white transition-colors font-medium flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Logout
        </button>
      </header>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Your spending at a glance</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* ── Dashboard grid (matches landing page mockup) ─────── */}
        <div className="grid grid-cols-3 gap-4 mb-10">

          {/* Total Spent */}
          <div className="col-span-1 bg-slate-900 rounded-xl p-5 border border-white/5">
            <p className="text-slate-400 text-xs font-medium mb-1">Total Spent</p>
            <p className="text-white text-2xl font-bold">${monthlySpent.toFixed(0)}</p>
            {monthlyChange !== null ? (
              <p className={`text-xs mt-1.5 flex items-center gap-1 ${monthlyChange <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                <span>{monthlyChange <= 0 ? '↓' : '↑'} {Math.abs(monthlyChange)}%</span>
                <span className="text-slate-500">vs last month</span>
              </p>
            ) : (
              <p className="text-slate-500 text-xs mt-1.5">This month</p>
            )}
          </div>

          {/* Monthly Budget */}
          <div className="col-span-2 bg-slate-900 rounded-xl p-5 border border-white/5">
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-slate-400 text-xs font-medium mb-0.5">Monthly Budget</p>
                {editingBudget ? (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-slate-400 text-sm">$</span>
                    <input
                      autoFocus
                      type="number"
                      min="1"
                      step="1"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveBudget(); if (e.key === 'Escape') setEditingBudget(false); }}
                      className="w-24 bg-slate-800 border border-white/10 text-white rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button onClick={saveBudget} className="text-indigo-400 text-xs font-medium hover:text-indigo-300">Save</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-white text-lg font-bold">${budgetRemaining.toFixed(0)} left</p>
                    <button
                      onClick={() => { setBudgetInput(String(monthlyBudget)); setEditingBudget(true); }}
                      className="text-slate-600 hover:text-slate-400 transition-colors"
                      title="Edit budget"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${budgetPercent >= 90 ? 'text-red-400 bg-red-500/10' : budgetPercent >= 70 ? 'text-amber-400 bg-amber-500/10' : 'text-indigo-400 bg-indigo-500/10'}`}>
                {budgetPercent}%
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${budgetPercent}%` }}></div>
            </div>
            <p className="text-slate-500 text-xs mt-2">of ${monthlyBudget.toLocaleString()} budget</p>
          </div>

          {/* Weekly Spending chart */}
          <div className="col-span-2 bg-slate-900 rounded-xl p-5 border border-white/5">
            <p className="text-slate-400 text-xs font-medium mb-4">Weekly Spending</p>
            <div className="flex items-end gap-1.5 h-24">
              {weekData.map((bar, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  {bar.total > 0 ? (
                    <div
                      className={`w-full rounded-t ${bar.isToday ? 'bg-indigo-500' : 'bg-indigo-500/30'}`}
                      style={{ height: `${Math.max((bar.total / maxBar) * 100, 8)}%` }}
                    />
                  ) : (
                    <div className="w-full rounded-t bg-slate-700/50" style={{ height: '4%' }} />
                  )}
                  <span className={`text-xs ${bar.isToday ? 'text-indigo-400 font-semibold' : 'text-slate-500'}`}>
                    {bar.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="col-span-1 bg-slate-900 rounded-xl p-5 border border-white/5">
            <p className="text-slate-400 text-xs font-medium mb-4">Recent</p>
            {recentTx.length === 0 ? (
              <p className="text-slate-600 text-xs">No transactions yet</p>
            ) : (
              <div className="space-y-3">
                {recentTx.map((t) => (
                  <div key={t._id} className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${t.type === 'Income' ? 'bg-emerald-500/15' : 'bg-red-500/15'}`}>
                      <svg className={`w-3.5 h-3.5 ${t.type === 'Income' ? 'text-emerald-400' : 'text-red-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        {t.type === 'Income'
                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                          : <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                        }
                      </svg>
                    </div>
                    <p className="text-white text-xs font-medium flex-1 truncate">{t.statements}</p>
                    <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${t.type === 'Income' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.type === 'Income' ? '+' : '-'}${t.amount.toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>{/* end dashboard grid */}

        {/* ── All Transactions ─────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">All Transactions</p>
          <button
            onClick={openAdd}
            className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-500 transition-colors flex items-center gap-1.5 shadow-lg shadow-indigo-500/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        </div>

        {transactions.length === 0 ? (
          <div className="bg-slate-900 border border-dashed border-white/10 rounded-2xl py-20 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
              </svg>
            </div>
            <p className="text-slate-300 font-medium text-sm">No transactions yet</p>
            <p className="text-slate-500 text-sm mt-1 mb-5">Add your first one to start tracking</p>
            <button onClick={openAdd} className="bg-indigo-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-indigo-500 transition-colors">
              Add transaction
            </button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {transactions.map((t) => (
              <li
                key={t._id}
                className="bg-slate-900/60 border border-white/5 rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-white/10 transition-colors"
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${t.type === 'Income' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{t.statements}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {new Date(t.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {' · '}
                    <span className={t.type === 'Income' ? 'text-emerald-500' : 'text-red-500'}>{t.type}</span>
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-sm font-bold tabular-nums ${t.type === 'Income' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.type === 'Income' ? '+' : '-'}${t.amount.toFixed(2)}
                  </span>
                  <button onClick={() => openEdit(t)} title="Edit" className="text-slate-600 hover:text-slate-300 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button onClick={() => setDeleteId(t._id)} title="Delete" className="text-slate-600 hover:text-red-400 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* ── Add / Edit Modal ────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 px-4 pb-4 sm:pb-0">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold text-white">{modal.mode === 'add' ? 'New Transaction' : 'Edit Transaction'}</h2>
              <button onClick={closeModal} className="text-slate-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
                <input required autoFocus value={form.statements} onChange={(e) => setForm((f) => ({ ...f, statements: e.target.value }))} placeholder="e.g. Grocery shopping" className={INPUT} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Amount ($)</label>
                  <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={INPUT} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Type</label>
                  <div className="relative">
                    <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full appearance-none bg-slate-800 border border-white/10 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-8">
                      <option value="Expense" className="bg-slate-800">Expense</option>
                      <option value="Income" className="bg-slate-800">Income</option>
                    </select>
                    <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Date</label>
                <input required type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={`${INPUT} [color-scheme:dark]`} />
              </div>
              {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="flex-1 bg-white/5 border border-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-xl hover:bg-white/10 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-indigo-500 transition-colors disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirm ──────────────────────────────────────── */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl shadow-black/60">
            <div className="w-11 h-11 rounded-2xl bg-red-500/15 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-white mb-1.5">Delete transaction?</h2>
            <p className="text-sm text-slate-400 mb-6">This action can't be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 bg-white/5 border border-white/10 text-slate-300 text-sm font-medium py-2.5 rounded-xl hover:bg-white/10 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
