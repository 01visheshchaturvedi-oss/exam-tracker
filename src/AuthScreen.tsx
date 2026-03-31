import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, Eye, EyeOff, LogIn, UserPlus, ArrowLeft, Clock } from 'lucide-react';
import { useAuth } from './AuthContext';

type Mode = 'login' | 'register' | 'reset';

export default function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode]                   = useState<Mode>('login');
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [confirm, setConfirm]             = useState('');
  const [show, setShow]                   = useState(false);
  const [busy, setBusy]                   = useState(false);
  const [error, setError]                 = useState('');
  const [success, setSuccess]             = useState('');

  const go = async () => {
    setError(''); setSuccess('');
    if (!email.trim()) { setError('Email is required'); return; }
    if (mode !== 'reset' && !password) { setError('Password is required'); return; }
    if (mode === 'register' && password !== confirm) { setError('Passwords do not match'); return; }
    if (mode === 'register' && password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setBusy(true);
    try {
      if (mode === 'login')    await signIn(email.trim(), password);
      if (mode === 'register') await signUp(email.trim(), password);
      if (mode === 'reset') {
        await resetPassword(email.trim());
        setSuccess('Reset email sent — check your inbox.');
        setMode('login');
      }
    } catch (e: any) {
      const raw = (e?.code ?? '').replace('auth/', '').replaceAll('-', ' ');
      setError(raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Something went wrong');
    } finally { setBusy(false); }
  };

  const sw = (m: Mode) => { setMode(m); setError(''); setSuccess(''); };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white font-sans flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm mb-3 text-center text-[10px] font-mono text-white/20 tracking-wide">
        Author © Vishesh.chaturvedi&nbsp;|&nbsp;All rights reserved&nbsp;|&nbsp;App version: 2.5
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-7 justify-center">
          <div className="w-11 h-11 bg-red-600 rounded-xl flex items-center justify-center shadow-[0_0_25px_rgba(220,38,38,0.4)]">
            <Clock className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-2xl tracking-tight">ExamRigor</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">Personal Study OS</p>
          </div>
        </div>

        <div className="bg-[#1c1d21] border border-white/10 rounded-2xl p-7 shadow-2xl">
          <AnimatePresence mode="wait">
            {/* ── Login ─────────────────── */}
            {mode === 'login' && (
              <motion.div key="login" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold">Sign In</h2>
                  <p className="text-white/40 text-xs mt-0.5 font-mono">Data syncs across all your devices</p>
                </div>
                <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" onEnter={go} icon={<Mail className="w-4 h-4 text-white/20"/>} />
                <PwField value={password} onChange={setPassword} show={show} toggle={() => setShow(!show)} onEnter={go} />
                {error && <Err msg={error} />}
                {success && <Ok msg={success} />}
                <Btn label="Sign In" icon={<LogIn className="w-4 h-4"/>} busy={busy} onClick={go} color="red" />
                <div className="flex items-center justify-between text-xs text-white/40">
                  <button onClick={() => sw('register')} className="hover:text-white transition-colors">Create account</button>
                  <button onClick={() => sw('reset')} className="hover:text-white transition-colors">Forgot password?</button>
                </div>
              </motion.div>
            )}

            {/* ── Register ──────────────── */}
            {mode === 'register' && (
              <motion.div key="register" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <BackHeader title="Create Account" sub="Free forever · syncs everywhere" onBack={() => sw('login')} />
                <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" onEnter={go} icon={<Mail className="w-4 h-4 text-white/20"/>} />
                <PwField value={password} onChange={setPassword} show={show} toggle={() => setShow(!show)} placeholder="Password (min 6 chars)" onEnter={go} />
                <PwField value={confirm} onChange={setConfirm} show={show} toggle={() => setShow(!show)} placeholder="Confirm password" onEnter={go} />
                {error && <Err msg={error} />}
                <Btn label="Create Account" icon={<UserPlus className="w-4 h-4"/>} busy={busy} onClick={go} color="red" />
              </motion.div>
            )}

            {/* ── Reset ─────────────────── */}
            {mode === 'reset' && (
              <motion.div key="reset" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <BackHeader title="Reset Password" sub="We'll send a reset link to your email" onBack={() => sw('login')} />
                <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" onEnter={go} icon={<Mail className="w-4 h-4 text-white/20"/>} />
                {error && <Err msg={error} />}
                {success && <Ok msg={success} />}
                <Btn label="Send Reset Email" busy={busy} onClick={go} color="amber" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-[10px] font-mono text-white/20 mt-4">
          🔒 Your data is encrypted and stored securely on Firebase
        </p>
      </motion.div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function BackHeader({ title, sub, onBack }: { title: string; sub: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="text-white/40 hover:text-white transition-colors"><ArrowLeft className="w-4 h-4"/></button>
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-white/40 text-xs font-mono">{sub}</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type, placeholder, onEnter, icon }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; onEnter: () => void; icon?: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>}
        <input type={type ?? 'text'} autoComplete={type === 'email' ? 'email' : 'off'}
          className={`w-full bg-black/40 border border-white/10 rounded-xl py-3 ${icon ? 'pl-10' : 'pl-4'} pr-4 focus:outline-none focus:border-red-500/50 text-sm`}
          placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onEnter()} />
      </div>
    </div>
  );
}

function PwField({ value, onChange, show, toggle, placeholder = 'Password', onEnter }: { value: string; onChange: (v: string) => void; show: boolean; toggle: () => void; placeholder?: string; onEnter: () => void }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 font-mono">Password</label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
        <input type={show ? 'text' : 'password'} autoComplete="current-password"
          className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-10 focus:outline-none focus:border-red-500/50 text-sm"
          placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onEnter()} />
        <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
          {show ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
        </button>
      </div>
    </div>
  );
}

function Btn({ label, icon, busy, onClick, color }: { label: string; icon?: React.ReactNode; busy: boolean; onClick: () => void; color: 'red' | 'amber' }) {
  const cls = color === 'red'
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : 'bg-amber-500 hover:bg-amber-400 text-black';
  return (
    <button onClick={onClick} disabled={busy} className={`w-full font-bold py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all ${cls}`}>
      {busy ? <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/> : icon}
      {!busy && label}
    </button>
  );
}

function Err({ msg }: { msg: string }) {
  return <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-red-400 text-xs font-mono">{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  return <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 text-emerald-400 text-xs font-mono">{msg}</div>;
}
