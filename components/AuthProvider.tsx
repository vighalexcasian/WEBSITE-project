'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    let client: SupabaseClient;

    try {
      client = getSupabaseClient();
    } catch (clientError) {
      setError(clientError instanceof Error ? clientError.message : 'Supabase is not configured.');
      setIsLoading(false);
      return;
    }

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      setUser(session?.user ?? null);
      setError(null);
      setIsLoading(false);
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || authEventReceived) return;
      if (sessionError) {
        setError(sessionError.message);
      } else {
        setUser(data.session?.user ?? null);
      }
      setIsLoading(false);
    }).catch((sessionError: unknown) => {
      if (!active || authEventReceived) return;
      setError(sessionError instanceof Error ? sessionError.message : 'Unable to restore your session.');
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, isLoading, error }), [user, isLoading, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
