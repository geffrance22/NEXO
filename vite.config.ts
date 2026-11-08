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
