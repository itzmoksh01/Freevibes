import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from './context.js';
import { registerTools } from './tools/index.js';
import { NAME, VERSION } from './version.js';

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer(
    { name: NAME, version: VERSION },
    {
      instructions:
        'Freevibes exposes image and video generation to MCP clients. Call ' +
        'freevibes_get_capabilities first: it reports whether generation is actually available, ' +
        'with the official source behind each answer. When a generation tool returns ' +
        'status BLOCKED, no media was produced — tell the user plainly that the capability is ' +
        'unavailable, and do not retry or substitute another provider.',
    },
  );

  registerTools(server, ctx);
  return server;
}
