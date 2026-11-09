/** Entero al azar de 0 a n-1, con la misma probabilidad para todos (sin sesgo de módulo). */
export function randomBelow(n: number) {
  if (n < 2) return 0;
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) return Math.floor(Math.random() * n);
  // Se descarta el sobrante al final del rango para que ningún número pese más que otro.
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  do {
    webCrypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

/** `count` elementos distintos al azar, todos con la misma probabilidad de salir. */
export function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(randomBelow(pool.length), 1)[0]);
  return out;
}
