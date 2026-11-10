#!/usr/bin/env node
/**
 * Default entry point: start the MCP server on stdio.
 *
 * stdout is the protocol channel, so nothing here writes to it.
 */

import { runServer } from './run-server.js';

runServer().catch((err: unknown) => {
  process.stderr.write(
    `[freevibes] FATAL ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
