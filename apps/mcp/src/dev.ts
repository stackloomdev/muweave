import { createServer } from 'node:http';
import handler from '../handler.mjs';
const port = Number(process.env.MUWEAVE_MCP_PORT ?? 4176);
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.url?.split('?')[0] !== '/api/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }
  void handler(req, res);
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Muweave stateless MCP: http://127.0.0.1:${port}/api/mcp`),
);
