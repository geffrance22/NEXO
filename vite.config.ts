import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  plugins: [
    {
      name: 'local-movie-search',
      async configureServer(server) {
        const { localMovies } = await import('./scripts/local-movies.mjs');
        server.middlewares.use(localMovies(loadEnv(mode, '.', 'TMDB_')));
      },
    },
    {
      // Los estilos de la app (más de 1 MB) no bloquean el primer cuadro: la pantalla de inicio de
      // app.html se pinta y se anima al instante. Se piden con prioridad alta (preload) y main.tsx
      // espera a tenerlos antes de montar la app.
      name: 'nexo-css-sin-bloquear',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: (html) =>
          html.replace(
            /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/g,
            `<link rel="preload" as="style" crossorigin href="$1"><link rel="stylesheet" crossorigin href="$1" media="print" onload="this.media='all'" data-app-css>`,
          ),
      },
    },
  ],
  base: './',
  build: {
    rollupOptions: {
      input: 'app.html',
      output: {
        manualChunks: { react: ['react', 'react-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
}));
