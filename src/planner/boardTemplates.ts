import type { BoardSpec, SpecCard, SpecColumn } from './boardStore';

/**
 * Plantillas de tablero que vienen con Nexo. Producción audiovisual: una base de siete fases y
 * cuatro variantes (XV años, photoshoot, boda y grabación musical) que le suman sus tarjetas.
 * Cada tarjeta trae su lista de verificación; las que van entre corchetes se duplican por pieza.
 */

export type BuiltinTemplate = {
  id: string;
  name: string;
  group: string;
  /** Una línea para la galería. */
  summary: string;
  /** Cómo se usa (se ve al elegirla). */
  guide: string[];
  /** Nombre sugerido: «Boda · » y el usuario completa cliente y fecha. */
  prefix: string;
  placeholder: string;
  /** Etiquetas sugeridas del flujo. */
  labels: string[];
  spec: BoardSpec;
};

const c = (title: string, checks: string[] = [], extra: Partial<SpecCard> = {}): SpecCard => ({
  title,
  checks,
  ...extra,
});

const LABELS = ['Foto', 'Video', 'Audio', 'Cliente', 'Urgente', 'Bloqueada'];

/** Columnas de la base audiovisual, en orden. */
const PHASES = [
  { name: '01 Encargo y alcance', color: 'blue' },
  { name: '02 Preproducción', color: 'purple' },
  { name: '03 Rodaje', color: 'red' },
  { name: '04 Selección y montaje', color: 'orange' },
  { name: '05 Revisión', color: 'yellow' },
  { name: '06 Entrega y archivo', color: 'teal' },
  { name: '07 Cerrado', color: 'green' },
];

const BASE: SpecCard[][] = [
  // 01 · Encargo y alcance
  [
    c('Ficha del trabajo', [
      'Cliente',
      'Contacto operativo',
      'Fecha',
      'Sedes',
      'Horarios',
      'Responsable de aprobación',
    ]),
    c('Brief creativo', [
      'Objetivo',
      'Público',
      'Referencias aprobadas',
      'Estilo',
      'Prioridades',
      'Cosas que evitar',
    ]),
    c('Alcance y presupuesto', [
      'Horas de cobertura',
      'Equipo humano',
      'Desplazamientos',
      'Entregables',
      'Extras',
      'Anticipo',
      'Saldo',
    ]),
    c(
      'Matriz de entregables',
      [
        'Nombre',
        'Cantidad o duración',
        'Formato',
        'Orientación',
        'Resolución',
        'Fecha',
        'Número de revisiones',
      ],
      { body: 'Una fila por pieza.' },
    ),
  ],
  // 02 · Preproducción
  [
    c('Hoja de llamado', [
      'Direcciones',
      'Accesos',
      'Estacionamiento',
      'Contactos',
      'Horarios de llegada',
      'Orden del día',
    ]),
    c('Plan de cobertura', [
      'Momento o toma',
      'Prioridad',
      'Cámara',
      'Operador',
      'Posición',
      'Audio',
      'Alternativa',
    ]),
    c('Locaciones y permisos', [
      'Visita previa',
      'Luz',
      'Ruido',
      'Energía',
      'Autorización de uso',
      'Restricciones de publicación',
    ]),
    c('Equipo y respaldo', [
      'Cámaras',
      'Lentes',
      'Iluminación',
      'Sonido',
      'Tarjetas',
      'Baterías cargadas',
      'Equipo de repuesto',
    ]),
    c('Plan B', [
      'Lluvia',
      'Retrasos',
      'Ausencia de una persona clave',
      'Fallo de cámara o sonido',
    ]),
    c(
      'Confirmación final con cliente y equipo',
      ['Versión de la agenda', 'Pendientes resueltos', 'Quién comunica cambios'],
      { tags: ['Cliente'] },
    ),
  ],
  // 03 · Rodaje
  [
    c('Montaje y prueba', [
      'Encuadre',
      'Exposición',
      'Balance de blancos',
      'Foco',
      'Prueba de audio con audífonos',
      'Sincronización',
    ]),
    c('Ejecutar cobertura prioritaria', [
      'Marcar tomas conseguidas',
      'Anotar tomas favoritas',
      'Anotar pendientes',
    ]),
    c('Cierre de jornada', [
      'Revisar la lista antes de desmontar',
      'Recoger el equipo',
      'Identificar tarjetas y grabadoras',
    ]),
  ],
  // 04 · Selección y montaje
  [
    c('Ingesta y dos copias verificadas', [
      'Organizar por fecha y cámara',
      'Cotejar archivos',
      'Abrir muestras',
      'Liberar tarjetas solo al verificar ambas copias',
    ]),
    c('Selección', [
      'Marcar favoritas',
      'Descartar fallos técnicos',
      'Registrar decisiones del cliente',
    ]),
    c('[Nombre del entregable] · V1', ['Enlazar material', 'Proyecto editable', 'Primer export'], {
      body: 'Duplica esta tarjeta por pieza.',
    }),
  ],
  // 05 · Revisión
  [
    c('Control técnico', [
      'Color',
      'Niveles de audio',
      'Nombres y ortografía',
      'Encuadres verticales',
      'Reproducción completa',
    ]),
    c(
      'Revisión del cliente',
      [
        'Enlace y versión',
        'Una lista consolidada de cambios',
        'Minuto o número de foto',
        'Fecha de respuesta',
      ],
      { tags: ['Cliente'] },
    ),
  ],
  // 06 · Entrega y archivo
  [
    c('Publicar entrega', [
      'Verificar permisos del enlace',
      'Descargar un archivo de prueba',
      'Confirmar recepción',
    ]),
    c('Cierre administrativo', ['Saldo', 'Factura', 'Aprobación final', 'Permisos de portafolio']),
    c('Archivo', [
      'Guardar proyecto y másteres',
      'Ubicación de copias',
      'Fecha acordada de conservación',
      'Caducidad del enlace',
    ]),
  ],
  // 07 · Cerrado: sin tarjetas iniciales.
  [],
];

