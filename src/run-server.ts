/**
 * Server bootstrap, separated from the executable so the installer CLI can
 * reuse it.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { closeContext, createContext } from './context.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';
import { NAME, VERSION } from './version.js';

export async function runServer(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info('starting', {
    version: VERSION,
    mode: config.mode,
    provider: config.provider,
    db: config.dbPath,
  });

  const ctx = createContext(config, logger);

  if (ctx.recoveredJobs.length > 0) {
    logger.warn('recovered jobs from a previous process', {
      count: ctx.recoveredJobs.length,
      jobs: ctx.recoveredJobs,
    });
  }

  const capabilities = await ctx.provider.getCapabilities();
  if (!capabilities.operational) {
    logger.warn('provider is not operational; generation requests will be refused', {
      provider: capabilities.provider,
      modalities: capabilities.modalities,
    });
  }

  const server = createServer(ctx);
  const transport = new StdioServerTransport();

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    closeContext(ctx);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  await server.connect(transport);
  logger.info(`${NAME} connected on stdio`);
}
