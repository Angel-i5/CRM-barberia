import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Para GitHub Pages en un subdirectorio usa: base: '/nombre-del-repo/'
  base: './',
});
