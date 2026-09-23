import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = new URL(process.env.MUWEAVE_PUBLIC_ORIGIN ?? 'https://muweave.vercel.app').origin;
if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  throw new Error('MUWEAVE_PUBLIC_ORIGIN must be HTTPS or loopback');
const alias = Object.fromEntries(
  ['schema', 'core', 'renderer'].map((name) => [
    `@muweave/${name}`,
    resolve(`packages/${name}/src/index.ts`),
  ]),
);
const ui = await build({
  entryPoints: ['apps/chatgpt/src/widget.tsx'],
  bundle: true,
  write: false,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  alias,
  define: { MUWEAVE_SITE_ORIGIN: JSON.stringify(origin), 'process.env.NODE_ENV': '"production"' },
});
const script = ui.outputFiles[0].text.replaceAll('</script', '<\\/script');
const styles =
  (await readFile('apps/studio/src/fonts.css', 'utf8')).replaceAll(
    'url(/fonts/',
    `url(${origin}/fonts/`,
  ) +
  '\n' +
  (await readFile('apps/chatgpt/src/widget.css', 'utf8'));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>幕织分镜</title><style>${styles}</style></head><body><div id="root"></div><script type="module">${script}</script></body></html>`;
await mkdir('apps/chatgpt/dist', { recursive: true });
await writeFile('apps/chatgpt/dist/widget.html', html);
await build({
  entryPoints: ['apps/mcp/src/handler.ts'],
  outfile: 'apps/mcp/handler.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias,
});
console.log(
  `MCP build ready: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB static widget; origin ${origin}`,
);
