import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        // Honour PORT so multiple dev servers can run side by side.
        port: Number(process.env.PORT) || 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY || ''),
        'process.env.ADMIN_PASSWORD': JSON.stringify(env.ADMIN_PASSWORD || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
