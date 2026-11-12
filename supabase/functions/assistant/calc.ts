/**
 * Cuentas exactas para las respuestas de la IA. El modelo no calcula (se equivoca en aritmética):
 * escribe cada operación (p. ej. «17*34») y aquí se resuelve con fracciones exactas (BigInt), sin
 * errores de redondeo. En la respuesta, `[[1]]`, `[[2]]`… se cambian por cada resultado.
 *
 * Admite + - * / ^ ( ), `%` (porcentaje: 15% = 0.15), `[[n]]` (un resultado anterior), las
 * constantes pi y e, y sqrt (raiz), abs, round(x, decimales), floor, ceil, min, max y mod.
 * Raíces no exactas y potencias con decimales salen aproximadas (y se marcan con «≈»).
 */

/** Fracción reducida n/d con d > 0. */
type Q = { n: bigint; d: bigint };
/** Exacto (fracción) o aproximado (number). */
type V = Q | number;
type Tok =
  | { t: "num"; v: Q }
  | { t: "ref"; k: number }
  | { t: "id"; s: string }
  | { t: "op"; s: string };

const LOCALE = "es-CO";
/** Cifras máximas de un número exacto: corta cuentas gigantes (p. ej. 9^9^9). */
const MAX_DIGITS = 2000;
const MAX_EXPR = 300;
const MAX_CALC = 20;
/** Decimales exactos que se muestran tal cual; más que eso se redondea a `ROUNDED`. */
const EXACT_PLACES = 10;
const ROUNDED = 6;

const babs = (x: bigint) => (x < 0n ? -x : x);
const digits = (x: bigint) => babs(x).toString().length;
const isQ = (v: V): v is Q => typeof v !== "number";

