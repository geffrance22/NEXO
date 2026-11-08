# Activar Nexo con datos reales

1. Ejecuta el archivo completo `supabase/migrations/202611060001_nexo.sql` en SQL Editor de tu proyecto Supabase. La versión corregida permite repetir la ejecución cuando las tablas ya fueron creadas por Nexo y conserva los registros existentes. No borres las tablas. Después ejecuta también `supabase/migrations/202611060003_edit_delete.sql`: hace falta para borrar personas sin dejar vínculos sueltos en tus recuerdos. Si las tablas pertenecían a otra aplicación y tienen una estructura diferente, hace falta revisar su esquema antes de adaptar la migración.
2. Abre Authentication → Users → Add user. Crea tu email y contraseña y confirma el correo desde el panel. Desactiva los registros públicos en la configuración de Authentication.
3. Haz doble clic en `INICIAR.cmd` dentro de esta carpeta. Requiere Node.js y las dependencias ya instaladas. Se abrirá la dirección de Vite. También puedes ejecutar `npm run dev` en la terminal.
4. En Nexo, pulsa Entrar a mi espacio e introduce tu cuenta. Los datos de tu cuenta empiezan vacíos. Guarda una persona, recarga y verifica que sigue allí; después crea un apunte vinculado.

Live Server sirve archivos tal como están y no compila React/TypeScript. Durante el desarrollo debes usar Vite. Para hosting estático se ejecuta `npm run build` y se publica la carpeta `dist`; no se publica el index.html de la raíz por separado.

Groq no es necesario para guardar datos. La detección literal de nombres funciona sin IA. El asistente requiere configurar su secreto y desplegar su función, como indica README.md.
