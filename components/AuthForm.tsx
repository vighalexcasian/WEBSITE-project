'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export function AuthForm({ authError }: { authError?: string | null }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const result = mode === 'sign-up'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (result.error) throw result.error;
      if (mode === 'sign-up' && !result.data.session) {
        setMessage('Account created. Check your email to confirm your address, then sign in.');
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in');
    setMessage(null);
    setError(null);
  };

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand">investment tracker<span>.</span></div>
      <p className="auth-eyebrow">YOUR PRIVATE PORTFOLIO</p>
      <h1 id="auth-title">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="auth-description">{mode === 'sign-in' ? 'Sign in to securely access your portfolio.' : 'Sign up to start a private portfolio.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
        {authError && <p className="auth-feedback error" role="alert">{authError}</p>}
        {error && <p className="auth-feedback error" role="alert">{error}</p>}
        {message && <p className="auth-feedback success" role="status">{message}</p>}
        <button className="button-primary auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="auth-switch">{mode === 'sign-in' ? 'New to Northstar?' : 'Already have an account?'} <button type="button" onClick={switchMode}>{mode === 'sign-in' ? 'Create account' : 'Sign in'}</button></p>
    </section>
  </main>;
}
