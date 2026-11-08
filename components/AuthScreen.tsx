import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, Mail } from 'lucide-react';
import { supabase } from '../backend';
import { errorMessage } from '../lib/format';

type AuthScreenProps = { message: string; onError: (message: string) => void };

export function AuthScreen({ message, onError }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [register, setRegister] = useState(false);
  const [notice, setNotice] = useState('');
  const [visible, setVisible] = useState(false);
  function mode(next: boolean) {
    if (next === register) return;
    setRegister(next);
    setVisible(false);
    setPassword('');
    setNotice('');
    onError('');
  }
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    onError('');
    try {
      setNotice('');
      const credentials = { email: email.trim(), password };
      if (register) {
        const { data, error } = await supabase.auth.signUp(credentials);
        if (error) throw error;
        if (!data.session) {
          setRegister(false);
          setNotice(
            'Revisa tu correo para confirmar el registro. Si ya tienes una cuenta, inicia sesión.',
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword(credentials);
        if (error) throw error;
      }
      setPassword('');
      setVisible(false);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark">n</span>nexo<span className="brand-dot">.</span>
        </div>
        <div className="auth-switch" role="group" aria-label="Acceso a Nexo">
          {[false, true].map((next) => (
            <button
              key={String(next)}
              disabled={busy}
              aria-pressed={register === next}
              onClick={() => mode(next)}
            >
              {next ? 'Crear cuenta' : 'Iniciar sesión'}
            </button>
          ))}
        </div>
        <h1>{register ? 'Crea tu espacio' : 'Bienvenido a Nexo'}</h1>
        <p>
          {register
            ? 'Usa tu correo para abrir tu espacio personal.'
            : 'Entra para retomar tus notas, lecturas y proyectos.'}
        </p>
        {notice && (
          <div className="auth-notice" role="status">
            <Mail size={18} />
            {notice}
          </div>
        )}
        <form onSubmit={submit}>
          <label htmlFor="auth-email">Correo electrónico</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
          />
          <label htmlFor="auth-password">Contraseña</label>
          <div className="auth-secret">
            <input
              id="auth-password"
              type={visible ? 'text' : 'password'}
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={register ? 8 : undefined}
              aria-describedby={register ? 'auth-rule' : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {register && <small id="auth-rule">Usa al menos 8 caracteres.</small>}
          {message && (
            <div className="auth-error" role="alert">
              {message}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            {register ? 'Crear mi cuenta' : 'Entrar a mi espacio'}
            {!busy && <ArrowRight size={17} />}
          </button>
        </form>
      </section>
    </div>
  );
}
