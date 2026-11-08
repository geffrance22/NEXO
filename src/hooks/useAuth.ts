import { useEffect, useState } from 'react';
import { supabase } from '../backend';
import type { AppUser } from '../data';

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        setUser(data.session?.user ?? null);
        if (error) setSessionError(error.message);
        setReady(true);
      })
      .catch(() => {
        setSessionError('No se pudo comprobar la sesión. Revisa tu conexión.');
        setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { user, ready, sessionError };
}
