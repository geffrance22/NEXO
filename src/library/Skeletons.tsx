import type { CSSProperties } from 'react';
import { MasonryGrid } from '../components/Masonry';
import type { ViewMode } from './shelf';

/**
 * Esqueletos de Libroteca: ocupan lo mismo que el contenido que reemplazan (mismas rejillas y
 * altos) para que, al llegar los datos, la página no salte. Son decorativos (`aria-hidden`).
 */

const Sk = ({
  w,
  h,
  r,
  className = '',
}: {
  w?: number | string;
  h?: number;
  r?: number;
  className?: string;
}) => (
  <i
    className={'lt-sk ' + className}
    style={{ width: w, height: h, borderRadius: r } as CSSProperties}
  />
);

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** Anchos que varían sin parecer al azar en cada render. */
const width = (i: number, base: number, spread: number) => `${base + ((i * 37) % spread)}%`;

export function StatsSkeleton() {
  return (
    <p className="lt-sk-stats" aria-hidden="true">
      <Sk className="line" w={70} />
      <Sk className="line" w={96} />
      <Sk className="line" w={84} />
    </p>
  );
}

function ToolbarSkeleton({ chips = 4 }: { chips?: number }) {
  return (
    <div className="lt-sk-toolbar">
      {range(chips).map((i) => (
        <Sk key={i} w={i === 0 ? 70 : 78 + ((i * 13) % 24)} />
      ))}
      <Sk w={96} r={9} className="end" />
    </div>
  );
}

function PosterCards() {
  return (
    <MasonryGrid
      items={range(10)}
      itemKey={String}
      min={190}
      max={5}
      gap={16}
      render={(i) => (
        <div className="lt-sk-poster">
          <Sk />
          <div>
            <Sk className="line" w={width(i, 55, 35)} h={13} />
            <Sk className="line" w="38%" h={10} />
            {i % 3 === 1 && (
              <>
                <Sk className="line" w="92%" h={9} />
                <Sk className="line" w="70%" h={9} />
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}

function Covers() {
  return (
    <div className="lt-covers">
      {range(24).map((i) => (
        <Sk key={i} r={8} className="lt-sk-cover" />
      ))}
    </div>
  );
}

function Rows({ n = 8, media = true }: { n?: number; media?: boolean }) {
  return (
    <ul className="lt-list">
      {range(n).map((i) => (
        <li key={i} className="lt-row">
          <span className="lt-row-open">
            <Sk w={34} h={media ? 50 : 34} r={media ? 6 : 10} />
            <span className="lt-row-main">
              <Sk className="line" w={width(i, 30, 30)} h={13} />
              <Sk className="line" w={width(i, 18, 20)} h={10} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Quotes() {
  return (
    <MasonryGrid
      items={range(9)}
      itemKey={String}
      min={260}
      max={3}
      gap={14}
      render={(i) => (
        <div className="lt-sk-quote">
          {range(2 + ((i * 5) % 4)).map((l, _, all) => (
            <Sk key={l} className="line" h={11} w={l === all.length - 1 ? '58%' : '100%'} />
          ))}
          <footer>
            <Sk w={22} h={32} r={4} />
            <span className="lt-sk-group" style={{ flex: 1, gap: 5 }}>
              <Sk className="line" w="50%" h={10} />
              <Sk className="line" w="32%" h={9} />
            </span>
          </footer>
        </div>
      )}
    />
  );
}

/** Lo que se ve en una pestaña mientras cargan tus datos. */
export function TabSkeleton({
  kind,
  view,
}: {
  kind: 'media' | 'plain' | 'quotes';
  view?: ViewMode;
}) {
  return (
    <div aria-hidden="true">
      {kind === 'quotes' ? (
        <>
          <div className="lt-sk-toolbar">
            <Sk className="line" w={150} />
          </div>
          <Quotes />
        </>
      ) : (
        <>
          <Sk className="line lt-sk-lead" w={260} h={13} />
          <ToolbarSkeleton />
          {view === 'lista' ? (
            <Rows media={kind === 'media'} />
          ) : view === 'portadas' ? (
            <Covers />
          ) : kind === 'media' ? (
            <PosterCards />
          ) : (
            <Rows media={false} />
          )}
        </>
      )}
    </div>
  );
}

/** Inicio mientras carga: «En curso», «Recientes» y «Colección» con sus mismas rejillas. */
export function InicioSkeleton() {
  return (
    <div className="lt-home" aria-hidden="true">
      <section>
        <Sk className="line lt-sk-h2" w={84} h={11} />
        <div className="lt-now">
          {range(3).map((i) => (
            <Sk key={i} h={88} r={16} />
          ))}
        </div>
      </section>
      <section>
        <Sk className="line lt-sk-h2" w={76} h={11} />
        <div className="lt-recent">
          {range(6).map((i) => (
            <Sk key={i} h={68} />
          ))}
        </div>
      </section>
      <section>
        <Sk className="line lt-sk-h2" w={80} h={11} />
        <div className="lt-secs">
          {range(3).map((i) => (
            <Sk key={i} h={210} r={18} />
          ))}
        </div>
      </section>
    </div>
  );
}
