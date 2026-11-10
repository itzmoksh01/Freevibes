/**
 * MCP client detection and configuration.
 *
 * Every path and config shape here comes from the vendor's own documentation.
 * Clients whose configuration is not documented are listed as manual-only and
 * are never written to — guessing a config format would corrupt a user's setup.
 *
 * Writes are conservative: the existing file is copied to a timestamped backup
 * first, unrelated keys are preserved, an unparseable file is left untouched,
 * and the new file lands via an atomic rename.
 */

import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ClientId =
  | 'claude-code'
  | 'claude-desktop'
  | 'muse-code'
  | 'codex'
  | 'cursor'
  | 'zed'
  | 'vscode'
  | 'antigravity';

export type ConfigFormat =
  | 'json-mcpServers'
  | 'json-muse'
  | 'json-zed'
  | 'json-vscode'
  | 'toml-codex'
  | 'manual';

export interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ClientTarget {
  id: ClientId;
  name: string;
  format: ConfigFormat;
  /** True when the path and shape come from vendor documentation. */
  documented: boolean;
  paths: string[];
  notes?: string;
}

function xdgConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
}

function claudeDesktopPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return join(xdgConfigHome(), 'Claude', 'claude_desktop_config.json');
}

export function clientTargets(cwd = process.cwd()): ClientTarget[] {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      format: 'json-mcpServers',
      documented: true,
      paths: [join(homedir(), '.claude.json')],
      notes: 'Alternatively run: claude mcp add freevibes -- <command> <args>',
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      format: 'json-mcpServers',
      documented: true,
      paths: [claudeDesktopPath()],
    },
    {
      id: 'muse-code',
      name: 'Muse Code',
      format: 'json-muse',
      documented: true,
      paths: [join(xdgConfigHome(), 'muse', 'settings.json')],
      notes: 'Requires "schema_version": 1 in settings.json; Freevibes adds it if the file is new.',
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      format: 'toml-codex',
      documented: true,
      paths: [join(homedir(), '.codex', 'config.toml')],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      format: 'json-mcpServers',
      documented: true,
      paths: [join(homedir(), '.cursor', 'mcp.json')],
    },
    {
      id: 'zed',
      name: 'Zed',
      format: 'json-zed',
      documented: true,
      paths: [join(xdgConfigHome(), 'zed', 'settings.json')],
    },
    {
      id: 'vscode',
      name: 'VS Code (workspace)',
      format: 'json-vscode',
      documented: true,
      paths: [join(cwd, '.vscode', 'mcp.json')],
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      format: 'manual',
      documented: false,
      paths: [],
      notes:
        'No configuration path is published for this client. Add the printed JSON snippet to its ' +
        'MCP settings manually.',
    },
  ];
}

export interface DetectedClient {
  target: ClientTarget;
  /** The path that exists, or the preferred path when none does. */
  path: string;
  exists: boolean;
}

export async function detectClients(cwd = process.cwd()): Promise<DetectedClient[]> {
  const out: DetectedClient[] = [];
  for (const target of clientTargets(cwd)) {
    if (target.paths.length === 0) {
      out.push({ target, path: '', exists: false });
      continue;
    }
    let found: DetectedClient | null = null;
    for (const p of target.paths) {
      try {
        await stat(p);
        found = { target, path: p, exists: true };
        break;
      } catch {
        // try next candidate
      }
    }
    out.push(found ?? { target, path: target.paths[0]!, exists: false });
  }
  return out;
}

/** The JSON object to merge into a client's config for this entry. */
export function entryFor(format: ConfigFormat, entry: McpEntry): unknown {
  switch (format) {
    case 'json-mcpServers':
      return { command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
    case 'json-muse':
      return {
        transport: 'stdio',
        command: entry.command,
        args: entry.args,
        ...(entry.env ? { env: entry.env } : {}),
        // Optional, so a misconfigured server never aborts an entire Muse run.
        mode: 'optional',
        enabled: true,
      };
    case 'json-zed':
      return { command: { path: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) } };
    case 'json-vscode':
      return { type: 'stdio', command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) };
    default:
      return { command: entry.command, args: entry.args };
  }
}

export function snippetFor(target: ClientTarget, entry: McpEntry): string {
  if (target.format === 'toml-codex') {
    return [
      '[mcp_servers.freevibes]',
      `command = ${JSON.stringify(entry.command)}`,
      `args = [${entry.args.map((a) => JSON.stringify(a)).join(', ')}]`,
    ].join('\n');
  }
  const key =
    target.format === 'json-muse'
      ? 'mcp_servers'
      : target.format === 'json-zed'
        ? 'context_servers'
        : target.format === 'json-vscode'
          ? 'servers'
          : 'mcpServers';
  return JSON.stringify({ [key]: { freevibes: entryFor(target.format, entry) } }, null, 2);
}

