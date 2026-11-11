#!/usr/bin/env node
/**
 * End-to-end smoke test against the built server.
 *
 * Spawns `dist/index.js` exactly as a coding agent would, speaks MCP over stdio,
 * and asserts the contract an agent depends on:
 *
 *   1. the server starts and advertises all nine tools
 *   2. capabilities are reported honestly, with dated evidence
 *   3. generation returns a structured BLOCKED result, not a fake success
 *   4. the CLI reports the same thing, and exits 1 because the provider is blocked
 *
 * This is the check CI runs. It deliberately asserts the *blocked* behaviour:
 * if a future change made generation silently "succeed", this test fails.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverEntry = join(root, 'dist', 'index.js');
const cliEntry = join(root, 'dist', 'install', 'cli.js');

const EXPECTED_TOOLS = [
  'freevibes_animate_image',
  'freevibes_cancel_job',
  'freevibes_doctor',
  'freevibes_generate_image',
  'freevibes_generate_video',
  'freevibes_get_capabilities',
  'freevibes_get_job_status',
  'freevibes_get_usage_limits',
  'freevibes_list_jobs',
];

const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

function textOf(result) {
  return (result.content ?? []).map((part) => part.text ?? '').join('\n');
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'freevibes-smoke-'));

  try {
    console.log('freevibes smoke test');

    /* ---------------- 1. MCP over stdio ---------------- */
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: { ...process.env, FREEVIBES_DATA_DIR: dataDir, FREEVIBES_LOG_LEVEL: 'warn' },
      stderr: 'pipe',
    });

    const client = new Client({ name: 'freevibes-smoke', version: '1.0.0' });
    await client.connect(transport);
    check('server starts and completes the MCP handshake', true);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    check('advertises exactly nine tools', tools.length === 9, `got ${tools.length}`);
    check(
      'tool names match the documented contract',
      JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
      names.join(','),
    );

    /* ---------------- 2. Capabilities ---------------- */
    const caps = JSON.parse(textOf(await client.callTool({ name: 'freevibes_get_capabilities', arguments: {} })));
    check('provider reports itself as not operational', caps.operational === false);
    check('video is reported BLOCKED', caps.modalities.video === 'BLOCKED', String(caps.modalities.video));
    check('image is reported BLOCKED', caps.modalities.image === 'BLOCKED', String(caps.modalities.image));
    check('image-to-video is reported BLOCKED', caps.modalities['image-to-video'] === 'BLOCKED');
    check('evidence rows are present', Array.isArray(caps.evidence) && caps.evidence.length > 0);
    check(
      'every evidence row cites an https source',
      (caps.evidence ?? []).every((e) => typeof e.sourceUrl === 'string' && e.sourceUrl.startsWith('https://')),
    );
    check(
      'every evidence row is dated',
      (caps.evidence ?? []).every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.verifiedOn)),
    );

    /* ---------------- 3. Generation is refused ---------------- */
    const gen = await client.callTool({
      name: 'freevibes_generate_video',
      arguments: { prompt: 'a cinematic warrior riding across a battlefield', duration: 10 },
    });
    check('generate_video returns an error, not a result', gen.isError === true);

    const genBody = JSON.parse(textOf(gen));
    check('failure carries status BLOCKED', genBody.status === 'BLOCKED', String(genBody.status));
    check('failure explains itself', typeof genBody.reason === 'string' && genBody.reason.length > 40);
    check('failure cites evidence', Array.isArray(genBody.evidenceUrls) && genBody.evidenceUrls.length > 0);
    check('failure is not marked retryable', genBody.ok === false);

    // A blocked attempt must still be recorded, and recorded as blocked.
    const jobs = JSON.parse(textOf(await client.callTool({ name: 'freevibes_list_jobs', arguments: {} })));
    check('the blocked attempt was recorded', jobs.count === 1, `count=${jobs.count}`);
    check('the recorded job is in state blocked', jobs.jobs?.[0]?.state === 'blocked', String(jobs.jobs?.[0]?.state));

    // Usage limits must be unknown rather than invented.
    const limits = JSON.parse(textOf(await client.callTool({ name: 'freevibes_get_usage_limits', arguments: {} })));
    check('usage limits are reported unknown, not guessed', limits.remaining === null);

    await client.close();

    /* ---------------- 4. CLI agrees ---------------- */
    const capsRun = spawnSync(process.execPath, [cliEntry, 'capabilities'], {
      encoding: 'utf8',
      env: { ...process.env, FREEVIBES_DATA_DIR: dataDir, FREEVIBES_LOG_LEVEL: 'silent' },
    });
    check('CLI exits 1 while the provider is blocked', capsRun.status === 1, `exit=${capsRun.status}`);

    let cliJson = null;
    try {
      cliJson = JSON.parse(capsRun.stdout);
    } catch {
      cliJson = null;
    }
    check('CLI prints valid JSON', cliJson !== null);
    check('CLI agrees the provider is blocked', cliJson?.operational === false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`smoke test FAILED: ${failures.length} check(s)`);
    process.exit(1);
  }
  console.log('smoke test passed');
}

main().catch((err) => {
  console.error(`smoke test crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
