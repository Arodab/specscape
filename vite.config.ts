import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` must be identical for dev, build and preview. `vite preview` runs with
 * command === 'serve', so making base conditional on the command silently breaks
 * preview: the built index.html asks for /specscape/assets/... while the server
 * only serves /assets/..., and every asset falls through to the SPA fallback.
 *
 * Defaults to the GitHub Pages project-site path. For a root domain, build with
 * BASE=/ (in Git Bash use MSYS_NO_PATHCONV=1, which otherwise rewrites a bare
 * "/" into a Windows path).
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE ?? '/specscape/',
  worker: { format: 'es' },
});
