# Nexo · Tu universo personal

Aplicación web privada en React + TypeScript + Supabase. Diseño adaptable y acceso obligatorio con cuenta de Supabase. Sin datos ficticios ni almacenamiento local de apuntes.

## Live Server

La versión compilada ya está generada: abre el `index.html` de la raíz con Live Server y accederás a `dist/index.html`. Tras modificar código, ejecuta `npm run build` para actualizarla. Para desarrollo con actualización automática usa `npm run dev` y la ruta `/app.html`.

## Arranque

```powershell
npm install
npm run dev
```

Abre la dirección que indique Vite. `npm run build` genera `dist/`, que puede alojarse en un servicio de hosting estático. Copia `.env.example` a `.env.local` si necesitas cambiar el proyecto. Las variables `VITE_` son públicas; nunca pongas claves secretas en ellas.

## Activar tu cuenta real (una vez)

1. En tu proyecto Supabase, abre SQL Editor → New query.
2. Copia y ejecuta TODO `supabase/migrations/202611060001_nexo.sql`. Crea tablas, índices, validación de vínculos, políticas RLS y bucket privado. Se puede repetir sin perder datos.
3. Ejecuta después `supabase/migrations/202611060003_edit_delete.sql`. **Es necesaria para borrar personas**: al eliminar una, quita su vínculo de los recuerdos donde aparecía (los recuerdos se conservan). También añade `updated_at` a ambas tablas y elimina un índice duplicado. Sin ella la interfaz sigue funcionando y oculta los vínculos a personas borradas, pero la base de datos conserva ids sueltos. También se puede repetir. (La migración `…0002` es opcional y pertenece al asistente: ver más abajo.)
4. En Authentication → Users → Add user, crea tu usuario con email y contraseña, confirmándolo desde el panel.
5. En Authentication habilita el proveedor Email y Allow new users to sign up. Configura Site URL con la dirección pública de Nexo y SMTP propio para enviar confirmaciones a usuarios externos.
6. Inicia sesión en Nexo. Los registros reales empiezan vacíos.
7. Verifica con otra cuenta de prueba que no pueda ver tus filas ni tus archivos antes de usar información sensible.

No se necesita compartir contraseña de base de datos ni service_role. La clave publicable ya está configurada. Tener una URL de Supabase no permite ejecutar la migración con privilegios de administración.

## Activar Groq más adelante

Desde Supabase CLI autenticada:

```powershell
npx supabase login
npx supabase functions deploy assistant --no-verify-jwt --project-ref imdvmlzdbmbvwkfoisgs
```

Si la CLI se queja de Docker, añade `--use-api` al comando de despliegue.

En Edge Functions → Secrets configura `GROQ_API_KEY` y `GROQ_MODEL` (un identificador de modelo disponible en tu consola Groq; el elegido tras probar los modelos de chat de la cuenta es `qwen/qwen3.8-27b`: español limpio, sin razonamiento oculto que consuma tokens y respuestas en ~1 s). El prompt pide texto plano y sin ids internos, porque el chat no interpreta Markdown. No escribas la clave en el frontend ni la subas al repositorio. La función verifica el token mediante `auth.getUser()`; el gateway JWT se desactiva para compatibilidad con las claves actuales. Conserva siempre esa validación en el código.

Opcional: ejecuta también `supabase/migrations/202611060002_assistant_quota_refund.sql` en SQL Editor. Permite que la función devuelva la consulta de la cuota diaria cuando Groq falla o hay un error interno. Sin ella el asistente funciona igual, pero las consultas fallidas siguen contando. La función solo puede ejecutarla la Edge Function (clave de servicio, que Supabase ya inyecta en el entorno de la función); el navegador no puede llamarla.

La función usa el token del usuario y RLS. Busca las notas que contienen alguna de las palabras clave de la pregunta (las más recientes primero), completa hasta 12 con las más recientes y envía hasta 80 perfiles. Limita a 30 consultas diarias por usuario. Los errores se registran en los logs de la función y la interfaz muestra el motivo real (límite diario, secreto sin configurar, función sin desplegar). No envía adjuntos ni calcula totales financieros. No incluye todavía embeddings, extracción automática por IA ni búsqueda exhaustiva: es una primera integración acotada. Configura la retención de datos de Groq antes de usar datos personales.

## Saludo de Mi espacio (IA)

El encabezado de Mi espacio es un saludo escrito por la IA con tu ficha, tu día en Nexo (agenda, cumpleaños, el libro y la serie que llevas) y lo de afuera: el clima de tu ciudad (la de tu ficha; sin ella, la de tu zona horaria) y los titulares del día. Cada vez elige al azar qué toca (un tip, un consejo, un recordatorio, una recomendación, una noticia, una curiosidad, algo de tu serie o tu libro…) y a veces trae accesos directos. Dura entre 10 y 15 minutos y se guarda en el navegador. Mientras llega el nuevo se ve el saludo con tu nombre, y si la función no está disponible aparece uno de respaldo sin IA.

Se despliega una vez, con los mismos secretos que `assistant`:

```powershell
npx supabase functions deploy greeting --no-verify-jwt --project-ref imdvmlzdbmbvwkfoisgs --use-api
```