function gcd(a: bigint, b: bigint) {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function q(n: bigint, d = 1n): Q {
  if (d === 0n) throw new Error("división por cero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  if (g > 1n) {
    n /= g;
    d /= g;
  }
  if (n === 0n) d = 1n;
  if (digits(n) > MAX_DIGITS || digits(d) > MAX_DIGITS) throw new Error("número demasiado grande");
  return { n, d };
}

function num(v: V): number {
  if (!isQ(v)) return v;
  if (digits(v.n) < 16 && digits(v.d) < 16) return Number(v.n) / Number(v.d);
  // Con números enormes, Number(n) / Number(d) daría Infinity / Infinity.
  return Number((v.n * 10n ** 18n) / v.d) / 1e18;
}

function fl(x: number): V {
  if (!Number.isFinite(x)) throw new Error("resultado no válido");
  return x;
}

const add = (a: V, b: V): V =>
  isQ(a) && isQ(b) ? q(a.n * b.d + b.n * a.d, a.d * b.d) : fl(num(a) + num(b));
const sub = (a: V, b: V): V =>
  isQ(a) && isQ(b) ? q(a.n * b.d - b.n * a.d, a.d * b.d) : fl(num(a) - num(b));
const mul = (a: V, b: V): V =>
  isQ(a) && isQ(b) ? q(a.n * b.n, a.d * b.d) : fl(num(a) * num(b));
function div(a: V, b: V): V {
  if (isQ(b) ? b.n === 0n : b === 0) throw new Error("división por cero");
  return isQ(a) && isQ(b) ? q(a.n * b.d, a.d * b.n) : fl(num(a) / num(b));
}
function pow(a: V, b: V): V {
  if (isQ(a) && isQ(b) && b.d === 1n) {
    const k = babs(b.n);
    if (BigInt(Math.max(digits(a.n), digits(a.d))) * k <= BigInt(MAX_DIGITS)) {
      if (a.n === 0n && b.n < 0n) throw new Error("división por cero");
      const n = a.n ** k;
      const d = a.d ** k;
      return b.n < 0n ? q(d, n) : q(n, d);
    }
  }
  return fl(Math.pow(num(a), num(b)));
}
const cmp = (a: V, b: V) =>
  isQ(a) && isQ(b) ? Number(a.n * b.d - b.n * a.d) : num(a) - num(b);

function isqrt(n: bigint) {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
function sqrt(v: V): V {
  if (num(v) < 0) throw new Error("raíz de un número negativo");
  if (isQ(v)) {
    const a = isqrt(v.n);
    const b = isqrt(v.d);
    if (a * a === v.n && b * b === v.d) return q(a, b);
  }
  return fl(Math.sqrt(num(v)));
}
function floor(v: V): V {
  if (!isQ(v)) return Math.floor(v);
  return v.n >= 0n ? q(v.n / v.d) : q(-((-v.n + v.d - 1n) / v.d));
}
const neg = (v: V): V => (isQ(v) ? q(-v.n, v.d) : -v);
const ceil = (v: V): V => neg(floor(neg(v)));
/** Redondeo a `p` decimales; las mitades se alejan del cero (2,5 → 3). */
function round(v: V, p: number): V {
  if (!isQ(v)) return Math.round(v * 10 ** p) / 10 ** p;
  const s = 10n ** BigInt(p);
  const n = v.n * s;
  const r = (babs(n) * 2n + v.d) / (2n * v.d);
  return q(n < 0n ? -r : r, s);
}
function smallInt(v: V) {
  if (isQ(v) && v.d === 1n && v.n >= 0n && v.n <= 20n) return Number(v.n);
  throw new Error("los decimales de round van de 0 a 20");
}

const one = (f: (v: V) => V) => (a: V[]) => {
  if (a.length !== 1) throw new Error("esta función lleva un solo número");
  return f(a[0]);
};
const FNS: Record<string, (a: V[]) => V> = {
  sqrt: one(sqrt),
  raiz: one(sqrt),
  "raíz": one(sqrt),
  abs: one((v) => (isQ(v) ? q(babs(v.n), v.d) : Math.abs(v))),
  floor: one(floor),
  ceil: one(ceil),
  round: (a) => {
    if (a.length < 1 || a.length > 2) throw new Error("round(x) o round(x, decimales)");
    return round(a[0], a.length === 2 ? smallInt(a[1]) : 0);
  },
  min: (a) => {
    if (!a.length) throw new Error("min necesita números");
    return a.reduce((m, v) => (cmp(v, m) < 0 ? v : m));
  },
  max: (a) => {
    if (!a.length) throw new Error("max necesita números");
    return a.reduce((m, v) => (cmp(v, m) > 0 ? v : m));
  },
  mod: (a) => {
    if (a.length !== 2) throw new Error("mod(a, b)");
    return sub(a[0], mul(a[1], floor(div(a[0], a[1]))));
  },
};
const CONSTS: Record<string, V> = { pi: Math.PI, "π": Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const s = src
    .toLowerCase()
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^")
    // «17x34»: la x entre números es un por.
    .replace(/(\d)\s*x\s*(?=[\d(.])/g, "$1*");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\s+/))) {
      // Espacios: nada.
    } else if ((m = rest.match(/^\[\[\s*(\d+)\s*\]\]/))) {
      out.push({ t: "ref", k: Number(m[1]) });
    } else if ((m = rest.match(/^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d{1,4}))?/))) {
      const frac = m[2] ?? m[3] ?? "";
      const exp = Number(m[4] ?? 0);
      let n = BigInt((m[1] ?? "0") + frac);
      let d = 10n ** BigInt(frac.length);
      if (exp > 0) n *= 10n ** BigInt(exp);
      else if (exp < 0) d *= 10n ** BigInt(-exp);
      out.push({ t: "num", v: q(n, d) });
    } else if ((m = rest.match(/^[a-záéíóúñπ_]+/))) {
      out.push({ t: "id", s: m[0] });
    } else if ((m = rest.match(/^[-+*/^(),%]/))) {
      out.push({ t: "op", s: m[0] });
    } else throw new Error(`símbolo no válido «${rest[0]}»`);
    i += m[0].length;
  }
  return out;
}

