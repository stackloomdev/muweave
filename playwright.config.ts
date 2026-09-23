import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  use: {
    baseURL: 'http://127.0.0.1:4285',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec vite --config apps/studio/vite.config.ts --port 4285',
      url: 'http://127.0.0.1:4285/',
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'MUWEAVE_MCP_PORT=4287 pnpm dev:mcp',
      url: 'http://127.0.0.1:4287/health',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
