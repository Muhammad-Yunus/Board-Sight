import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, Mail, User, ShieldCheck } from 'lucide-react';
import { BrandLogo } from './BrandLogo.tsx';
import { setStoredAuthToken } from '../lib/api.ts';
import type { AuthUser } from '../types/boardsight.ts';

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'Operator' | 'QA Engineer' | 'Admin'>('Operator');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login' ? { email, password } : { name, email, password, role };

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed.');
        setLoading(false);
        return;
      }

      if (data.token) {
        setStoredAuthToken(data.token);
      }
      onAuthenticated(data.user);
    } catch {
      setError('Unable to reach Board Sight authentication server.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[440px] bg-white border border-[#EAECEF] rounded-2xl shadow-[0_8px_32px_rgba(17,24,39,0.06)] p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#F2F7F3] flex items-center justify-center shrink-0">
            <BrandLogo size={26} />
          </div>
          <div>
            <h1 className="text-[19px] font-semibold text-[#111827] tracking-[-0.015em] leading-tight">
              Board Sight
            </h1>
            <p className="text-[12.5px] text-[#6B7280]">
              PCB &amp; Hardware Optical Inspection Console
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F4F6] rounded-lg mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 text-[12.5px] font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white text-[#111827] shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setEmail('');
              setPassword('');
              setError(null);
            }}
            className={`py-2 text-[12.5px] font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'bg-white text-[#111827] shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-[12px] font-medium text-[#374151] mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sarah Wijaya"
                  className="w-full pl-9 pr-3.5 py-2.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45] transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">
              {mode === 'login' ? 'Email or Username' : 'Work Email'}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={mode === 'login' ? 'text' : 'email'}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === 'login' ? 'email or username' : 'operator@company.com'}
                className="w-full pl-9 pr-3.5 py-2.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full pl-9 pr-10 py-2.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#4B5563]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-[12px] font-medium text-[#374151] mb-1.5">
                Inspection Role
              </label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as 'Operator' | 'QA Engineer' | 'Admin')
                  }
                  className="w-full pl-9 pr-3.5 py-2.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#229A45]"
                >
                  <option value="Operator">Operator</option>
                  <option value="QA Engineer">QA Engineer</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#5AC16D] hover:bg-[#49B05C] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            {loading
              ? 'Authenticating...'
              : mode === 'login'
              ? 'Sign In to Workspace'
              : 'Create Operator Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
