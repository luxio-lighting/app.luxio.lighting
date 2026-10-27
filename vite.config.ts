import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { fengari: fileURLToPath(new URL('./shared/web/vendor/fengari.mjs', import.meta.url)) } },
});
