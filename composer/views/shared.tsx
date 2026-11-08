import { DocAttach } from '../PhotoBlocks';
import type { ComposerApi } from '../useComposer';

export type ViewProps = { c: ComposerApi };

/** Documento adjunto (PDF o texto). Solo aparece donde tiene sentido, o si el recuerdo ya tiene uno. */
export function DocBlock({ c }: ViewProps) {
  const show = ['Nota', 'Trabajo', 'Aprendizaje'].includes(c.kind) || Boolean(c.entry?.file_path);
  if (!show) return null;
  return (
    <DocAttach
      currentPath={c.entry?.file_path}
      removed={c.removeDoc}
      onRemoveCurrent={c.setRemoveDoc}
      file={c.docFile}
      onFile={c.setDocFile}
      notice={c.docNotice}
    />
  );
}
