import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNodeHandler } from './node';
import { createMcpHandler } from './http';

const siteOrigin = new URL(process.env.MUWEAVE_PUBLIC_ORIGIN ?? 'https://muweave.vercel.app')
  .origin;
// Only public build assets/configuration are shared. No user data enters this scope.
const widgetHtml = readFileSync(resolve(process.cwd(), 'apps/chatgpt/dist/widget.html'), 'utf8');
const handle = createMcpHandler({ siteOrigin, widgetHtml });
export default createNodeHandler(handle, siteOrigin);
