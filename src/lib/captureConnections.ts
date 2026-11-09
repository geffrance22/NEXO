import type { Person, Workspace } from '../data';
import type { ConnectionPiece, Piece } from './capture';
import { contentWords } from './captureMemory';
import { normalizeText, splitList } from './format';

/**
 * Conexiones por contexto compartido: si alguien de la experiencia necesita algo (busca
 * trabajo, está enfermo, monta un negocio…) y en tu universo hay quien podría ayudar por su
 * oficio, su empresa o sus intereses, o si comparte un gusto con alguien a quien no conoce, Nexo
 * lo propone. Son sugerencias: empiezan apagadas y dicen el motivo.
 */

type Need = { need: RegExp; helpers: RegExp; about: string };

const NEEDS: Need[] = [
  {
    need: /buscando (?:trabajo|empleo|chamba)|se quedo sin (?:trabajo|empleo)|(?:lo|la) despidieron|renuncio|quiere cambiar de trabajo/,
    helpers:
      /\b(recursos humanos|rrhh|talento humano|reclutador|reclutadora|headhunter|seleccion de personal|gerente|director|directora|jefe|jefa|ceo|fundador|fundadora|empresari)/,
    about: 'conseguir trabajo',
  },
  {
    need: /enferm|operaron|hospital|lesion|fractur|tratamiento|recuperando|dolor de|terapia/,
    helpers:
      /\b(medic|doctor|doctora|enfermer|fisioterap|psicolog|odontolog|nutricion|cirujan|pediatra|terapeuta)/,
    about: 'su salud',
  },
  {
    need: /estudiando|maestria|carrera|especializacion|universidad|tesis|beca|examen|doctorado/,
    helpers: /\b(profesor|profesora|docente|investigador|investigadora|academ|tutor|tutora|rector)/,
    about: 'sus estudios',
  },
  {
    need: /se mudo|se va a mudar|compro (?:casa|apartamento|apto)|buscando (?:apartamento|apto|casa|arriendo)/,
    helpers: /\b(inmobiliari|arquitect|abogad|notari|finca raiz|constructor|interiorista)/,
    about: 'la mudanza',
  },
  {
    need: /emprend|negocio|empresa propia|startup|tienda|su marca|monto su|abrio su|lanzo/,
    helpers:
      /\b(emprendedor|emprendedora|empresari|marketing|mercadeo|contador|contadora|abogad|disenador|disenadora|desarrollador|desarrolladora|programador|programadora|inversionista|ventas)/,
    about: 'su proyecto',
  },
  {
    need: /embarazada|va a ser (?:mama|papa)|tuvo (?:un|una) beb/,
    helpers: /\b(pediatra|ginecolog|obstetra|doula|partera)/,
    about: 'el bebé',
  },
];

/** Palabras de una novedad que no dicen en qué podría ayudar alguien. */
const GENERIC = new Set(
  (
    'trabajo empleo buscando busca consiguio empezo nuevo nueva nuevos esta estan anda sigue ' +
    'quiere tiene ahora mucho muchos poco tiempo semana meses vida casa familia porque bastante ' +
    'trabajar estudiar estudiando mudar mudarse'
  ).split(' '),
);

/** Lo que se sabe de una persona: oficio, empresa, intereses, palabras clave, bio. */
function profileText(p: Person) {
  const pr = p.profile;
  return normalizeText(
    [p.role, pr.occupation, pr.company, p.interests, (pr.keywords ?? []).join(' '), p.bio]
      .filter(Boolean)
      .join(' · '),
  );
}
const interestsOf = (p: Person) =>
  [...splitList(p.interests), ...(p.profile.likes ?? [])].map((x) => normalizeText(x.trim()));

/** Raíz corta para comparar «diseño» con «diseñadora», «fotografía» con «fotógrafo». */
const stem = (w: string) => w.slice(0, 5);

const firstName = (p: Person) => p.name.split(' ')[0];

export function suggestConnections(
  pieces: Piece[],
  ws: Workspace,
  /** Personas de la experiencia (para no sugerir a quien ya estaba). */
  present: string[],
  uid: () => string,
): ConnectionPiece[] {
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  const tied = (a: string, b: string) =>
    (ws.ties ?? []).some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
  const already = new Set(
    pieces
      .filter((p): p is ConnectionPiece => p.kind === 'conexion')
      .map((p) => [p.a, p.b].sort().join('|')),
  );
  const out: ConnectionPiece[] = [];
  const add = (a: string, b: string, text: string, evidence: string, hint: string) => {
    const key = [a, b].sort().join('|');
    if (a === b || already.has(key) || tied(a, b) || out.length >= 3) return;
    already.add(key);
    out.push({ id: uid(), kind: 'conexion', on: false, evidence, a, b, text, hint });
  };
  const candidates = ws.people.filter(
    (p) => p.profile.status !== 'memoria' && p.profile.status !== 'distante',
  );

  // 1. Una necesidad y alguien que por su oficio o sus intereses podría ayudar.
  for (const p of pieces) {
    if (p.kind !== 'novedad' || !byId.has(p.personId)) continue;
    const a = byId.get(p.personId)!;
    const text = normalizeText(p.text);
    const need = NEEDS.find((n) => n.need.test(text));
    const words = contentWords(p.text, 10)
      .filter((w) => w.length >= 5 && !GENERIC.has(w))
      .map(stem);
    let best: { person: Person; score: number; why: string } | null = null;
    for (const b of candidates) {
      if (b.id === a.id || present.includes(b.id)) continue;
      const info = profileText(b);
      if (!info) continue;
      let score = 0;
      let why = '';
      const role = need?.helpers.exec(info);
      if (role) {
        score += 2;
        why = b.profile.occupation || b.role || role[0];
      }
      const shared = words.filter((w) => info.split(/[^a-z0-9]+/).some((x) => x.startsWith(w)));
      if (shared.length) {
        score += Math.min(2, shared.length);
        why ||= b.profile.occupation || b.role || b.profile.company || 'sus intereses';
      }
      // Misma empresa o mismo sector que la novedad menciona.
      if (b.profile.company && text.includes(normalizeText(b.profile.company))) {
        score += 2;
        why = `trabaja en ${b.profile.company}`;
      }
      if (score >= 2 && (!best || score > best.score)) best = { person: b, score, why };
    }
    if (best) {
      const what = need ? need.about : p.text.charAt(0).toLowerCase() + p.text.slice(1);
      add(
        a.id,
        best.person.id,
        `${firstName(best.person)} podría ayudar a ${firstName(a)} con ${what}`.slice(0, 300),
        p.evidence,
        `Por ${best.why}`.slice(0, 120),
      );
    }
  }

  // 2. Un gusto compartido con alguien que no conoce.
  for (const p of pieces) {
    if (p.kind !== 'dato' || p.field !== 'likes' || !byId.has(p.personId)) continue;
    const a = byId.get(p.personId)!;
    const like = normalizeText(p.value.trim());
    const likeWords = contentWords(like, 4).filter((w) => w.length >= 4).map(stem);
    if (!likeWords.length) continue;
    const b = candidates.find(
      (b) =>
        b.id !== a.id &&
        !present.includes(b.id) &&
        interestsOf(b).some((i) => i === like || likeWords.some((w) => i.split(' ').some((x) => x.startsWith(w)))),
    );
    if (b)
      add(
        a.id,
        b.id,
        `A ${firstName(a)} y a ${firstName(b)} les gusta ${p.value.trim()}: podrías presentarlos`.slice(0, 300),
        p.evidence,
        'Gusto en común',
      );
  }
  return out;
}
