import { useState } from 'react';
import { supabase } from '../backend';
import { ReaderDialog } from './ReaderDialog';
import { capture, publicLink } from './capture';
import { savePictures } from './media';
import './readings.css';
export function SaveLink({
  close,
  saved,
}: {
  close: () => void;
  saved: (article: { id: string; archived: boolean; folder: string }) => void;
}) {
  const [url, setUrl] = useState(''),
    [manual, setManual] = useState(''),
    [title, setTitle] = useState('');
  const [busy, work] = useState(false),
    [error, fail] = useState('');
  async function submit() {
    if (busy) return;
    work(true);
    fail('');
    try {
      await save();
    } catch (e) {
      fail((e as Error).message || 'No se pudo guardar el enlace.');
    } finally {
      work(false);
    }
  }
  async function save() {
    const link = publicLink(url.trim());
    const lookup = await supabase
      .from('readings')
      .select('id,archived,folder')
      .eq('url', link)
      .maybeSingle();
    if (lookup.error) throw lookup.error;
    const existing = lookup.data;
    if (existing) {
      saved(existing);
      return;
    }
    const snap = manual.trim()
      ? { title: title.trim() || new URL(link).hostname, content: manual.trim() }
      : await capture(link);
    const { data, error } = await supabase
      .from('readings')
      .insert({ url: link, ...snap, media: await savePictures(snap.content) })
      .select('id,archived,folder')
      .single();
    if (error) throw error;
    saved(data);
  }
  return (
    <ReaderDialog title="Guardar enlace" close={close} busy={busy}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Enlace público
          <input
            data-initial-focus
            placeholder="https://…"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <small>La captura envía el enlace a Jina Reader.</small>
        <details>
          <summary>Pegar texto manualmente</summary>
          <input
            aria-label="Título"
            placeholder="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            aria-label="Texto del artículo"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </details>
        <button disabled={busy}>{busy ? 'Guardando…' : 'Guardar artículo'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </ReaderDialog>
  );
}
