import type { Gender, Person } from '../data';
import { normalizeText } from './format';

/** Nombres frecuentes que no siguen la regla de la terminación. */
const FEMALE = new Set(
  (
    'isabel raquel carmen ines mercedes dolores pilar luz paz sol flor rocio consuelo amparo ' +
    'socorro rosario beatriz ruth rut esther ester miriam abigail belen soledad maribel marisol ' +
    'nicole ingrid astrid karen sharon jazmin yasmin gisel giselle noemi lizeth lisseth yamile ' +
    'leidy lady nancy wendy daisy shirley yuli yuly kelly milagros iris elizabeth lilibeth ' +
    'yaneth janeth jenny jennifer evelyn madeleine marilyn carol caren keren abril estefany ' +
    'estefani stephany nahomi naomi zoe chloe noelia cielo alba eloise rubi ruby yeimy yeimi ' +
    'tatiana johanna dayana diana luisa'
  ).split(' '),
);
const MALE = new Set(
  (
    'jose luca joshua nicola borja elias jonas tomas lucas matias dairo alonso ' +
    'jesus andres moises ruben ismael rafael miguel angel daniel gabriel samuel manuel abel ' +
    'joel noel isaac david jacob esteban sebastian julian adrian ivan christian cristian ' +
    'kevin brayan bryan steven stiven yeison jhon john freddy henry rudy andy jhony johnny ' +
    'william wilson nelson edison jefferson anderson harold richard robert oscar victor ' +
    'luis felix aldair jair yair omar oliver ali hernan german fabian juan'
  ).split(' '),
);

/** Palabras del rol que revelan el sexo («Su hermana», «Mamá de Ana»). */
const ROLE_F =
  /\b(mama|madre|mami|hermana|tia|abuela|hija|esposa|novia|prima|sobrina|nieta|suegra|nuera|cunada|amiga|jefa|socia|vecina|companera|senora|dona|doctora|profesora|ingeniera)\b/;
const ROLE_M =
  /\b(papa|padre|papi|hermano|tio|abuelo|hijo|esposo|novio|marido|primo|sobrino|nieto|suegro|yerno|cunado|jefe|socio|vecino|companero|senor|don|doctor|profesor|ingeniero)\b/;

/**
 * Sexo probable por el nombre de pila (y el rol, si lo dice). Devuelve null si no hay pistas
 * claras: en ese caso se escribe «padre/madre» hasta que lo indiques.
 */
export function guessGender(name: string, role = ''): Gender | null {
  const r = normalizeText(role);
  if (ROLE_F.test(r) && !ROLE_M.test(r)) return 'f';
  if (ROLE_M.test(r) && !ROLE_F.test(r)) return 'm';
  const first = normalizeText(name.trim().split(/\s+/)[0] ?? '').replace(/[^a-z]/g, '');
  if (first.length < 2) return null;
  // «José María» es hombre; «María José», mujer: manda el primer nombre.
  if (FEMALE.has(first)) return 'f';
  if (MALE.has(first)) return 'm';
  if (/a$/.test(first)) return 'f';
  if (/o$/.test(first)) return 'm';
  if (/(el|in|an|on|or|os|us|ar|er|ir|ur|ez|es|ix|ck|rd|rt|nd)$/.test(first)) return 'm';
  if (/(is|ys|th|ie|ee|ey|een)$/.test(first)) return 'f';
  return null;
}

/** El sexo indicado en la ficha o, si no, el que se deduce del nombre. */
export const genderOf = (p: Pick<Person, 'name' | 'role' | 'profile'> | null | undefined) =>
  p ? (p.profile.gender ?? guessGender(p.name, p.role)) : null;

export const genderLabels: Record<Gender, string> = { f: 'Mujer', m: 'Hombre' };
