import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
export function createNodeHandler(
  handle: (request: Request) => Promise<Response>,
  siteOrigin: string,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    try {
      // Vercel helpers may have already consumed IncomingMessage. Prefer their
      // request-local parsed body; raw Node requests still use the bounded stream.
      let body: BodyInit | undefined;
      if (req.method === 'POST') {
        if ('body' in req) {
          const parsed = (req as IncomingMessage & { body: unknown }).body;
          body =
            typeof parsed === 'string'
              ? parsed
              : parsed instanceof Uint8Array
                ? new Uint8Array(parsed)
                : JSON.stringify(parsed ?? null);
        } else body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
      }
      const request = new Request(new URL(req.url ?? '/api/mcp', siteOrigin), {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
        ...(req.method === 'POST' ? { body, duplex: 'half' } : {}),
        signal: controller.signal,
      });
      const response = await handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent)
        res.writeHead(500, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      res.end('{"error":"MCP request failed"}');
    }
  };
}
