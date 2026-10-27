import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./studio', import.meta.url)), fengari: fileURLToPath(new URL('./shared/web/vendor/fengari.mjs', import.meta.url)) } },
});