/** Resuelve una operación. `prev`: resultados anteriores, para `[[n]]`. */
function evaluate(expr: string, prev: (V | null)[]): V {
  if (expr.length > MAX_EXPR) throw new Error("operación demasiado larga");
  const toks = tokenize(expr);
  let i = 0;
  let depth = 0;
  const isOp = (s: string) => {
    const t = toks[i];
    return t?.t === "op" && t.s === s;
  };
  const take = (s: string) => {
    if (!isOp(s)) throw new Error(`falta «${s}»`);
    i++;
  };

  const expression = (): V => {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const plus = isOp("+");
      i++;
      const r = term();
      v = plus ? add(v, r) : sub(v, r);
    }
    return v;
  };
  const term = (): V => {
    let v = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const times = isOp("*");
        i++;
        const r = unary();
        v = times ? mul(v, r) : div(v, r);
      } else if (isOp("(") || toks[i]?.t === "id") {
        // 2(3 + 4) o 2pi: multiplicación sin signo.
        v = mul(v, power());
      } else return v;
    }
  };
  const unary = (): V => {
    if (isOp("-")) {
      i++;
      return neg(unary());
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return power();
  };
  // -2^2 = -4 y 2^3^2 = 2^9, como en matemáticas.
  const power = (): V => {
    const base = postfix();
    if (!isOp("^")) return base;
    i++;
    return pow(base, unary());
  };
  const postfix = (): V => {
    let v = primary();
    while (isOp("%")) {
      i++;
      v = div(v, q(100n));
    }
    return v;
  };
  const primary = (): V => {
    const t = toks[i++];
    if (!t) throw new Error("operación incompleta");
    if (t.t === "num") return t.v;
    if (t.t === "ref") {
      const v = prev[t.k - 1];
      if (v == null) throw new Error(`[[${t.k}]] no tiene resultado`);
      return v;
    }
    if (t.t === "op" && t.s === "(") {
      if (++depth > 40) throw new Error("demasiados paréntesis");
      const v = expression();
      take(")");
      depth--;
      return v;
    }
    if (t.t === "id") {
      if (t.s in CONSTS && !isOp("(")) return CONSTS[t.s];
      const fn = FNS[t.s];
      if (!fn) throw new Error(`no conozco «${t.s}»`);
      take("(");
      const args: V[] = [];
      if (!isOp(")")) {
        args.push(expression());
        while (isOp(",")) {
          i++;
          args.push(expression());
        }
      }
      take(")");
      return fn(args);
    }
    throw new Error("operación no válida");
  };

  const v = expression();
  if (i < toks.length) throw new Error("sobra algo en la operación");
  return v;
}

const int = (n: bigint) => n.toLocaleString(LOCALE);

/** `v` con `p` decimales (redondeado), al estilo de Colombia: 1.234,5. */
function decimals(v: Q, p: number) {
  const s = 10n ** BigInt(p);
  const r = (babs(v.n) * s * 2n + v.d) / (2n * v.d);
  const frac = (r % s).toString().padStart(p, "0").replace(/0+$/, "");
  return (v.n < 0n && r !== 0n ? "-" : "") + int(r / s) + (frac ? "," + frac : "");
}

/** Un resultado para leerlo: exacto si cabe en 10 decimales; si no, redondeado y con «≈». */
export function formatValue(v: V): string {
  if (isQ(v)) {
    if (v.d === 1n) return int(v.n);
    // Un decimal finito solo tiene 2 y 5 en el denominador.
    let d = v.d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    const places = Math.max(twos, fives);
    if (d === 1n && places <= EXACT_PLACES) return decimals(v, places);
    const shown = decimals(v, ROUNDED);
    if (/^-?0$/.test(shown)) return "≈ " + num(v).toExponential(4).replace(".", ",");
    return "≈ " + shown;
  }
  if (Math.abs(v) < 1e15 && Math.abs(v - Math.round(v)) < 1e-9 * Math.max(1, Math.abs(v)))
    return int(BigInt(Math.round(v)));
  const shown = v.toLocaleString(LOCALE, { maximumFractionDigits: ROUNDED });
  if (/^-?0$/.test(shown)) return "≈ " + v.toExponential(4).replace(".", ",");
  return "≈ " + shown;
}

/**
 * Cambia cada `[[n]]` de `answer` por el resultado exacto de la operación n de `calc` (lista de
 * operaciones que escribió el modelo). Lo que no se pudo calcular se dice tal cual.
 */
export function fillCalc(answer: string, calc: unknown): string {
  const list = (Array.isArray(calc) ? calc : []).slice(0, MAX_CALC).map((c) =>
    typeof c === "string"
      ? c
      : c && typeof c === "object" && typeof (c as { expr?: unknown }).expr === "string"
        ? (c as { expr: string }).expr
        : "",
  );
  const values: (V | null)[] = [];
  const shown: string[] = [];
  for (const expr of list) {
    try {
      const v = evaluate(expr, values);
      values.push(v);
      shown.push(formatValue(v));
    } catch {
      values.push(null);
      shown.push(`(no pude calcular «${expr.trim().slice(0, 80)}»)`);
    }
  }
  return answer.replace(/\[\[\s*(\d+)\s*\]\]/g, (_, k) => shown[Number(k) - 1] ?? "?");
}
