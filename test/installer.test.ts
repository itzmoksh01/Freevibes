import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applyToClient, snippetFor, type ClientTarget, type DetectedClient, type McpEntry } from '../src/install/clients.js';
import { cleanup, makeTempDir } from './helpers.js';

const entry: McpEntry = { command: '/usr/bin/node', args: ['/opt/freevibes/dist/index.js'] };

function target(format: ClientTarget['format'], name = 'Test Client'): ClientTarget {
  return { id: 'claude-code', name, format, documented: true, paths: [] };
}

async function writeConfig(dir: string, name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
  return path;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

describe('installer: json mcpServers clients', () => {
  it('adds the entry and preserves unrelated settings', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(
        dir,
        'config.json',
        JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x', args: [] } } }, null, 2),
      );
      const detected: DetectedClient = { target: target('json-mcpServers'), path, exists: true };

      const result = await applyToClient(detected, entry, { write: true });
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeDefined();

      const parsed = await readJson(path);
      expect(parsed.theme).toBe('dark');
      const servers = parsed.mcpServers as Record<string, { command: string; args: string[] }>;
      expect(servers.other!.command).toBe('x');
      expect(servers.freevibes!.command).toBe('/usr/bin/node');
      expect(servers.freevibes!.args).toEqual(['/opt/freevibes/dist/index.js']);
    } finally {
      await cleanup(dir);
    }
  });

  it('creates the file when it does not exist', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'nested', 'config.json');
      const result = await applyToClient(
        { target: target('json-mcpServers'), path, exists: false },
        entry,
        { write: true },
      );
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeUndefined();
      const parsed = await readJson(path);
      expect(parsed.mcpServers).toBeDefined();
    } finally {
      await cleanup(dir);
    }
  });

  it('does not write during a dry run', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(dir, 'config.json', '{}');
      const result = await applyToClient(
        { target: target('json-mcpServers'), path, exists: true },
        entry,
        { write: false },
      );
      expect(result.changed).toBe(true);
      expect(await readFile(path, 'utf8')).toBe('{}');
    } finally {
      await cleanup(dir);
    }
  });

  it('leaves an unparseable file untouched', async () => {
    const dir = await makeTempDir();
    try {
      const broken = '{ this is not json';
      const path = await writeConfig(dir, 'config.json', broken);
      const result = await applyToClient(
        { target: target('json-mcpServers'), path, exists: true },
        entry,
        { write: true },
      );
      expect(result.changed).toBe(false);
      expect(result.message).toMatch(/not valid JSON/i);
      expect(await readFile(path, 'utf8')).toBe(broken);
    } finally {
      await cleanup(dir);
    }
  });

  it('reports no change when already configured identically', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'config.json');
      await applyToClient({ target: target('json-mcpServers'), path, exists: false }, entry, { write: true });
      const second = await applyToClient(
        { target: target('json-mcpServers'), path, exists: true },
        entry,
        { write: true },
      );
      expect(second.changed).toBe(false);
      expect(second.message).toMatch(/already configured/i);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('installer: Muse Code', () => {
  it('writes a stdio entry under mcp_servers with schema_version 1', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'settings.json');
      await applyToClient({ target: target('json-muse', 'Muse Code'), path, exists: false }, entry, {
        write: true,
      });
      const parsed = await readJson(path);
      expect(parsed.schema_version).toBe(1);
      const servers = parsed.mcp_servers as Record<string, Record<string, unknown>>;
      expect(servers.freevibes!.transport).toBe('stdio');
      expect(servers.freevibes!.command).toBe('/usr/bin/node');
      expect(servers.freevibes!.mode).toBe('optional');
      expect(servers.freevibes!.enabled).toBe(true);
    } finally {
      await cleanup(dir);
    }
  });

  it('preserves other Muse settings and servers', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(
        dir,
        'settings.json',
        JSON.stringify({
          schema_version: 1,
          mcp_servers: { existing: { transport: 'streamable_http', url: 'https://x/mcp' } },
          model: 'muse-spark-1.3',
        }),
      );
      await applyToClient({ target: target('json-muse', 'Muse Code'), path, exists: true }, entry, {
        write: true,
      });
      const parsed = await readJson(path);
      expect(parsed.model).toBe('muse-spark-1.3');
      const servers = parsed.mcp_servers as Record<string, unknown>;
      expect(Object.keys(servers).sort()).toEqual(['existing', 'freevibes']);
    } finally {
      await cleanup(dir);
    }
  });

  it('refuses a file with an unexpected schema version', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(dir, 'settings.json', JSON.stringify({ schema_version: 2 }));
      const result = await applyToClient(
        { target: target('json-muse', 'Muse Code'), path, exists: true },
        entry,
        { write: true },
      );
      expect(result.changed).toBe(false);
      expect(result.message).toMatch(/schema_version/i);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('installer: Zed and VS Code shapes', () => {
  it('uses context_servers with a command object for Zed', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'settings.json');
      await applyToClient({ target: target('json-zed', 'Zed'), path, exists: false }, entry, { write: true });
      const parsed = await readJson(path);
      const servers = parsed.context_servers as Record<string, { command: { path: string; args: string[] } }>;
      expect(servers.freevibes!.command.path).toBe('/usr/bin/node');
      expect(servers.freevibes!.command.args).toEqual(['/opt/freevibes/dist/index.js']);
    } finally {
      await cleanup(dir);
    }
  });

  it('uses servers with an explicit stdio type for VS Code', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'mcp.json');
      await applyToClient({ target: target('json-vscode', 'VS Code'), path, exists: false }, entry, {
        write: true,
      });
      const parsed = await readJson(path);
      const servers = parsed.servers as Record<string, { type: string }>;
      expect(servers.freevibes!.type).toBe('stdio');
    } finally {
      await cleanup(dir);
    }
  });
});

