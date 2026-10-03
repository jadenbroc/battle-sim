import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev server only (`apply: 'serve'`): serves the gitignored private data to the app on this machine.
 * It is never part of a build, so a deployed site cannot contain or serve it.
 */
export const privateDataDevServer = (): Plugin => ({
  name: 'battle-sim-private-data',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__private/private-data.json', (_req, res) => {
      const file = join(import.meta.dirname, 'data', 'private', 'private-data.json');
      if (!existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [privateDataDevServer()],
  test: { include: ['src/**/*.test.ts'] },
});
