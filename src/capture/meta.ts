import {
  Banknote,
  BookMarked,
  Briefcase,
  Clapperboard,
  Contact,
  Gift,
  GraduationCap,
  Lightbulb,
  Link2,
  ListChecks,
  MapPin,
  MessageCircleQuestion,
  Network,
  PenLine,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Piece, PieceKind } from '../lib/capture';

export type PieceMeta = { icon: LucideIcon; color: string; soft: string };

export const pieceIcons: Record<PieceKind, PieceMeta> = {
  encuentro: { icon: Users, color: '#8a6fa8', soft: '#f0e9f6' },
  movimiento: { icon: Banknote, color: '#c0674a', soft: '#f9e9e2' },
  novedad: { icon: Sparkles, color: '#6b62b5', soft: '#eeebfa' },
  compromiso: { icon: ListChecks, color: '#c4705a', soft: '#f9e8e2' },
  conexion: { icon: Network, color: '#3c9186', soft: '#dff2ef' },
  aprendizaje: { icon: GraduationCap, color: '#3c9186', soft: '#dff2ef' },
  nota: { icon: PenLine, color: '#5f8247', soft: '#eaf1e0' },
  obra: { icon: Clapperboard, color: '#6b75b8', soft: '#e9ebf8' },
  idea: { icon: Lightbulb, color: '#c48a2a', soft: '#fbf1dc' },
  trabajo: { icon: Briefcase, color: '#4d7b9d', soft: '#e3eef6' },
  intercambio: { icon: Gift, color: '#c25683', soft: '#f8e5ee' },
  dato: { icon: Contact, color: '#9a6b45', soft: '#f5ebe1' },
  preguntar: { icon: MessageCircleQuestion, color: '#6b62b5', soft: '#eeebfa' },
  visita: { icon: MapPin, color: '#3c9186', soft: '#dff2ef' },
  enlace: { icon: Link2, color: '#5f8247', soft: '#eaf1e0' },
};

export const bookMeta: PieceMeta = { icon: BookMarked, color: '#b08843', soft: '#f8f0dd' };

export const metaOf = (p: Piece) =>
  p.kind === 'obra' && p.media === 'Libro' ? bookMeta : pieceIcons[p.kind];
