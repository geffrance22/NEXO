import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
// El diseño de celular va al final: así ajusta (solo en pantallas pequeñas) lo de cada sección.
import './mobile/mobile.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
