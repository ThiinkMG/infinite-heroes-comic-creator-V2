import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    /*
     * Public demo build.
     *
     * Vite's `define` inlines these values into the shipped JavaScript, so
     * anything put here is readable by anyone who opens the bundle. That is
     * acceptable for a local build using your own keys; it is not acceptable for
     * a public deployment, where it would hand out your API credentials and
     * admin password to every visitor.
     *
     * With DEMO_BUILD=1 no secret is inlined. The app already supports visitors
     * supplying their own keys — `userGeminiKey` / `userAnthropicKey` are stored
     * in localStorage and edited from Settings — so a keyless build is fully
     * functional, it just asks each visitor for their own key.
     *
     * Set by .github/workflows/deploy-pages.yml. Never set it locally.
     */
    const isDemoBuild = env.DEMO_BUILD === '1';

    const secret = (value: string | undefined) =>
      JSON.stringify(isDemoBuild ? '' : (value || ''));

    return {
      /*
       * GitHub Pages serves a project site from /<repo>/, so assets must be
       * requested from that prefix rather than the domain root. Local builds and
       * Vercel serve from the root and must keep '/'.
       */
      base: env.PAGES_BASE || '/',
      server: {
        // Honour PORT so multiple dev servers can run side by side.
        port: Number(process.env.PORT) || 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': secret(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': secret(env.GEMINI_API_KEY),
        'process.env.ANTHROPIC_API_KEY': secret(env.ANTHROPIC_API_KEY),
        'process.env.ADMIN_PASSWORD': secret(env.ADMIN_PASSWORD),
        // Lets the app explain why it is asking for a key on the public demo.
        'process.env.IS_DEMO_BUILD': JSON.stringify(isDemoBuild ? '1' : ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
