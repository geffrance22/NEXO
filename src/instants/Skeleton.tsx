/**
 * Instantes que aún no llegan, con la forma de uno de verdad (foto, nombre, texto y, de vez en
 * cuando, una foto). Sirve para la primera carga, para el final del feed mientras se traen más y
 * como el punto que, al acercarse, pide la siguiente tanda.
 */
export function FeedSkeleton({
  rows = 3,
  label = 'Cargando instantes',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="ipn-skel" aria-hidden="true">
          <i />
          <span>
            <b />
            <b />
            <b />
            {k % 3 === 0 && <em />}
          </span>
        </div>
      ))}
    </div>
  );
}
