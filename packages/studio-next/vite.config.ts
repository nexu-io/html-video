import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Env-overridable so CI/Docker can move the dev server without edits
  // (issue #57, finding 16).
  server: {
    port: Number(process.env.VITE_PORT) || 3072,
    host: process.env.VITE_HOST || '127.0.0.1',
  },
});