describe('installer: Codex TOML', () => {
  it('appends a managed block', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(dir, 'config.toml', 'model = "gpt-5"\n');
      const result = await applyToClient(
        { target: target('toml-codex', 'Codex CLI'), path, exists: true },
        entry,
        { write: true },
      );
      expect(result.changed).toBe(true);
      const text = await readFile(path, 'utf8');
      expect(text).toContain('model = "gpt-5"');
      expect(text).toContain('[mcp_servers.freevibes]');
      expect(text).toContain('command = "/usr/bin/node"');
    } finally {
      await cleanup(dir);
    }
  });

  it('replaces the managed block instead of duplicating it', async () => {
    const dir = await makeTempDir();
    try {
      const path = await writeConfig(dir, 'config.toml', '');
      const detected: DetectedClient = { target: target('toml-codex', 'Codex CLI'), path, exists: true };
      await applyToClient(detected, entry, { write: true });
      await applyToClient(detected, { command: '/usr/local/bin/node', args: ['/new/path.js'] }, { write: true });

      const text = await readFile(path, 'utf8');
      expect(text.match(/\[mcp_servers\.freevibes\]/g)).toHaveLength(1);
      expect(text).toContain('/usr/local/bin/node');
      expect(text).not.toContain('/usr/bin/node');
    } finally {
      await cleanup(dir);
    }
  });

  it('refuses when the section exists outside a managed block', async () => {
    const dir = await makeTempDir();
    try {
      const original = '[mcp_servers.freevibes]\ncommand = "custom"\n';
      const path = await writeConfig(dir, 'config.toml', original);
      const result = await applyToClient(
        { target: target('toml-codex', 'Codex CLI'), path, exists: true },
        entry,
        { write: true },
      );
      expect(result.changed).toBe(false);
      expect(result.message).toMatch(/already declares/i);
      expect(await readFile(path, 'utf8')).toBe(original);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('installer: manual clients and snippets', () => {
  it('never writes to an undocumented client', async () => {
    const result = await applyToClient(
      { target: target('manual', 'Antigravity'), path: '', exists: false },
      entry,
      { write: true },
    );
    expect(result.changed).toBe(false);
    expect(result.message).toMatch(/manual/i);
  });

  it('renders a usable snippet per client shape', () => {
    expect(snippetFor(target('json-mcpServers'), entry)).toContain('"mcpServers"');
    expect(snippetFor(target('json-muse'), entry)).toContain('"mcp_servers"');
    expect(snippetFor(target('json-zed'), entry)).toContain('"context_servers"');
    expect(snippetFor(target('toml-codex'), entry)).toContain('[mcp_servers.freevibes]');
  });
});