export interface ApplyResult {
  client: ClientId;
  name: string;
  path: string;
  changed: boolean;
  backupPath?: string;
  message: string;
}

const MARKER_START = '# >>> freevibes (managed block) >>>';
const MARKER_END = '# <<< freevibes (managed block) <<<';

function tomlBlock(entry: McpEntry): string {
  return [
    MARKER_START,
    '[mcp_servers.freevibes]',
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((a) => JSON.stringify(a)).join(', ')}]`,
    MARKER_END,
  ].join('\n');
}

function mergeToml(existing: string, entry: McpEntry): string {
  const block = tomlBlock(entry);
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return existing.slice(0, startIdx) + block + existing.slice(endIdx + MARKER_END.length);
  }

  if (/^\s*\[mcp_servers\.freevibes\]/m.test(existing)) {
    throw new Error(
      'config.toml already declares [mcp_servers.freevibes] outside an Freevibes managed block. ' +
        'Leaving the file untouched; remove that section or edit it by hand.',
    );
  }

  const separator = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
  return `${existing}${separator}\n${block}\n`;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.freevibes-tmp`;
  await writeFile(temp, contents, 'utf8');
  await rename(temp, path);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Apply the Freevibes entry to one client.
 * With `write: false` this only reports what would change.
 */
export async function applyToClient(
  detected: DetectedClient,
  entry: McpEntry,
  options: { write: boolean },
): Promise<ApplyResult> {
  const { target, path, exists } = detected;
  const base = { client: target.id, name: target.name, path };

  if (target.format === 'manual') {
    return {
      ...base,
      changed: false,
      message: `${target.name} needs manual configuration. ${target.notes ?? ''}`.trim(),
    };
  }

  let existingText = '';
  if (exists) {
    try {
      existingText = await readFile(path, 'utf8');
    } catch (err) {
      return {
        ...base,
        changed: false,
        message: `Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  let nextText: string;

  if (target.format === 'toml-codex') {
    try {
      nextText = mergeToml(existingText, entry);
    } catch (err) {
      return { ...base, changed: false, message: err instanceof Error ? err.message : String(err) };
    }
  } else {
    let parsed: Record<string, unknown> = {};
    if (existingText.trim().length > 0) {
      try {
        const asJson: unknown = JSON.parse(existingText);
        if (asJson === null || typeof asJson !== 'object' || Array.isArray(asJson)) {
          throw new Error('top-level value is not an object');
        }
        parsed = asJson as Record<string, unknown>;
      } catch (err) {
        return {
          ...base,
          changed: false,
          message:
            `Refusing to modify ${path}: it is not valid JSON ` +
            `(${err instanceof Error ? err.message : String(err)}). Fix or move the file, then re-run.`,
        };
      }
    }

    if (target.format === 'json-muse') {
      const version = parsed.schema_version;
      if (version !== undefined && version !== 1) {
        return {
          ...base,
          changed: false,
          message: `Refusing to modify ${path}: schema_version is ${String(version)}, expected 1.`,
        };
      }
      parsed.schema_version = 1;
      const servers = (parsed.mcp_servers ?? {}) as Record<string, unknown>;
      servers.freevibes = entryFor(target.format, entry);
      parsed.mcp_servers = servers;
    } else if (target.format === 'json-zed') {
      const servers = (parsed.context_servers ?? {}) as Record<string, unknown>;
      servers.freevibes = entryFor(target.format, entry);
      parsed.context_servers = servers;
    } else if (target.format === 'json-vscode') {
      const servers = (parsed.servers ?? {}) as Record<string, unknown>;
      servers.freevibes = entryFor(target.format, entry);
      parsed.servers = servers;
    } else {
      const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
      servers.freevibes = entryFor(target.format, entry);
      parsed.mcpServers = servers;
    }

    nextText = `${JSON.stringify(parsed, null, 2)}\n`;
  }

  if (nextText === existingText) {
    return { ...base, changed: false, message: 'Already configured; nothing to change.' };
  }

  if (!options.write) {
    return {
      ...base,
      changed: true,
      message: `Would update ${path} (dry run; pass --write to apply).`,
    };
  }

  let backupPath: string | undefined;
  if (exists) {
    backupPath = `${path}.freevibes-backup-${stamp()}`;
    await copyFile(path, backupPath);
  }

  await atomicWrite(path, nextText);

  return {
    ...base,
    changed: true,
    ...(backupPath ? { backupPath } : {}),
    message: `Updated ${path}${backupPath ? ` (backup: ${backupPath})` : ''}. Restart ${target.name} to load the tools.`,
  };
}
