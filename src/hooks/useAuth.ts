import { useEffect, useState } from 'react';
import { supabase } from '../backend';
import type { AppUser } from '../data';

/**
 * Tu usuario tal como quedó guardado en este navegador. Sin conexión, la sesión vencida no se
 * puede renovar, pero sigue siendo tuya: la app abre con lo que hay en el teléfono (p. ej.
 * «Por leer» en Lecturas) y la renueva sola al volver la conexión.
 */
function storedUser(): AppUser | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as {
        user?: AppUser;
        refresh_token?: string;
      } | null;
      if (saved?.refresh_token && saved.user?.id) return saved.user;
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return null;
}

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    const offline = (error?: { name?: string } | null) =>
      !navigator.onLine || error?.name === 'AuthRetryableFetchError' ? storedUser() : null;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        const fallback = data.session ? null : offline(error);
        setUser(data.session?.user ?? fallback);
        if (error && !fallback) setSessionError(error.message);
        setReady(true);
      })
      .catch(() => {
        const fallback = offline({ name: 'AuthRetryableFetchError' });
        setUser(fallback);
        if (!fallback) setSessionError('No se pudo comprobar la sesión. Revisa tu conexión.');
        setReady(true);
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // La primera lectura la hace getSession (arriba): así, sin conexión, no se pierde la sesión.
      if (event === 'INITIAL_SESSION') return;
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { user, ready, sessionError };
}
