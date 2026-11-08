import type { Workspace } from '../data';

/** Descarga una copia JSON de personas y apuntes. Los adjuntos se descargan por separado. */
export function downloadWorkspace(workspace: Workspace) {
  const payload = { exported_at: new Date().toISOString(), ...workspace };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nexo-exportacion.json';
  a.click();
  URL.revokeObjectURL(url);
}
