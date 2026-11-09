import { expenseCategories, incomeCategories } from '../composer/logic';
import type { Direction, Entry, PlaceKind } from '../data';
import { contentWords, learnedCategory, readMemory, type CaptureMemory } from './captureMemory';
import { normalizeText } from './format';

/**
 * Categoría de un gasto o un ingreso según el contexto, no solo por palabras sueltas. Suma
 * señales con distinto peso:
 *  - lo que dice junto al monto (pesa más) y lo que dice el resto de la frase y del texto;
 *  - comercios y servicios conocidos (Rappi, Uber, Netflix, Platzi, EPM…);
 *  - la actividad del encuentro (un almuerzo) y el tipo de lugar (un café, un bar);
 *  - lo que aprendió de tus correcciones y cómo categorizaste antes movimientos parecidos.
 */

export type CategoryGuess = { category: string; why: string };

type Lex = [RegExp, string, number];

const OUT: Lex[] = [
  [
    /\b(almuerz|almorc|comida|cena\b|cene|cenamos|desayun|cafe|tinto|restaurante|pizza|hamburguesa|empanada|arepa|helado|postre|sushi|asado|onces|brunch|domicilio|mercado|supermercado|panaderia|fruta|verdura|comestibles)/,
    'Comida',
    3,
  ],
  [
    /\b(rappi|ifood|d1\b|ara\b|exito|carulla|jumbo|olimpica|makro|oxxo|justo y bueno|isimo|crepes|frisby|kfc|mcdonald|starbucks|juan valdez|tostao|el corral)/,
    'Comida',
    3,
  ],
  [
    /\b(taxi|uber|didi|cabify|indrive|picap|bus\b|buseta|transmilenio|sitp|metro\b|gasolina|tanqueo|peaje|parqueadero|parqueo|vuelo|tiquete|pasaje|transporte|avianca|latam|wingo|jetsmart|moto|bicicleta|scooter|llanta|taller mecanico|lavada del carro|soat|tecnomecanica)/,
    'Transporte',
    3,
  ],
  [
    /\b(cine|concierto|bar\b|discoteca|rumba|fiesta|entrada|boleta|boleteria|cerveza|trago|coctel|juego|videojuego|netflix|spotify|disney|hbo|prime video|youtube premium|playstation|xbox|steam|museo|teatro|parque de diversiones|paseo|viaje|hotel|airbnb|hostal|tour)/,
    'Ocio',
    3,
  ],
  [
    /\b(medic|farmacia|drogueria|cruz verde|farmatodo|locatel|consulta|examen|laboratorio|odontolog|dentista|terapia|psicolog|eps\b|copago|cita medica|medicamento|pastilla|vacuna|optica|gafas|gimnasio|gym|smart ?fit|bodytech)/,
    'Salud',
    3,
  ],
  [
    /\b(arriendo|alquiler|administracion|servicios|internet|luz\b|agua\b|gas\b|aseo|hogar|epm|enel|codensa|vanti|acueducto|claro|movistar|tigo|etb|wom\b|plan de datos|celular|mueble|colchon|electrodomestic|ferreteria|homecenter|easy\b|ikea|lavanderia|empleada|limpieza|mascota|veterinari|concentrado)/,
    'Hogar',
    3,
  ],
  [
    /\b(curso|libro|libreria|universidad|colegio|clase|matricula|semestre|pension|platzi|coursera|udemy|domestika|duolingo|diplomado|taller\b|seminario|certificacion|cuaderno|utiles|fotocopias)/,
    'Educación',
    3,
  ],
  [
    /\b(coworking|oficina|hosting|dominio|servidor|software|licencia|suscripcion de trabajo|herramienta|papeleria|impresion|cliente|proveedor|freelance|computador|portatil|monitor|teclado|aws|google workspace|figma|notion|chatgpt|canva|adobe|github)/,
    'Trabajo',
    3,
  ],
  [/\b(ahorro|ahorre|ahorrar|cdt|fiducuenta|bolsillo|alcancia|inversion|inverti|acciones|cripto|bitcoin|fondo)/, 'Ahorro', 3],
];

const IN: Lex[] = [
  [/\b(salario|sueldo|nomina|quincena|prima\b|bono|bonificacion|liquidacion|pago del trabajo)/, 'Salario', 3],
  [/\b(vendi|venta|vendimos|cliente|factura|honorarios|freelance|proyecto|cobre|cotizacion|pedido)/, 'Ventas', 3],
  [/\b(regalo|regalaron|me regalo|de cumpleanos|aguinaldo|detalle)/, 'Regalo', 3],
  [/\b(devolvio|devolvieron|reembolso|reintegro|me pago lo que|me pagaron lo que|lo que le preste|deuda)/, 'Reembolso', 3],
  [/\b(intereses|dividendos|rendimientos|cdt|acciones|cripto|arriendo que me pagan|inversion)/, 'Inversión', 3],
];

