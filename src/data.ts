export const kinds = [
  'Nota',
  'Encuentro',
  'Película',
  'Libro',
  'Trabajo',
  'Aprendizaje',
  'Movimiento',
  'Pendiente',
] as const;
export type Kind = (typeof kinds)[number];
export type Direction = 'ingreso' | 'egreso';
export type Status = 'pendiente' | 'completado';
export type Page =
  | 'Mi espacio'
  | 'Episodios'
  | 'Personas'
  | 'Conexiones'
  | 'Lugares'
  | 'Lecturas'
  | 'Notas'
  | 'Tableros'
  | 'Agenda'
  | 'Libroteca'
  | 'Finanzas'
  | 'Ajustes';

export type PlaceKind =
  | 'cafe'
  | 'comida'
  | 'casa'
  | 'trabajo'
  | 'naturaleza'
  | 'viaje'
  | 'bar'
  | 'cultura'
  | 'deporte'
  | 'otro';

/** Un lugar con historia. Sus visitas son los recuerdos que lo enlazan (`details.placeId`). */
export type Place = {
  id: string;
  name: string;
  kind: PlaceKind;
  city: string;
  address: string;
  story: string;
  images: StoredImage[];
  favorite: boolean;
  created_at: string;
};

export type PlaceInput = Omit<Place, 'id' | 'created_at'>;

export type AppUser = { id: string; email?: string };

export type Relation = 'familia' | 'pareja' | 'amistad' | 'trabajo' | 'conocido' | 'otro';
export type ExchangeKind = 'favor' | 'regalo' | 'apoyo' | 'tiempo' | 'dinero' | 'iniciativa';

/** Algo que diste o recibiste de una persona: alimenta el balance de reciprocidad. */
export type Exchange = {
  id: string;
  /** AAAA-MM-DD */
  date: string;
  dir: 'dar' | 'recibir';
  kind: ExchangeKind;
  /** Cuánto pesó: 1 detalle, 2 importante, 3 enorme. */
  weight: 1 | 2 | 3;
  note?: string;
};

export type UpdateKind =
  | 'trabajo'
  | 'estudios'
  | 'salud'
  | 'amor'
  | 'familia'
  | 'hogar'
  | 'logro'
  | 'viaje'
  | 'animo'
  | 'otro';

/** Novedad de su vida con su fecha: con el tiempo arma la historia de esa persona contigo. */
export type PersonUpdate = {
  id: string;
  /** AAAA-MM-DD: cuándo pasó (o cuándo te enteraste). */
  date: string;
  kind: UpdateKind;
  text: string;
  /** AAAA-MM-DD: cuándo preguntarle cómo va. */
  followUp?: string;
  /** Ya le preguntaste. */
  done?: boolean;
  created_at: string;
  /** Fotos de la novedad (ImgBB). */
  images?: StoredImage[];
  /** De dónde salió: el episodio y el recuerdo en que lo contaste. */
  episodeId?: string;
  entryId?: string;
};

/** Un dato que cambió con el tiempo: «Trabajó en Rappi hasta junio». */
export type ProfileChange = {
  field: 'occupation' | 'company' | 'city';
  value: string;
  /** AAAA-MM-DD: hasta cuándo fue cierto. */
  until: string;
};

/** Dato libre sobre la persona («Talla: M», «Signo: Leo», «Alergia: maní»…). */
export type PersonFact = { id: string; label: string; value: string };

/** Sexo con el que se nombra a la persona: «madre» o «padre», «tía» o «tío»… */
export type Gender = 'f' | 'm';

/** Estado de la relación. Sin estado = activa. */
export type PersonStatus = 'distante' | 'memoria';

/** Identidad completa de una persona (columna `profile`). Todo es opcional. */
export type PersonProfile = {
  photo?: StoredImage;
  alias?: string;
  /** Si no se indica, se deduce del nombre (y puede corregirse). */
  gender?: Gender;
  relation?: Relation;
  /** 5 íntimo … 1 lejano. */
  closeness?: number;
  /** «distante»: ya no están en contacto. «memoria»: falleció. */
  status?: PersonStatus;
  favorite?: boolean;
  phone?: string;
  email?: string;
  social?: string;
  city?: string;
  occupation?: string;
  company?: string;
  /** MM-DD */
  birthday?: string;
  birthYear?: number;
  /** AAAA-MM-DD */
  metOn?: string;
  metHow?: string;
  family?: string;
  likes?: string[];
  dislikes?: string[];
  gifts?: string[];
  /** Palabras con las que la recuerdas («la del café», «voleibol»…). También alimentan a la IA. */
  keywords?: string[];
  /** Cada cuántos días quieres hablar con esta persona (0 = sin meta). */
  cadence?: number;
  facts?: PersonFact[];
  exchanges?: Exchange[];
  /** Novedades de su vida, la más reciente primero. */
  updates?: PersonUpdate[];
  /** Lo que antes era cierto (empleo, empresa, ciudad) y hasta cuándo. */
  history?: ProfileChange[];
  /** Cosas que quieres preguntarle la próxima vez que la veas. */
  askNext?: string[];
};

