/**
 * End-to-end test through a real MCP client over an in-memory transport.
 *
 * This is the test that matters most: it proves what a coding agent actually
 * receives when it calls a generation tool while the provider is blocked.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { closeContext, createContext, type AppContext } from '../src/context.js';
import { createServer } from '../src/server.js';
import { cleanup, quietLogger, testConfig, FIXTURE_ENV } from './helpers.js';

const open: Array<{ ctx: AppContext; dir: string }> = [];

async function connect(overrides: Record<string, string> = {}): Promise<Client> {
  const config = await testConfig(overrides);
  const ctx = createContext(config, quietLogger);
  open.push({ ctx, dir: config.dataDir });

  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'freevibes-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: { content: unknown }): string {
  const parts = result.content as Array<{ type: string; text?: string }>;
  return parts.map((p) => p.text ?? '').join('\n');
}

afterEach(async () => {
  for (const entry of open.splice(0)) {
    closeContext(entry.ctx);
    await cleanup(entry.dir);
  }
});

describe('MCP server', () => {
  it('advertises the documented tool set', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      [
        'freevibes_animate_image',
        'freevibes_cancel_job',
        'freevibes_doctor',
        'freevibes_generate_image',
        'freevibes_generate_video',
        'freevibes_get_capabilities',
        'freevibes_get_job_status',
        'freevibes_get_usage_limits',
        'freevibes_list_jobs',
      ].sort(),
    );
  });

  it('reports capabilities honestly, with evidence', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'freevibes_get_capabilities', arguments: {} });
    const body = JSON.parse(textOf(result)) as {
      operational: boolean;
      modalities: Record<string, string>;
      evidence: Array<{ sourceUrl: string }>;
      note: string;
    };

    expect(body.operational).toBe(false);
    expect(body.modalities.image).toBe('BLOCKED');
    expect(body.modalities.video).toBe('BLOCKED');
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.evidence[0]!.sourceUrl).toMatch(/^https:\/\//);
    expect(body.note).toMatch(/NOT available/i);
  });

  it('returns a structured BLOCKED result for video generation', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'freevibes_generate_video',
      arguments: { prompt: 'a cinematic Indian warrior riding across a battlefield', duration: 10 },
    });

    expect(result.isError).toBe(true);

    const body = JSON.parse(textOf(result)) as {
      ok: boolean;
      status: string;
      reason: string;
      evidenceUrls: string[];
      guidance: string;
    };
    expect(body.ok).toBe(false);
    expect(body.status).toBe('BLOCKED');
    expect(body.reason).toMatch(/not available/i);
    expect(body.evidenceUrls.length).toBeGreaterThan(0);
    expect(body.guidance).toMatch(/do not retry/i);
  });

  it('returns a structured BLOCKED result for image generation', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'freevibes_generate_image',
      arguments: { prompt: 'a royal Indian warrior portrait', aspect_ratio: '9:16' },
    });
    expect(result.isError).toBe(true);
    expect((JSON.parse(textOf(result)) as { status: string }).status).toBe('BLOCKED');
  });

  it('records the blocked attempt so it can be inspected afterwards', async () => {
    const client = await connect();
    await client.callTool({ name: 'freevibes_generate_image', arguments: { prompt: 'x' } });

    const list = await client.callTool({ name: 'freevibes_list_jobs', arguments: {} });
    const body = JSON.parse(textOf(list)) as { count: number; jobs: Array<{ state: string }> };
    expect(body.count).toBe(1);
    expect(body.jobs[0]!.state).toBe('blocked');
  });

  it('rejects bad input with a validation error, not a block', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'freevibes_generate_video',
      arguments: { prompt: 'x', aspect_ratio: '16x9' },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(textOf(result)) as { status: string };
    expect(body.status).toBe('INVALID_INPUT');
  });

  it('returns unknown for usage limits rather than inventing a number', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'freevibes_get_usage_limits', arguments: {} });
    const body = JSON.parse(textOf(result)) as { remaining: number | null };
    expect(body.remaining).toBeNull();
  });

  it('reports an unknown job id as a not-found error', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'freevibes_get_job_status', arguments: { job_id: 'nope' } });
    expect(result.isError).toBe(true);
    expect((JSON.parse(textOf(result)) as { status: string }).status).toBe('NOT_FOUND');
  });

  it('runs diagnostics and flags the blocked provider', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'freevibes_doctor', arguments: {} });
    const body = JSON.parse(textOf(result)) as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(body.ok).toBe(false);
    const providerCheck = body.checks.find((c) => c.name === 'provider');
    expect(providerCheck?.ok).toBe(false);
  });
});

describe('MCP server with the fixture provider', () => {
  it('returns a real stored path and marks the output synthetic', async () => {
    const client = await connect({ ...FIXTURE_ENV });
    const result = await client.callTool({
      name: 'freevibes_generate_image',
      arguments: { prompt: 'a blue square' },
    });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result)) as {
      ok: boolean;
      synthetic: boolean;
      assets: Array<{ path: string; kind: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.synthetic).toBe(true);
    expect(body.assets[0]!.kind).toBe('image');
    expect(body.assets[0]!.path).toMatch(/\.png$/);
  });
});
