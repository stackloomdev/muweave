import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMuweaveServer, type ServerOptions } from './server';

export const MAX_REQUEST_BYTES = 512 * 1024;
export function createMcpHandler(options: ServerOptions & { allowedOrigins?: string[] }) {
  const origins = new Set([
    options.siteOrigin,
    'https://chatgpt.com',
    ...(options.allowedOrigins ?? []),
  ]);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'Cache-Control': 'no-store, private',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    });
    const failure = (status: number, message: string) =>
      Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32000, message } },
        { status, headers },
      );
    if (origin && !origins.has(origin)) return failure(403, 'Origin not allowed');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') {
      headers.set('Allow', 'POST, OPTIONS');
      return failure(405, 'Stateless endpoint: use MCP POST requests');
    }
    const server = createMuweaveServer(options);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      // Materialize the JSON response before closing its request-local transport.
      const body = await response.arrayBuffer();
      const combined = new Headers(response.headers);
      headers.forEach((value, name) => combined.set(name, value));
      return new Response(body.byteLength ? body : null, {
        status: response.status,
        headers: combined,
      });
    } catch {
      // Never log request arguments, project content, credentials or SDK exception payloads.
      return failure(500, 'MCP request failed');
    } finally {
      await server.close();
    }
  };
}
