import { copyFileSync } from 'node:fs';
copyFileSync('dist/app.html', 'dist/index.html');
console.log('Live Server listo: index.html → dist/index.html');
