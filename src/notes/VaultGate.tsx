import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, Lock, ShieldCheck } from 'lucide-react';
import { useApp } from '../AppContext';
import { Sheet } from '../components/Sheet';
import { PIN_RE, type VaultStatus } from './vault';

/** Campo de PIN: solo números, con puntos grandes y separados. */
function PinField({
  value,
  onChange,
  label,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      className={'kp-pin' + (invalid ? ' invalid' : '')}
      type="password"
      inputMode="numeric"
      autoComplete="off"
      pattern="\d*"
      maxLength={8}
      aria-label={label}
      placeholder={label}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
    />
  );
}

/**
 * La puerta de la bóveda: crear el PIN la primera vez y pedirlo para abrirla. Se usa dentro del
 * lienzo y en una ventana (al mover una nota a la bóveda cerrada).
 */
export function VaultGate({
  status,
  onCreate,
  onUnlock,
  onReset,
}: {
  status: VaultStatus;
  onCreate: (pin: string) => Promise<string | null>;
  onUnlock: (pin: string) => Promise<string | null>;
  onReset: () => void;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setPin('');
    setAgain('');
    setError('');
  }, [status]);

  if (status === 'loading')
    return (
      <div className="kp-vault-gate">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  if (status === 'missing')
    return (
      <div className="kp-vault-gate">
        <span className="kp-vault-ico">
          <Lock size={22} />
        </span>
        <h3>La bóveda aún no está lista</h3>
        <p>
          Ejecuta <code>supabase/migrations/202611090007_notes_extras.sql</code> en el SQL Editor de
          Supabase para activarla.
        </p>
      </div>
    );

  const setup = status === 'none';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!PIN_RE.test(pin)) return setError('Usa de 4 a 8 números.');
    if (setup && pin !== again) return setError('Los dos PIN no coinciden.');
    setBusy(true);
    setError('');
    const problem = await (setup ? onCreate(pin) : onUnlock(pin));
    setBusy(false);
    if (problem) {
      setError(problem);
      setShake((s) => s + 1);
      setPin('');
      form.current?.querySelector('input')?.focus();
    }
  };

  return (
    <form className="kp-vault-gate" ref={form} onSubmit={(e) => void submit(e)}>
      <span className="kp-vault-ico">{setup ? <ShieldCheck size={22} /> : <Lock size={22} />}</span>
      <h3>{setup ? 'Crea tu bóveda' : 'Bóveda bloqueada'}</h3>
      <p>
        {setup
          ? 'Guarda aquí las notas privadas. Se cifran en este dispositivo con tu PIN antes de guardarse.'
          : 'Escribe tu PIN para ver tus notas privadas.'}
      </p>
      <div key={shake} className={'kp-pin-row' + (shake ? ' shake' : '')}>
        <PinField
          value={pin}
          onChange={(v) => {
            setPin(v);
            setError('');
          }}
          label={setup ? 'Nuevo PIN' : 'PIN'}
          autoFocus
          invalid={Boolean(error)}
        />
        {setup && (
          <PinField
            value={again}
            onChange={(v) => {
              setAgain(v);
              setError('');
            }}
            label="Repite el PIN"
            invalid={Boolean(error)}
          />
        )}
      </div>
      {error && (
        <small className="kp-vault-error" role="alert">
          {error}
        </small>
      )}
      <button type="submit" className="kp-vault-go" disabled={busy || pin.length < 4}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}
        {setup ? 'Crear bóveda' : 'Desbloquear'}
      </button>
      {setup ? (
        <small className="kp-vault-note">
          Si olvidas el PIN no hay forma de recuperar estas notas: nadie más lo conoce.
        </small>
      ) : (
        <button type="button" className="kp-vault-forgot" onClick={onReset}>
          ¿Olvidaste el PIN?
        </button>
      )}
    </form>
  );
}

/** La puerta de la bóveda en una ventana (p. ej. al mover una nota con la bóveda cerrada). */
export function VaultGateSheet({
  status,
  onCreate,
  onUnlock,
  onReset,
  onClose,
}: {
  status: VaultStatus;
  onCreate: (pin: string) => Promise<string | null>;
  onUnlock: (pin: string) => Promise<string | null>;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet label="Bóveda" className="kp-vault-sheet" onRequestClose={onClose}>
      <VaultGate status={status} onCreate={onCreate} onUnlock={onUnlock} onReset={onReset} />
    </Sheet>
  );
}

/** Cambiar el PIN: el actual y el nuevo dos veces. */
export function ChangePinSheet({
  onSave,
  onClose,
}: {
  onSave: (current: string, next: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { notify } = useApp();
  const [now, setNow] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!PIN_RE.test(next)) return setError('El nuevo PIN debe tener de 4 a 8 números.');
    if (next !== again) return setError('Los dos PIN nuevos no coinciden.');
    setBusy(true);
    const problem = await onSave(now, next);
    setBusy(false);
    if (problem) return setError(problem);
    notify('PIN cambiado.');
    onClose();
  };
  return (
    <Sheet label="Cambiar PIN" className="kp-vault-sheet" onRequestClose={() => !busy && onClose()}>
      <form className="kp-vault-gate" onSubmit={(e) => void submit(e)}>
        <span className="kp-vault-ico">
          <KeyRound size={22} />
        </span>
        <h3>Cambiar PIN</h3>
        <p>Tus notas se vuelven a cifrar con el PIN nuevo.</p>
        <div className="kp-pin-row">
          <PinField value={now} onChange={setNow} label="PIN actual" autoFocus />
          <PinField value={next} onChange={setNext} label="PIN nuevo" />
          <PinField value={again} onChange={setAgain} label="Repite el PIN nuevo" />
        </div>
        {error && (
          <small className="kp-vault-error" role="alert">
            {error}
          </small>
        )}
        <button type="submit" className="kp-vault-go" disabled={busy || now.length < 4}>
          {busy && <LoaderCircle size={15} className="spin" />}
          Guardar PIN
        </button>
        <button type="button" className="kp-vault-forgot" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      </form>
    </Sheet>
  );
}
