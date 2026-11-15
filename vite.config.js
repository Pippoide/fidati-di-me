import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' serve perché Electron carica dist/index.html da file://
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
