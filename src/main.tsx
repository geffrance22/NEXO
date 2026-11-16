import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { stylesReady } from './lib/splash';
import './style.css';
// El diseño de celular va al final: así ajusta (solo en pantallas pequeñas) lo de cada sección.
import './mobile/mobile.css';

// App instalable: el service worker (public/sw.js) solo en la versión publicada; en desarrollo
// se quedaría con archivos viejos.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* sin service worker la app funciona igual (solo no queda disponible sin conexión) */
    });
  });

// La app se monta con sus estilos ya puestos (mientras, se ve la pantalla de inicio).
void stylesReady().then(() =>
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
