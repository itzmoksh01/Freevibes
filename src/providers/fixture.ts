/**
 * Fixture provider — TEST USE ONLY.
 *
 * It exists so the orchestrator, downloader, validator and asset manager can be
 * exercised end-to-end without a real provider. It produces placeholder media
 * and labels every result `synthetic: true`.
 *
 * Two independent guards keep it out of a real run:
 *   1. config.ts refuses FREEVIBES_ALLOW_FIXTURE_PROVIDER outside a test run.
 *   2. registry.ts will not select it unless it was explicitly enabled.
 *
 * Nothing here is ever presented as Meta generation.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { BlockedError } from '../errors.js';
import type {
  AccountStatus,
  AnimateImageRequest,
  ImageGenerationRequest,
  ProviderCapabilities,
  ProviderJobStatus,
  UsageLimits,
  VideoGenerationRequest,
} from '../types.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderRetrieval,
  ProviderSubmission,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Minimal, genuinely valid PNG writer                                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const idx = (c ^ buf[i]!) & 0xff;
    c = CRC_TABLE[idx]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[o++] = rgb[0];
      raw[o++] = rgb[1];
      raw[o++] = rgb[2];
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Minimal MP4 container (placeholder, not playable video)             */
/* ------------------------------------------------------------------ */

function mp4Box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

export function makeMp4Placeholder(bytes = 2048): Buffer {
  const ftyp = mp4Box(
    'ftyp',
    Buffer.concat([
      Buffer.from('isom', 'ascii'),
      Buffer.from([0x00, 0x00, 0x02, 0x00]),
      Buffer.from('isomiso2mp41', 'ascii'),
    ]),
  );
  const mdat = mp4Box('mdat', Buffer.alloc(bytes));
  return Buffer.concat([ftyp, mdat]);
}

/* ------------------------------------------------------------------ */

export class FixtureProvider implements ProviderAdapter {
  readonly id = 'fixture';
  readonly displayName = 'Fixture provider (test only, synthetic output)';
  readonly paid = false;

  private readonly jobs = new Map<string, { kind: 'image' | 'video'; path: string }>();

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      provider: this.id,
      operational: true,
      modalities: {
        image: 'VERIFIED_WORKING',
        video: 'VERIFIED_WORKING',
        'image-to-video': 'VERIFIED_WORKING',
      },
      authentication: 'VERIFIED_WORKING',
      evidence: [],
      checkedOn: new Date().toISOString().slice(0, 10),
    };
  }

  async getAccountStatus(): Promise<AccountStatus> {
    return {
      provider: this.id,
      authenticated: true,
      unattended: true,
      accountLabel: 'fixture',
      detail: 'Test fixture. Produces synthetic placeholder media; never a real generation.',
    };
  }

  async authorize(): Promise<AccountStatus> {
    return this.getAccountStatus();
  }

  private write(ctx: ProviderContext, kind: 'image' | 'video'): { providerJobId: string; path: string } {
    mkdirSync(ctx.workDir, { recursive: true });
    const providerJobId = `fixture-${randomUUID()}`;
    const path = join(ctx.workDir, `${providerJobId}.${kind === 'image' ? 'png' : 'mp4'}`);
    const buf = kind === 'image' ? makePng(64, 64, [30, 90, 200]) : makeMp4Placeholder();
    writeFileSync(path, buf);
    this.jobs.set(providerJobId, { kind, path });
    return { providerJobId, path };
  }

  async generateImage(_r: ImageGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission> {
    const { providerJobId } = this.write(ctx, 'image');
    return {
      providerJobId,
      state: 'succeeded',
      notes: ['SYNTHETIC: fixture provider output, not a real image generation.'],
    };
  }

  async generateVideo(_r: VideoGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission> {
    const { providerJobId } = this.write(ctx, 'video');
    return {
      providerJobId,
      state: 'succeeded',
      notes: ['SYNTHETIC: fixture provider output, not a real video generation.'],
    };
  }

  async animateImage(_r: AnimateImageRequest, ctx: ProviderContext): Promise<ProviderSubmission> {
    const { providerJobId } = this.write(ctx, 'video');
    return {
      providerJobId,
      state: 'succeeded',
      notes: ['SYNTHETIC: fixture provider output, not a real animation.'],
    };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderJobStatus> {
    if (!this.jobs.has(providerJobId)) {
      throw new BlockedError(`Unknown fixture job "${providerJobId}".`, { detail: { providerJobId } });
    }
    return { providerJobId, state: 'succeeded', progress: 100 };
  }

  async waitForCompletion(providerJobId: string): Promise<ProviderJobStatus> {
    return this.getJobStatus(providerJobId);
  }

  async retrieveResult(providerJobId: string): Promise<ProviderRetrieval> {
    const job = this.jobs.get(providerJobId);
    if (!job) throw new BlockedError(`Unknown fixture job "${providerJobId}".`, { detail: { providerJobId } });
    return {
      assets: [{ localPath: job.path, kind: job.kind }],
      synthetic: true,
      notes: ['SYNTHETIC: fixture provider output.'],
    };
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    // Fixture jobs complete synchronously; nothing to cancel.
  }

  async getUsageLimits(): Promise<UsageLimits> {
    return { provider: this.id, remaining: null, limit: null, resetAt: null, detail: 'Fixture provider.' };
  }
}