/** Frases de propósito: «para la casa», «para el trabajo». Pesan más que una palabra suelta. */
const PURPOSE: Lex[] = [
  [/\bpara (?:la casa|el apartamento|el apto|la cocina|el bano|la habitacion|el perro|el gato)\b/, 'Hogar', 4],
  [/\bpara (?:el trabajo|la oficina|un cliente|el cliente|el proyecto|la empresa)\b/, 'Trabajo', 4],
  [/\bpara (?:la universidad|la clase|el curso|el colegio|estudiar)\b/, 'Educación', 4],
  [/\bpara (?:el medico|la cita|la droga|el tratamiento|la terapia)\b/, 'Salud', 4],
  [/\bpara (?:el viaje|el paseo|la fiesta|el concierto)\b/, 'Ocio', 4],
];

const ACTIVITY_CAT: Record<string, [string, number]> = {
  Comida: ['Comida', 2],
  Café: ['Comida', 2],
  Fiesta: ['Ocio', 2],
  Paseo: ['Ocio', 1],
  Viaje: ['Ocio', 1],
  Deporte: ['Ocio', 1],
  Trabajo: ['Trabajo', 1],
};
const PLACE_CAT: Partial<Record<PlaceKind, [string, number]>> = {
  cafe: ['Comida', 2],
  comida: ['Comida', 2],
  bar: ['Ocio', 2],
  cultura: ['Ocio', 2],
  naturaleza: ['Ocio', 1],
  deporte: ['Ocio', 1],
  trabajo: ['Trabajo', 1],
};

/** Índice de palabras de tus movimientos ya categorizados (se calcula una vez por lista). */
const historyCache = new WeakMap<Entry[], Map<string, Map<string, number>>>();
function historyIndex(entries: Entry[]) {
  let index = historyCache.get(entries);
  if (index) return index;
  index = new Map();
  let seen = 0;
  for (const e of entries) {
    if (e.kind !== 'Movimiento') continue;
    const cat = e.tags.find(
      (t) => expenseCategories.includes(t) || incomeCategories.includes(t),
    );
    if (!cat || cat === 'Otro') continue;
    for (const w of contentWords(`${e.title} ${e.body}`, 8)) {
      let byCat = index.get(w);
      if (!byCat) index.set(w, (byCat = new Map()));
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    }
    if (++seen >= 400) break;
  }
  historyCache.set(entries, index);
  return index;
}

export function guessCategory(input: {
  /** Lo que sigue al monto («48.000 del almuerzo»): pesa más que todo. */
  near?: string;
  /** Lo que se dice antes del monto, en el mismo tramo («el taxi me costó…»). */
  local: string;
  /** La frase completa. */
  clause: string;
  /** Todo el texto. */
  whole: string;
  direction: Direction;
  activity?: string;
  placeKind?: PlaceKind | null;
  entries?: Entry[];
  memory?: CaptureMemory;
}): CategoryGuess {
  const income = input.direction === 'ingreso';
  const allowed = income ? incomeCategories : expenseCategories;
  const lex = income ? IN : OUT;
  const score = new Map<string, number>();
  const why = new Map<string, { w: number; text: string }>();
  const add = (cat: string, w: number, text: string) => {
    if (!allowed.includes(cat)) return;
    score.set(cat, (score.get(cat) ?? 0) + w);
    const cur = why.get(cat);
    if (!cur || w > cur.w) why.set(cat, { w, text });
  };

  const near = normalizeText(input.near ?? '');
  const local = normalizeText(input.local);
  const clause = normalizeText(input.clause);
  const whole = normalizeText(input.whole);
  for (const [re, cat, w] of [...(income ? [] : PURPOSE), ...lex]) {
    const x = near ? re.exec(near) : null;
    if (x) {
      add(cat, w * 3, `por «${input.near!.slice(x.index, x.index + x[0].length).trim()}»`);
      continue;
    }
    const l = re.exec(local);
    if (l) {
      add(cat, w * 2, `por «${input.local.slice(l.index, l.index + l[0].length).trim()}»`);
      continue;
    }
    const c = re.exec(clause);
    if (c) {
      add(cat, w, `por «${input.clause.slice(c.index, c.index + c[0].length).trim()}»`);
      continue;
    }
    if (re.test(whole)) add(cat, Math.max(1, w - 2), 'por el contexto');
  }

  if (!income) {
    const a = input.activity ? ACTIVITY_CAT[input.activity] : undefined;
    if (a) add(a[0], a[1], `porque fue ${input.activity!.toLowerCase()}`);
    const p = input.placeKind ? PLACE_CAT[input.placeKind] : undefined;
    if (p) add(p[0], p[1], 'por el lugar');
  }

  // Lo que aprendió de ti: tus correcciones mandan.
  const words = contentWords(`${input.near ?? ''} ${input.local}`, 6);
  const learned = learnedCategory(words, allowed, input.memory ?? readMemory());
  if (learned) add(learned.category, 2 + learned.weight, `como la última vez con «${learned.word}»`);

  // Movimientos parecidos que ya categorizaste.
  if (input.entries?.length) {
    const index = historyIndex(input.entries);
    for (const w of words) {
      const byCat = index.get(w);
      if (!byCat) continue;
      const [cat, n] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      const total = [...byCat.values()].reduce((s, x) => s + x, 0);
      if (n >= 2 && n / total >= 0.6) add(cat, Math.min(4, n), `como tus movimientos con «${w}»`);
    }
  }

  const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return { category: 'Otro', why: '' };
  return { category: best[0], why: why.get(best[0])?.text ?? '' };
}
