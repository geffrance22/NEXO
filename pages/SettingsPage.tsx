import { Download, Lock, Sparkles } from 'lucide-react';
import { useApp } from '../AppContext';
import { downloadWorkspace } from '../lib/export';

export function SettingsPage() {
  const { user, workspace, openChat, signOut } = useApp();

  return (
    <div className="settings-grid">
      <div className="panel">
        <Lock size={23} />
        <h2>Privacidad y cuenta</h2>
        <p>Sesión iniciada como {user.email}</p>
        <button className="secondary" onClick={signOut}>
          Cerrar sesión
        </button>
      </div>
      <div className="panel">
        <Download size={23} />
        <h2>Tus datos te pertenecen</h2>
        <p>
          Descarga una copia JSON de tus personas y apuntes. Los archivos adjuntos se descargan por
          separado.
        </p>
        <button className="secondary" onClick={() => downloadWorkspace(workspace)}>
          Exportar mis datos
        </button>
      </div>
      <div className="panel">
        <Sparkles size={23} />
        <h2>Inteligencia con contexto</h2>
        <p>
          Groq se conecta mediante una función privada. Configura GROQ_API_KEY y GROQ_MODEL en
          Supabase. La IA solo recibe los fragmentos recuperados para tu pregunta.
        </p>
        <button className="secondary" onClick={openChat}>
          Abrir asistente
        </button>
      </div>
    </div>
  );
}