- Usa `GROQ_API_KEY` y `GROQ_MODEL`. Opcional: `GROQ_GREETING_MODEL`, para usar un modelo más rápido solo aquí.
- No gasta las 30 consultas diarias del asistente. La propia función limita a 8 saludos cada 10 minutos por usuario.
- El clima viene de Open-Meteo y los titulares de Google Noticias (con BBC Mundo de respaldo). Ninguno necesita clave y, si tardan más de unos 2 segundos, el saludo sale sin ellos.
- A Groq se envía un resumen corto (tu ficha, la agenda de hoy, cumpleaños cercanos, libro y serie en curso, actividad reciente), no tus notas completas.

## Funciones incluidas

- Libreta con tipos de registro, fecha, etiquetas y vínculos múltiples.
- Detección literal de nombres completos conocidos al guardar (no interpretación de IA).
- Personas con contexto e intereses; historial compartido.
- Mapa de coapariciones (no prueba de relación real).
- Libroteca: películas, series, libros, lecturas, citas, aprendizajes y toda la libreta, por secciones.
- Ingresos, egresos y balance COP calculados desde movimientos explícitos.
- Pendientes completables y comparador basado en evidencia registrada.
- Adjuntos privados hasta 10 MB para cuentas autenticadas, enlaces temporales al abrirlos.
- Edición y borrado de recuerdos y de personas. Al borrar una persona, sus recuerdos se conservan sin ese vínculo.
- La sección abierta queda en la URL (`#/personas/<id>`): recargar la página o usar «atrás» no te devuelve al inicio.
- Exportación JSON.

## Límites de esta primera versión

No hay fotos de avatar, importación masiva, conversión automática de un texto en varios registros, comparaciones históricas, reconocimiento de rostros ni recordatorios externos. Las notas no llevan cifrado de extremo a extremo: Supabase almacena el contenido accesible a tu proyecto. Haz exportaciones y copias independientes de los adjuntos; el plan gratuito no sustituye una estrategia de respaldo.

## Estructura del código

```text
src/
  main.tsx            Punto de entrada
  App.tsx             Control de sesión: pantalla de acceso o interfaz principal
  AppContext.ts       Contexto compartido (datos, navegación y acciones)
  backend.ts          Cliente de Supabase
  assistant.ts        Llamada a la función assistant
  data.ts             Tipos y lista de tipos de registro
  hooks/              useAuth, useWorkspace (carga y escritura), useAssistant, useToast
  lib/                Utilidades: formato, búsqueda sin tildes, detección de nombres, exportación
  components/         AppShell (estructura general), barra lateral y superior, formularios, tarjetas
  pages/              Una página por sección: personas, conexiones, finanzas…
  library/            Libroteca: pestañas, portadas, lecturas y muro de citas
  greeting/           Saludo de Mi espacio: resumen del día, caché, respaldo sin IA y llamada a `greeting`
  style.css           Estilos
```

`npm run format` aplica Prettier a `src`, `supabase` y `scripts`; `npm run format:check` solo comprueba. TypeScript falla ante variables o imports sin usar.

## Verificación

`npm run build` comprueba TypeScript y genera el bundle. Para validar el despliegue real hay que ejecutar la migración, crear el usuario y probar inicio de sesión, escritura, aislamiento entre usuarios y adjuntos. Groq requiere su secreto y despliegue; no se simulan respuestas de IA.

## Fotos (ImgBB)

Las fotos de los recuerdos se suben a [ImgBB](https://api.imgbb.com) a través de la Edge Function `image-upload`, así la clave nunca llega al navegador ni a git. En Edge Functions → Secrets configura `IMGBB_API_KEY` (o `supabase secrets set IMGBB_API_KEY=...`) y despliega con `supabase functions deploy image-upload --no-verify-jwt`. La función valida la sesión antes de subir. Ejecuta también `supabase/migrations/202611060004_images_details.sql`, que añade las columnas `images` y `details`. Sin esa migración la app funciona, avisa y guarda solo notas sin fotos ni detalles. Los PDF y textos adjuntos siguen yendo a Supabase Storage. Las fotos de ImgBB son accesibles por su enlace.

## CAPTURAS (YourImageShare)

La pestaña CAPTURAS de Libroteca sube imágenes a [YourImageShare](https://yourimageshare.com/about/api) a través de la Edge Function `screenshots`. Esa clave permite listar y borrar todo lo subido, así que vive solo en los secretos: `npx supabase secrets set YIS_API_KEY=... --project-ref imdvmlzdbmbvwkfoisgs` y despliega con `npx supabase functions deploy screenshots --no-verify-jwt --project-ref imdvmlzdbmbvwkfoisgs`. Ejecuta antes `supabase/migrations/202611100006_screenshots.sql` (tablas `screenshots` y `screenshot_folders`). Las imágenes se suben sin recomprimir y como `private` (solo con el enlace). YourImageShare admite 20 peticiones por minuto: la cola reparte las subidas y espera sola cuando hace falta. Al borrar, la captura desaparece al instante y la función la borra de YourImageShare por detrás.

## Portadas de películas

La búsqueda usa una función autenticada. En los secretos de Edge Functions configura TMDB_READ_TOKEN con el token de lectura de TMDB y despliega con `supabase functions deploy movie-search --no-verify-jwt`. La función valida la sesión antes de consultar TMDB. Las portadas se sirven desde TMDB y las personalizadas desde ImgBB. This product uses the TMDB API but is not endorsed or certified by TMDB.
