import { useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AppShell } from './components/AppShell';
import { AuthScreen } from './components/AuthScreen';
import { useAuth } from './hooks/useAuth';
import { useToast } from './hooks/useToast';

export function App() {
  const { user, ready, sessionError } = useAuth();
  const { message, notify } = useToast();

  useEffect(() => {
    if (sessionError) notify(sessionError);
  }, [sessionError, notify]);

  if (!ready) {
    return (
      <div className="auth-page">
        <LoaderCircle className="spin" size={28} />
        <p>Comprobando tu sesión…</p>
      </div>
    );
  }
  if (!user) return <AuthScreen message={message} onError={notify} />;
  return <AppShell key={user.id} user={user} />;
}