export type Person = {
  id: string;
  name: string;
  role: string;
  color: string;
  interests: string;
  bio: string;
  created_at: string;
  profile: PersonProfile;
};

/** Tu propia ficha («Mi ficha»). Todo es opcional. */
export type MyProfile = {
  /** Con tus apellidos: así Nexo reconoce a tu familia. */
  name?: string;
  alias?: string;
  gender?: Gender;
  /** MM-DD */
  birthday?: string;
  birthYear?: number;
  city?: string;
  occupation?: string;
  company?: string;
  interests?: string[];
  likes?: string[];
  dislikes?: string[];
  /** En qué estás ahora: metas, proyectos, lo que aprendes. */
  goals?: string[];
  /** Lo que quieras que Nexo sepa de ti, en tus palabras. */
  about?: string;
};

/** Tu ficha guardada y la lectura que hace la IA de todo lo que hay de ti en Nexo. */
export type MyRecord = {
  profile: MyProfile;
  /** Descripción general escrita por la IA a partir de todos tus datos. */
  reading: string;
  /** Rasgos breves de esa lectura («Lector constante», «Familia cercana»…). */
  highlights: string[];
  reading_at: string | null;
};

/** Foto alojada en ImgBB: original, versión media y miniatura. */
export type StoredImage = { url: string; medium?: string; thumb?: string };

/** Para qué sirve una pregunta del ritual de cierre (decide qué parte del aprendizaje alimenta). */
export type RitualTopic =
  'llevar' | 'cambio' | 'recomendar' | 'momento' | 'emocion' | 'critica' | 'conexion';

/** Una pregunta del ritual de cierre con lo que respondiste (el texto se guarda tal como se vio). */
export type RitualAnswer = { id: string; topic: RitualTopic; q: string; a: string };

/** Una pregunta del test de la IA: opciones, la correcta, la que elegiste y por qué. */
export type RitualQuizItem = {
  q: string;
  options: string[];
  answer: number;
  chosen: number;
  why: string;
};

/** Lo que dejaste al terminar un libro o una película. */
export type Ritual = {
  /** AAAA-MM-DD */
  at: string;
  answers: RitualAnswer[];
  /** Personas a las que se lo recomendarías. */
  recommendTo?: string[];
  quiz?: { score: number; total: number; items: RitualQuizItem[] };
  /** El aprendizaje que nació del cierre. */
  learningId?: string;
};

