/** Colores de las notas libres. El id se guarda en `quick_notes.color`. */
export type NoteColor = { id: string; name: string; bg: string; ink: string };

export const noteColors: NoteColor[] = [
  { id: 'linen', name: 'Sin color', bg: '#fdfcf8', ink: '#9aa391' },
  { id: 'lemon', name: 'Limón', bg: '#fbf1c2', ink: '#b8962a' },
  { id: 'peach', name: 'Durazno', bg: '#fbe2d0', ink: '#c97a45' },
  { id: 'coral', name: 'Coral', bg: '#f8d8d3', ink: '#c2574a' },
  { id: 'rose', name: 'Rosa', bg: '#f5dde9', ink: '#b45c8a' },
  { id: 'lilac', name: 'Lila', bg: '#e8e0f5', ink: '#7c62b5' },
  { id: 'sky', name: 'Cielo', bg: '#dce8f6', ink: '#4f7fb5' },
  { id: 'mint', name: 'Menta', bg: '#d8eee5', ink: '#3f8f72' },
  { id: 'sage', name: 'Salvia', bg: '#e2edd8', ink: '#5f8247' },
  { id: 'sand', name: 'Arena', bg: '#eee4d4', ink: '#9a7a4c' },
  { id: 'stone', name: 'Piedra', bg: '#e7e8e3', ink: '#6f7468' },
];

const byId = new Map(noteColors.map((c) => [c.id, c]));
export const colorOf = (id: string | null | undefined) => byId.get(id ?? '') ?? noteColors[0];
