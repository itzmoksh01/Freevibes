#!/usr/bin/env node
/**
 * `freevibes` command line.
 *
 *   freevibes                 start the MCP server on stdio
 *   freevibes install         detect MCP clients and configure them
 *   freevibes doctor          check configuration, database and provider
 *   freevibes capabilities    print the capability table
 */

import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { closeContext, createContext } from '../context.js';
import { FreevibesError } from '../errors.js';
import {
  applyToClient,
  detectClients,
  snippetFor,
  type ClientId,
  type DetectedClient,
  type McpEntry,
} from './clients.js';
import { runServer } from '../run-server.js';
import { NAME, VERSION } from '../version.js';

const argv = process.argv.slice(2);

function hasFlag(flag: string): boolean {
  return argv.includes(flag);
}

function flagValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function serverEntryPath(): string {
  return fileURLToPath(new URL('../index.js', import.meta.url));
}

function buildEntry(): McpEntry {
  return { command: process.execPath, args: [serverEntryPath()] };
}

function printHelp(): void {
  process.stdout.write(
    [
      `${NAME} ${VERSION} — universal MCP bridge for AI image and video generation`,
      '',
      'Usage:',
      '  freevibes                     Start the MCP server on stdio',
      '  freevibes install [options]   Detect MCP clients and write their config',
      '  freevibes doctor              Check configuration, database and provider',
      '  freevibes capabilities        Print the capability table',
      '  freevibes version             Print the version',
      '',
      'Install options:',
      '  --client <id|all>   Client to configure (default: all detected)',
      '  --write             Apply changes (without this it is a dry run)',
      '  --json              Machine-readable output',
      '',
      'Clients: claude-code, claude-desktop, muse-code, codex, cursor, zed, vscode, antigravity',
      '',
    ].join('\n'),
  );
}

async function commandInstall(): Promise<number> {
  const entry = buildEntry();
  const write = hasFlag('--write');
  const jsonOut = hasFlag('--json');
  const requested = flagValue('--client');

  const detected = await detectClients();

  let targets: DetectedClient[];
  if (requested && requested !== 'all') {
    targets = detected.filter((d) => d.target.id === (requested as ClientId));
    if (targets.length === 0) {
      process.stderr.write(`Unknown client "${requested}". Run "freevibes install --client all".\n`);
      return 2;
    }
  } else {
    const existing = detected.filter((d) => d.exists);
    const manual = detected.filter((d) => d.target.format === 'manual');
    if (existing.length > 0) {
      targets = [...existing, ...manual];
    } else {
      // Nothing detected yet: show every supported client so the user can see
      // what is available and pick one, rather than a blank list.
      targets = detected;
      process.stdout.write(
        '\nNo MCP client config files were found. Showing every supported client; ' +
          'use --client <id> to configure one.\n',
      );
    }
  }

  const results = [];
  for (const target of targets) {
    results.push(await applyToClient(target, entry, { write }));
  }

  if (jsonOut) {
    process.stdout.write(`${JSON.stringify({ write, entry, results }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`\n${NAME} ${VERSION} — client configuration\n\n`);
  process.stdout.write(`Server command: ${entry.command} ${entry.args.join(' ')}\n\n`);

  for (const r of results) {
    const mark = r.changed ? (write ? 'configured' : 'pending   ') : 'unchanged ';
    process.stdout.write(`  ${mark}  ${r.name}\n`);
    process.stdout.write(`             ${r.message}\n`);
    if (!r.changed && !write) {
      const target = targets.find((t) => t.target.id === r.client)?.target;
      if (target) {
        process.stdout.write('\n             Add this to the client config:\n');
        process.stdout.write(
          snippetFor(target, entry)
            .split('\n')
            .map((l) => `             ${l}`)
            .join('\n') + '\n',
        );
      }
    }
    process.stdout.write('\n');
  }

  if (!write) {
    process.stdout.write('Dry run. Re-run with --write to apply these changes.\n\n');
  }

  process.stdout.write(
    'Note: Freevibes starts successfully but reports generation as BLOCKED, because no\n' +
      'legitimate unattended route to Meta Vibes generation exists. See docs/META-FEASIBILITY.md.\n\n',
  );

  return 0;
}

async function commandDoctor(): Promise<number> {
  const config = loadConfig();
  // Read-only command: never reclaim another process's live job.
  const ctx = createContext(config, undefined, { recover: false });

  try {
    const capabilities = await ctx.provider.getCapabilities();
    const limits = await ctx.provider.getUsageLimits();

    process.stdout.write(`\n${NAME} ${VERSION} — diagnostics\n\n`);
    process.stdout.write(`  mode              ${config.mode}\n`);
    process.stdout.write(`  provider          ${config.provider}\n`);
    process.stdout.write(`  operational       ${capabilities.operational ? 'yes' : 'no'}\n`);
    process.stdout.write(`  database          ${config.dbPath} (schema v${ctx.schemaVersion})\n`);
    process.stdout.write(`  assets            ${config.assetDir}\n`);
    process.stdout.write(`  paid providers    disabled\n`);
    process.stdout.write(`  node              ${process.versions.node}\n\n`);

    process.stdout.write('  modalities\n');
    for (const [modality, status] of Object.entries(capabilities.modalities)) {
      process.stdout.write(`    ${modality.padEnd(16)}${status}\n`);
    }
    process.stdout.write('\n');

    if (!capabilities.operational) {
      process.stdout.write(`  blocked: ${capabilities.blockedReason ?? 'unknown'}\n\n`);
    }
    process.stdout.write(`  usage limits: ${limits.detail}\n\n`);

    const states = ctx.jobs.countByState();
    const summary = Object.entries(states)
      .map(([s, n]) => `${s}=${n}`)
      .join(' ') || 'no jobs';
    process.stdout.write(`  jobs: ${summary}\n\n`);

    return capabilities.operational ? 0 : 1;
  } finally {
    closeContext(ctx);
  }
}

async function commandCapabilities(): Promise<number> {
  const config = loadConfig();
  // Read-only command: never reclaim another process's live job.
  const ctx = createContext(config, undefined, { recover: false });
  try {
    const capabilities = await ctx.provider.getCapabilities();
    process.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
    return capabilities.operational ? 0 : 1;
  } finally {
    closeContext(ctx);
  }
}

async function main(): Promise<number> {
  const command = argv[0];

  if (command === undefined || command === 'serve') {
    await runServer();
    return 0;
  }

  switch (command) {
    case 'install':
      return commandInstall();
    case 'doctor':
      return commandDoctor();
    case 'capabilities':
      return commandCapabilities();
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${NAME} ${VERSION}\n`);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      process.stderr.write(`Unknown command "${command}".\n\n`);
      printHelp();
      return 2;
  }
}

main()
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof FreevibesError) {
      process.stderr.write(`[freevibes] ${err.code}: ${err.message}\n`);
    } else {
      process.stderr.write(`[freevibes] FATAL ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    }
    process.exitCode = 1;
  });
