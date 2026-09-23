import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export const alias = Object.fromEntries(
  ['schema', 'core', 'renderer', 'webmcp'].map((n) => [
    `@muweave/${n}`,
    fileURLToPath(new URL(`./packages/${n}/src/index.ts`, import.meta.url)),
  ]),
);
export default defineConfig({
  resolve: { alias },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
});