/** La base con las tarjetas de una variante sumadas en su fase (índice 0 = fase 01). */
function build(extra: [number, SpecCard][] = [], background = ''): BoardSpec {
  const columns: SpecColumn[] = PHASES.map((p, i) => ({
    name: p.name,
    color: p.color,
    cards: BASE[i].map((x) => ({ ...x })),
  }));
  for (const [phase, card] of extra) columns[phase - 1].cards.push(card);
  return { background, columns };
}

const GUIDE = [
  'Las tarjetas nacen en la fase en la que se ejecutan. Al completarlas, pásalas a «07 Cerrado».',
  'La tarjeta de cada entregable recorre montaje → revisión → entrega → cerrado. Si hay cambios, vuelve a montaje.',
  'Las tarjetas entre [corchetes] se duplican por pieza, look o canción.',
  'En cada tarjeta: responsable, fecha límite, lista y enlace a los archivos. Si está bloqueada: qué falta, de quién y para cuándo.',
];

const baseTemplates: BuiltinTemplate[] = [
  {
    id: 'av-base',
    name: 'Base audiovisual',
    group: 'Producción audiovisual',
    summary: 'Siete fases, de encargo a cerrado, para cualquier trabajo.',
    guide: GUIDE,
    prefix: 'Audiovisual · ',
    placeholder: 'Tipo · Cliente · Fecha',
    labels: LABELS,
    spec: build([], 'night'),
  },
  {
    id: 'av-xv',
    name: 'XV años',
    group: 'Producción audiovisual',
    summary: 'Vals, baile sorpresa, retratos de familia y película del día.',
    guide: GUIDE,
    prefix: 'XV años · ',
    placeholder: 'XV años · Quinceañera · Fecha',
    labels: LABELS,
    spec: build(
      [
        [
          1,
          c('Prioridades de la quinceañera y su familia', [
            'Personas imprescindibles',
            'Momentos privados',
            'Canciones',
            'Quién aprueba',
          ]),
        ],
        [
          2,
          c(
            'Escaleta del evento',
            [
              'Preparación',
              'Ceremonia (si aplica)',
              'Entrada',
              'Vals',
              'Baile sorpresa',
              'Brindis',
              'Fiesta',
            ],
            { body: 'Hora y señal de inicio de cada momento.' },
          ),
        ],
        [
          2,
          c(
            'Lista nominal de retratos',
            ['Quinceañera sola', 'Padres', 'Hermanos', 'Abuelos', 'Corte', 'Amistades'],
            { body: 'Persona encargada de reunirlos:' },
          ),
        ],
        [
          2,
          c('Ensayo de vals y baile sorpresa', [
            'Recorrido',
            'Cambios de luz',
            'Posición de cámaras',
            'Pista final',
            'Coordinación con el DJ',
          ]),
        ],
        [
          3,
          c('Preparación y detalles', [
            'Vestido',
            'Accesorios',
            'Retrato al terminar la preparación',
            'Reacción de la familia',
          ]),
        ],
        [
          3,
          c(
            'Entrada, vals y sorpresa',
            ['Plano completo (cámara fija)', 'Expresiones y familia', 'Detalles'],
            {
              body: 'Una cámara mantiene el plano completo; otra cubre expresiones, familia y detalles.',
              tags: ['Video'],
            },
          ),
        ],
        [
          3,
          c(
            'Brindis y mensajes',
            ['Voz directa', 'Ambiente de respaldo', 'Nombres de quienes hablan'],
            {
              tags: ['Audio'],
            },
          ),
        ],
        [
          3,
          c('Retratos y fiesta', [
            'Completar grupos antes de que se dispersen',
            'Confirmar pendientes antes de salir',
          ]),
        ],
        [
          4,
          c('[Teaser vertical XV]', ['Entrada', 'Baile', 'Reacción principal'], {
            tags: ['Video'],
          }),
        ],
        [
          4,
          c('[Película XV]', ['Historia del día', 'Discursos', 'Bailes completos'], {
            body: 'Según contrato.',
            tags: ['Video'],
          }),
        ],
        [
          4,
          c(
            '[Galería XV]',
            ['Retratos', 'Familia', 'Fiesta', 'Selección para álbum (si se contrató)'],
            { tags: ['Foto'] },
          ),
        ],
        [
          5,
          c(
            'Validar nombres, canciones y publicación',
            ['Nombres', 'Canciones', 'Imágenes que se pueden publicar'],
            { tags: ['Cliente'] },
          ),
        ],
        [
          6,
          c('Entregar galería y versiones para compartir', [
            'Galería privada',
            'Versiones para compartir según los permisos acordados',
          ]),
        ],
      ],
      'dusk',
    ),
  },
  {
    id: 'av-shoot',
    name: 'Photoshoot',
    group: 'Producción audiovisual',
    summary: 'Campaña, catálogo, editorial o retrato: looks, set y retoque.',
    guide: GUIDE,
    prefix: 'Photoshoot · ',
    placeholder: 'Photoshoot · Marca · Fecha',
    labels: LABELS,
    spec: build(
      [
        [
          1,
          c('Uso de las fotografías', [
            'Campaña, catálogo, editorial o retrato',
            'Canales',
            'Recortes',
            'Fondo',
            'Cantidad final',
          ]),
        ],
        [
          2,
          c(
            'Moodboard aprobado',
            ['Paleta', 'Luz', 'Poses', 'Referencias', 'Nivel de retoque permitido'],
            { tags: ['Cliente'] },
          ),
        ],
        [
          2,
          c('Matriz de looks', [
            'Look / producto',
            'Vestuario',
            'Accesorios',
            'Fondo',
            'Esquema de luz',
            'Tomas obligatorias',
          ]),
        ],
        [
          2,
          c('Preparación de talento y producto', [
            'Tallas',
            'Maquillaje',
            'Fitting',
            'Prendas de respaldo',
            'Orden de cambios',
          ]),
        ],
        [
          3,
          c(
            '[Look 01 · nombre]',
            [
              'Plano general',
              'Plano medio',
              'Detalle',
              'Vertical',
              'Horizontal',
              'Espacio para texto',
            ],
            { body: 'Duplica esta tarjeta por look.', tags: ['Foto'] },
          ),
        ],
        [
          3,
          c('Revisión en set', ['Foco', 'Piel', 'Reflejos', 'Arrugas', 'Color del producto'], {
            body: 'Amplía para comprobarlo antes de cambiar el set.',
          }),
        ],
        [
          4,
          c('Hoja de contacto', [
            'Archivos numerados',
            'Enlace privado',
            'Cantidad a elegir',
            'Fecha límite',
          ]),
        ],
        [
          4,
          c(
            '[Fotos seleccionadas · retoque]',
            ['Consistencia de piel', 'Consistencia de producto', 'Consistencia de fondo'],
            { body: 'Duplica esta tarjeta por lote.', tags: ['Foto'] },
          ),
        ],
        [
          5,
          c(
            'Selección del cliente',
            ['IDs definitivos', 'Sustituciones', 'Retoques pedidos por imagen'],
            { tags: ['Cliente'] },
          ),
        ],
        [
          6,
          c('Exportaciones', ['Alta resolución', 'Web', 'Recortes específicos'], {
            body: 'Nombra los archivos por look o producto.',
          }),
        ],
      ],
      'sand',
    ),
  },
  {
    id: 'av-boda',
    name: 'Boda',
    group: 'Producción audiovisual',
    summary: 'Preparativos, ceremonia, retratos, recepción y película.',
    guide: GUIDE,
    prefix: 'Boda · ',
    placeholder: 'Boda · Pareja · Fecha',
    labels: LABELS,
    spec: build(
      [
        [
          1,
          c('Prioridades de la pareja', [
            'Tradiciones',
            'Personas importantes',
            'Restricciones',
            'Momentos que prefieren privados',
          ]),
        ],
        [
          2,
          c('Cronograma con coordinación', [
            'Preparativos paralelos',
            'Traslados',
            'Ceremonia',
            'Retratos',
            'Recepción',
            'Márgenes',
          ]),
        ],
        [
          2,
          c('Ceremonia', [
            'Reglas del lugar',
            'Posiciones autorizadas',
            'Entradas',
            'Votos',
            'Anillos',
            'Beso',
            'Salida',
          ]),
        ],
        [
          2,
          c(
            'Plan de sonido',
            [
              'Micrófonos para votos y discursos',
              'Salida de consola',
              'Grabadora independiente',
              'Prueba antes de los invitados',
            ],
            { tags: ['Audio'] },
          ),
        ],
        [
          2,
          c('Retratos familiares', [
            'Grupos por nombre',
            'Persona que los reúne',
            'Orden',
            'Ventana de luz',
          ]),
        ],
        [
          3,
          c(
            'Preparativos de cada integrante',
            ['Detalles', 'Cartas', 'Primer encuentro (si aplica)'],
            {
              body: 'Asigna un operador o pacta cobertura alternada.',
            },
          ),
        ],
        [
          3,
          c('Ceremonia sin cortes en momentos clave', [
            'Plano seguro',
            'Primeros planos',
            'Reacciones',
          ]),
        ],
        [
          3,
          c('Retratos de pareja y familia', [
            'Comprobar grupos pendientes antes de pasar a recepción',
          ]),
        ],
        [
          3,
          c('Recepción', [
            'Entrada',
            'Discursos',
            'Primer baile',
            'Tradiciones previstas',
            'Fiesta',
          ]),
        ],
        [
          4,
          c('[Avance de boda]', [], {
            body: 'Fotos o teaser, con el plazo corto pactado.',
            tags: ['Urgente'],
          }),
        ],
        [
          4,
          c(
            '[Película de boda]',
            ['Arco narrativo', 'Votos', 'Discursos', 'Audio', 'Música autorizada'],
            { tags: ['Video'] },
          ),
        ],
        [
          4,
          c('[Ceremonia completa / galería / álbum]', [], {
            body: 'Una tarjeta por producto contratado.',
          }),
        ],
        [
          5,
          c(
            'Aprobación de álbum o película',
            ['Orden de fotos', 'Nombres', 'Música', 'Versiones para publicación'],
            { tags: ['Cliente'] },
          ),
        ],
        [
          6,
          c('Entregar máster privado', ['Máster privado', 'Copia para compartir (si se acordó)']),
        ],
      ],
      'dawn',
    ),
  },
  {
    id: 'av-musica',
    name: 'Grabación musical',
    group: 'Producción audiovisual',
    summary: 'Estudio, en vivo o videoclip: canciones, sesión, tomas y mezcla.',
    guide: GUIDE,
    prefix: 'Grabación · ',
    placeholder: 'Grabación · Artista · Fecha',
    labels: LABELS,
    spec: build(
      [
        [
          1,
          c(
            'Definir modalidad',
            ['Modalidad', 'Canciones', 'Entregables de audio', 'Entregables de video'],
            { body: 'Sesión de estudio, interpretación en vivo o videoclip con playback.' },
          ),
        ],
        [
          2,
          c(
            '[Canción · título]',
            [
              'Versión',
              'Letra',
              'Tono',
              'BPM',
              'Estructura',
              'Duración',
              'Integrantes',
              'Créditos',
            ],
            { body: 'Duplica esta tarjeta por tema.' },
          ),
        ],
        [
          2,
          c(
            'Plan de sesión',
            [
              'Orden de grabación',
              'Instrumentos',
              'Lista de entradas',
              'Micrófonos',
              'Monitoreo',
              'Click y pistas de apoyo',
            ],
            { tags: ['Audio'] },
          ),
        ],
        [
          2,
          c(
            'Plan visual por canción',
            [
              'Interpretación completa',
              'Planos por músico',
              'Detalles de manos',
              'Recursos',
              'Continuidad',
            ],
            { tags: ['Video'] },
          ),
        ],
        [
          2,
          c('Derechos y versiones', [
            'Composición',
            'Pista',
            'Interpretación',
            'Imagen',
            'Quién aprueba',
          ]),
        ],
        [
          3,
          c('Prueba técnica', [
            'Ganancias',
            'Ruido',
            'Afinación',
            'Monitoreo',
            'Sincronía audio / cámara',
            'Referencia de tiempo',
          ]),
        ],
        [
          3,
          c('Tomas por canción', [
            'Número de toma',
            'Interpretación completa',
            'Favoritas',
            'Correcciones',
            'Recursos',
          ]),
        ],
        [
          3,
          c('Según modalidad', [], {
            body: 'En vivo: audio multipista y ambiente.\nEn estudio: tomas aisladas y overdubs.\nPlayback: usa siempre el mismo máster y claqueta.',
          }),
        ],
        [
          4,
          c(
            '[Canción · edición de audio]',
            ['Selección de tomas', 'Limpieza', 'Edición', 'Mezcla'],
            {
              body: 'Si están contratadas.',
              tags: ['Audio'],
            },
          ),
        ],
        [
          4,
          c(
            '[Canción · video]',
            [
              'Sincronizar con la versión aprobada',
              'Revisar la interpretación',
              'Montar',
              'Corregir color',
            ],
            { tags: ['Video'] },
          ),
        ],
        [
          5,
          c('Escucha y visionado final', [
            'Voz e instrumentos',
            'Sincronía de labios y manos',
            'Cortes',
            'Créditos',
            'Aprobación del artista',
          ]),
        ],
        [
          6,
          c('Entregables contratados', [
            'Máster WAV',
            'Instrumental o stems (si aplican)',
            'Video principal',
            'Versión vertical',
            'Créditos finales',
          ]),
        ],
      ],
      'forest',
    ),
  },
];