/** Detalles propios de cada tipo de recuerdo (se guardan en la columna `details`). */
export type EntryDetails = {
  /** Ánimo del 1 (mal) al 5 (genial): notas y encuentros. */
  mood?: number;
  /** Nombre del lugar (se guarda también para mostrarlo si el lugar se borra). */
  place?: string;
  placeId?: string;
  /** Qué hicieron en un encuentro: café, comida, llamada… */
  activity?: string;
  movieInfo?: {
    id: number;
    /** De TMDB: película o serie (las fichas antiguas no lo traen y son películas). */
    type?: 'movie' | 'tv';
    year: string;
    /** Minutos de la película o de un episodio. */
    runtime: number | null;
    /** Dirección; en las series, quién la creó. */
    director: string;
    genres: string[];
    seasons?: number;
    episodes?: number;
    overview?: string;
    cast?: string[];
    /** Nota media en TMDB, de 0 a 10. */
    tmdbRating?: number;
  };
  tmdbPoster?: {
    id?: number;
    type?: 'movie' | 'tv';
    path?: string;
    key?: string;
    manual?: boolean;
  };
  year?: string;
  platform?: string;
  /** «Viendo» solo aplica a las series. */
  watch?: 'quiero' | 'viendo' | 'vista';
  /**
   * Serie (no película). Si no se indica, se deduce de TMDB o de la etiqueta «serie»; elegirlo
   * en el formulario manda sobre lo detectado.
   */
  series?: boolean;
  /** Temporada en la que vas (series). */
  seasonAt?: number;
  /** Episodio de esa temporada en el que vas (series). */
  episodeAt?: number;
  /** Anclado en «Mi espacio» para seguir su progreso (libros que lees, series que ves). */
  follow?: boolean;
  bookEdition?: { isbn: string; image: string; publisher: string; date: string };
  author?: string;
  read?: 'quiero' | 'leyendo' | 'terminado';
  pagesRead?: number;
  pagesTotal?: number;
  /**
   * Historial de lectura: en qué página ibas cada día que lo actualizaste (AAAA-MM-DD). Sirve
   * para calcular tu ritmo real y lo que leíste hoy.
   */
  pageLog?: { d: string; p: number }[];
  /** Calificación de 1 a 5: películas y libros. */
  rating?: number;
  quotes?: string[];
  /**
   * Repaso espaciado de las citas: por cada una (ver `quoteKey`), cuántas veces seguidas la
   * recordaste y cuándo toca volver a verla (AAAA-MM-DD). No hace falta ninguna migración.
   */
  quoteReview?: Record<string, { step: number; due: string | null }>;
  stage?: 'idea' | 'curso' | 'pausa' | 'listo';
  priority?: 'baja' | 'media' | 'alta';
  nextStep?: string;
  /** Fecha límite AAAA-MM-DD: trabajo y pendientes. */
  due?: string;
  /** Tipo de compromiso (pendientes): algo que quiero, prometí, espero o depende de otra persona. */
  commitment?: CommitmentKind;
  /** Quién tiene que hacerlo cuando no eres tú (espero / depende): id de persona. */
  owner?: string;
  /** Para quién es (prometí): id de persona. */
  beneficiary?: string;
  /** AAAA-MM-DD: pospuesto hasta esa fecha en tu agenda. */
  snoozed?: string;
  /**
   * Recuerdo del que salió: el encuentro donde prometiste algo (pendientes) o el libro o la
   * película de la que nació un aprendizaje.
   */
  sourceId?: string;
  /** Ritual de cierre de un libro, una película o una serie terminados. */
  ritual?: Ritual;
  /**
   * Repaso espaciado de un aprendizaje: cuántas veces seguidas lo recordaste y cuándo toca volver
   * a verlo (AAAA-MM-DD). `step` -1 o `due` null: ya no se repasa.
   */
  review?: { step: number; due: string | null };
  source?: string;
  sourceName?: string;
  /** Qué tan bien lo entendiste, de 1 a 5. */
  confidence?: number;
  apply?: string;
  method?: string;
};

export type Entry = {
  id: string;
  title: string;
  body: string;
  kind: Kind;
  tags: string[];
  person_ids: string[];
  created_at: string;
  amount: number;
  direction: Direction;
  status: Status;
  file_path?: string | null;
  images: StoredImage[];
  details: EntryDetails;
  /** Episodio al que pertenece (un viaje, una cena…). */
  episode_id?: string | null;
  /** Cuándo lo registraste (created_at es cuándo pasó). */
  recorded_at?: string;
};

export type CommitmentKind = 'quiero' | 'prometi' | 'espero' | 'depende';

export type EpisodeKind =
  | 'viaje'
  | 'encuentro'
  | 'celebracion'
  | 'evento'
  | 'proyecto'
  | 'colaboracion'
  | 'negocio'
  | 'empleo'
  | 'estudio'
  | 'salud'
  | 'deporte'
  | 'aventura'
  | 'familia'
  | 'pareja'
  | 'mascota'
  | 'hogar'
  | 'mudanza'
  | 'compra'
  | 'tramite'
  | 'creativo'
  | 'voluntariado'
  | 'etapa'
  | 'dificil'
  | 'otro';
/** Lo que se guarda: un tipo de la lista o «otro:» con el nombre que escribiste («otro:Boda»). */
export type EpisodeKindValue = EpisodeKind | `otro:${string}`;

/** Una experiencia que reúne varios recuerdos: personas, lugares, dinero, tareas y aprendizajes. */
export type Episode = {
  id: string;
  title: string;
  kind: EpisodeKindValue;
  status: 'activo' | 'cerrado';
  /** AAAA-MM-DD */
  starts_on: string | null;
  ends_on: string | null;
  summary: string;
  /** Texto con el que se capturó. */
  source: string;
  person_ids: string[];
  place_ids: string[];
  budget: number | null;
  /** Qué resultó: decisiones, aprendizajes, cómo terminó. */
  outcome: string;
  created_at: string;
} & EpisodeExtras;

