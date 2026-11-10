/**
 * Logging.
 *
 * stdout belongs to the MCP stdio transport. Writing a single stray line to it
 * corrupts the protocol stream, so every log line goes to stderr instead.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function serialiseFields(fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return '';
  try {
    return ` ${JSON.stringify(fields)}`;
  } catch {
    return ' {"fields":"<unserialisable>"}';
  }
}

export function createLogger(level: LogLevel, bindings: Record<string, unknown> = {}): Logger {
  const threshold = LEVEL_RANK[level];

  const emit = (lvl: Exclude<LogLevel, 'silent'>, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[lvl] < threshold) return;
    const merged = { ...bindings, ...(fields ?? {}) };
    process.stderr.write(`[freevibes] ${lvl.toUpperCase()} ${message}${serialiseFields(merged)}\n`);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}

export const silentLogger: Logger = createLogger('silent');