// ───────────────────────── Cuenta regresiva ─────────────────────────
// Al crear el tablero se elige la fecha del evento (la boda, el rodaje…) y cada tarjeta toma su
// fecha límite de ahí: «−60» es 60 días antes, «+14» es dos semanas después.

/** Cómo se llama la fecha clave de cada plantilla. */
const ANCHOR: Record<string, string> = {
  'av-base': 'Fecha del trabajo',
  'av-xv': 'Fecha de los XV años',
  'av-shoot': 'Fecha del photoshoot',
  'av-boda': 'Fecha de la boda',
  'av-musica': 'Fecha de la grabación',
};
/** Desfase por fase (índice 0 = fase 01). La fase «Cerrado» queda sin fecha. */
const PHASE_OFFSET: (number | undefined)[] = [-45, -7, 0, 7, 14, 21, undefined];
/** Desfase de tarjetas concretas, que no siguen el de su fase. */
const CARD_OFFSET: Record<string, number> = {
  'Ficha del trabajo': -60,
  'Brief creativo': -50,
  'Alcance y presupuesto': -55,
  'Matriz de entregables': -40,
  'Locaciones y permisos': -21,
  'Plan de cobertura': -10,
  'Plan B': -7,
  'Hoja de llamado': -3,
  'Equipo y respaldo': -2,
  'Confirmación final con cliente y equipo': -2,
};

/** La plantilla con la fecha límite de cada tarjeta relativa a la fecha del evento. */
function dated(t: BuiltinTemplate): BuiltinTemplate {
  return {
    ...t,
    spec: {
      ...t.spec,
      anchor: ANCHOR[t.id] ?? 'Fecha clave',
      columns: t.spec.columns.map((col, i) => ({
        ...col,
        cards: col.cards.map((card) => {
          const offset = CARD_OFFSET[card.title] ?? PHASE_OFFSET[i];
          return typeof offset === 'number' ? { ...card, offset } : card;
        }),
      })),
    },
  };
}

export const builtinTemplates: BuiltinTemplate[] = baseTemplates.map(dated);

/** Tablero en blanco: las tres columnas de siempre. */
export const blankSpec: BoardSpec = {
  columns: [
    { name: 'Por hacer', cards: [] },
    { name: 'En curso', cards: [] },
    { name: 'Hecho', cards: [] },
  ],
};

export const countCards = (spec: BoardSpec) =>
  spec.columns.reduce((n, col) => n + col.cards.length, 0);