/** Columnas de la migración 009 (sin ella llegan vacías). */
export type EpisodeExtras = {
  /** Bitácora del episodio, la más reciente primero. */
  updates: EpisodeUpdate[];
  /** Otros episodios con los que se relaciona (se guarda en uno solo de los dos lados). */
  links: EpisodeLink[];
  /** Fotos añadidas directamente al episodio (ImgBB). */
  images: StoredImage[];
};
export type EpisodeInput = Omit<Episode, 'id' | 'created_at' | keyof EpisodeExtras>;
export type EpisodeChanges = Partial<EpisodeInput & EpisodeExtras>;

export type EpisodeUpdateKind = 'avance' | 'decision' | 'cambio' | 'problema' | 'logro' | 'nota';

/** Una entrada de la bitácora: «Firmamos el contrato», «Se movió la fecha del vuelo»… */
export type EpisodeUpdate = {
  id: string;
  /** AAAA-MM-DD: cuándo pasó. */
  date: string;
  kind: EpisodeUpdateKind;
  text: string;
  images?: StoredImage[];
  created_at: string;
};

/**
 * Relación entre dos episodios, vista desde el que la guarda:
 * «se convirtió en», «es continuación de», «es parte de» o simplemente «relacionado con».
 */
export type EpisodeLinkKind = 'relacionado' | 'derivo' | 'continua' | 'parte';
export type EpisodeLink = { id: string; kind: EpisodeLinkKind };

/**
 * Un episodio nuevo que nace de otro. `holder` dice quién guarda el vínculo: el de origen
 * («A se convirtió en B») o el nuevo («B es continuación de A»).
 */
export type EpisodeOrigin = { episode: Episode; kind: EpisodeLinkKind; holder: 'source' | 'new' };

export type TieKind =
  | 'padre'
  | 'hijo'
  | 'hermano'
  | 'abuelo'
  | 'nieto'
  | 'tio'
  | 'sobrino'
  | 'primo'
  | 'suegro'
  | 'yerno'
  | 'cunado'
  | 'familiar'
  | 'pareja'
  | 'expareja'
  | 'mejoramigo'
  | 'amigo'
  | 'companero'
  | 'vecino'
  | 'conocido'
  | 'colega'
  | 'jefe'
  | 'subordinado'
  | 'socio'
  | 'mentor'
  | 'aprendiz'
  | 'otro';

/** Vínculo directo entre dos personas: «a» es kind de «b».  = null es «Tú». */
export type Tie = {
  id: string;
  a: string | null;
  b: string;
  kind: TieKind;
  note: string;
  created_at: string;
  /** Deducido de otros vínculos (no está guardado). */
  inferred?: boolean;
  /** Regla con la que se dedujo y persona a través de la cual (para explicarlo). */
  why?: string;
  via?: string;
  /** Naturaleza del parentesco: biológico, adoptivo, de crianza, político o medio hermano. */
  nature?: TieNature | null;
};

export type TieNature = 'biologica' | 'adoptiva' | 'crianza' | 'politica' | 'medio';

export type GroupKind =
  | 'familia'
  | 'trabajo'
  | 'iglesia'
  | 'estudio'
  | 'amigos'
  | 'deporte'
  | 'comunidad'
  | 'viaje'
  | 'otro';

/** Algo en común entre varias personas: la iglesia, un trabajo, la familia Gómez… */
export type Group = {
  id: string;
  name: string;
  kind: GroupKind;
  description: string;
  member_ids: string[];
  created_at: string;
};
export type GroupInput = Omit<Group, 'id' | 'created_at'>;

export type Workspace = {
  people: Person[];
  entries: Entry[];
  places: Place[];
  ties: Tie[];
  groups: Group[];
  episodes: Episode[];
};

/** Datos del formulario de un recuerdo, ya listos para guardar. */
export type EntryInput = {
  title: string;
  body: string;
  kind: Kind;
  tags: string[];
  personIds: string[];
  /** Fecha local en formato AAAA-MM-DD. */
  date: string;
  amount: number;
  direction: Direction;
  status: Status;
  images: StoredImage[];
  details: EntryDetails;
  /** Documento nuevo (PDF o texto) para Supabase Storage. Al editar reemplaza al actual. */
  file: File | null;
  /** Solo al editar: quitar el documento actual sin subir otro. */
  removeFile: boolean;
  /** Episodio al que pertenece (undefined = no cambiar). */
  episodeId?: string | null;
};

export type PersonInput = {
  name: string;
  role: string;
  interests: string;
  bio: string;
  profile: PersonProfile;
};

export const blank: Workspace = {
  people: [],
  entries: [],
  places: [],
  ties: [],
  groups: [],
  episodes: [],
};
