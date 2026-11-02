import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { errorResponse } from "@/lib/api-errors";
import { resolveActor } from "@/lib/actor";
import { buildMcpServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";

// MCP over Streamable HTTP, stateless: a fresh server + transport per request,
// JSON responses (no SSE stream to keep open). Auth is the API's: a bad
// Bearer token is a 401 here; write tools enforce PM_AUTH_MODE themselves.
async function serve(req: Request): Promise<Response> {
  let actor;
  try {
    actor = resolveActor(req);
  } catch (err) {
    return errorResponse(err);
  }
  const server = buildMcpServer(actor);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
