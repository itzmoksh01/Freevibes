/**
 * Unofficial Meta Vibes provider — `vibes-unofficial`.
 *
 * WHAT THIS IS
 * ------------
 * Meta publishes no API for Vibes. The only working route is the one the
 * community reverse-engineered: replay the session cookie your browser got when
 * you signed in at vibes.ai. This provider does not reimplement that work. It
 * drives **VibesAI-api** (github.com/mir-ashiq/VibesAI-api), a maintained Python
 * client and REST server that already speaks the private endpoints, keeps the
 * session refreshed in the background, and can re-login automatically from
 * auth.meta.com cookies.
 *
 *   Freevibes (TypeScript, MCP)  →  HTTP  →  VibesAI-api sidecar (Python)  →  vibes.ai
 *
 * WHAT IT IS NOT
 * --------------
 * It is not sanctioned by Meta. It may violate the Vibes terms of service, it
 * can break the moment Meta changes their web app, and a session cookie is a
 * live credential. It is therefore:
 *
 *   - off by default (FREEVIBES_ALLOW_UNOFFICIAL must be true),
 *   - never selected automatically,
 *   - reported as `UNOFFICIAL` in capabilities, never as verified or supported,
 *   - honest about failures: a broken sidecar is an error, not a fake result.
 *
 * The default `meta-vibes-free` provider stays the honest, blocked one.
 */

import type { FreevibesConfig } from '../config.js';
import { BlockedError, ProviderError } from '../errors.js';
import type {
  AccountStatus,
  AnimateImageRequest,
  CapabilityEvidence,
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
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const SIDECAR_REPO = 'https://github.com/mir-ashiq/VibesAI-api';
const VIBES_HELP = 'https://www.meta.com/help/artificial-intelligence/1337455336906126/';

const EVIDENCE_URLS = [SIDECAR_REPO, VIBES_HELP];

const UNOFFICIAL_NOTE =
  'Unofficial route: Meta publishes no Vibes API, so this drives a reverse-engineered ' +
  'client that replays a browser session cookie. Meta does not sanction it, it may ' +
  'violate the Vibes terms, and it can break without notice.';

interface BatchContent {
  id?: string;
  type?: string;
  url?: string;
  [key: string]: unknown;
}

interface Batch {
  id?: string;
  isComplete?: boolean;
  hasError?: boolean;
  error?: unknown;
  content?: BatchContent[];
  [key: string]: unknown;
}

interface SidecarHealth {
  status?: string;
  [key: string]: unknown;
}

function evidence(capability: string, summary: string): CapabilityEvidence {
  return {
    product: 'Meta AI Vibes (unofficial route)',
    capability,
    modality: 'video',
    status: 'UNOFFICIAL',
    verifiedOn: new Date().toISOString().slice(0, 10),
    sourceUrl: SIDECAR_REPO,
    summary,
    automationPermitted: false,
    blockingReason: UNOFFICIAL_NOTE,
  };
}

export class VibesUnofficialProvider implements ProviderAdapter {
  readonly id = 'vibes-unofficial';
  readonly displayName = 'Meta Vibes (unofficial, via VibesAI-api sidecar)';
  /** Not a paid API: it spends the user's own free Vibes entitlement. */
  readonly paid = false;
  /** Marks the provider as operating outside vendor sanction. */
  readonly unofficial = true;

  /** Cached vibes.ai project id, created on first use. */
  private projectId: string | null = null;
  /** Which media kind each batch produced, so retrieval knows what to expect. */
  private readonly batchKinds = new Map<string, 'image' | 'video'>();

  constructor(private readonly config: FreevibesConfig) {}

  /* ---------------------------------------------------------------- */
  /* HTTP plumbing                                                     */
  /* ---------------------------------------------------------------- */

  private url(path: string): string {
    return `${this.config.vibesBaseUrl}${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    if (this.config.vibesApiKey) headers['x-api-key'] = this.config.vibesApiKey;
    return headers;
  }

  private async call<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? this.config.vibesRequestTimeoutMs;
    const headers = this.headers(
      init.body ? { 'content-type': 'application/json' } : {},
    );

    let response: Response;
    try {
      response = await fetch(this.url(path), {
        ...init,
        headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new ProviderError(
        `Could not reach the Vibes sidecar at ${this.config.vibesBaseUrl}. Is it running? ` +
          `See docs/UNOFFICIAL-VIBES.md. (${err instanceof Error ? err.message : String(err)})`,
        { detail: { baseUrl: this.config.vibesBaseUrl, path }, retryable: true, cause: err },
      );
    }

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      const detail = (body as { detail?: unknown })?.detail ?? body;
      const hint =
        response.status === 401 || response.status === 403
          ? ' The vibes.ai session cookie was rejected or has expired. Restart the sidecar with a ' +
            'fresh VIBES_META_SESSION, and set AUTH_META_COOKIES so it can re-login by itself.'
          : response.status === 502
            ? ' The sidecar could not reach vibes.ai; the session cookie is most likely invalid.'
            : '';

      // Surface the sidecar's own reason when it provides one, rather than
      // reporting only the status code.
      let reason = '';
      if (typeof detail === 'string') reason = detail;
      else if (detail && typeof detail === 'object') {
        const d = detail as Record<string, unknown>;
        const candidate = d.error ?? d.message ?? d.code;
        if (typeof candidate === 'string') reason = candidate;
      }

      throw new ProviderError(
        `Vibes sidecar returned HTTP ${response.status}` +
          `${reason ? `: ${reason.slice(0, 200)}` : ''}.${hint}`,
        {
          detail: { status: response.status, path, body: detail },
          retryable: response.status >= 500 || response.status === 429,
        },
      );
    }

    return body as T;
  }

  /* ---------------------------------------------------------------- */
  /* Capabilities                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Probe the sidecar. Short timeout: this must not slow a capabilities call.
   *
   * The sidecar answers /health with HTTP 200 even when its own upstream is
   * failing, reporting `{"status":"unhealthy"}`. Treating that as "reachable,
   * therefore operational" would advertise generation while every request is
   * doomed, so the status field is checked as well as the response code.
   */
  async probe(): Promise<{ reachable: boolean; healthy: boolean; detail: string }> {
    try {
      const health = await this.call<SidecarHealth>('/health', {}, 5_000);
      const status = String(health?.status ?? 'ok').toLowerCase();
      const healthy = status === 'ok' || status === 'healthy' || status === 'up';
      return {
        reachable: true,
        healthy,
        detail: healthy
          ? `sidecar healthy (${status})`
          : `sidecar reports "${status}": ${JSON.stringify(health).slice(0, 300)}`,
      };
    } catch (err) {
      return {
        reachable: false,
        healthy: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const { reachable, healthy, detail } = await this.probe();
    const checkedOn = new Date().toISOString().slice(0, 10);

    if (!reachable) {
      return {
        provider: this.id,
        operational: false,
        modalities: { image: 'UNVERIFIED', video: 'UNVERIFIED', 'image-to-video': 'UNVERIFIED' },
        authentication: 'UNVERIFIED',
        blockedReason:
          `The Vibes sidecar is not reachable at ${this.config.vibesBaseUrl}. Start it, then ` +
          'retry. Nothing was generated.',
        evidence: [
          evidence('Sidecar reachability', `Probe of ${this.config.vibesBaseUrl}/health failed: ${detail}`),
        ],
        checkedOn,
      };
    }

    if (!healthy) {
      return {
        provider: this.id,
        operational: false,
        modalities: { image: 'UNVERIFIED', video: 'UNVERIFIED', 'image-to-video': 'UNVERIFIED' },
        authentication: 'UNVERIFIED',
        blockedReason:
          'The sidecar is running but reports itself unhealthy, so generation would fail. ' +
          'Usually this means the vibes.ai session cookie is missing or expired: restart the ' +
          'sidecar with a fresh VIBES_META_SESSION, and set AUTH_META_COOKIES so it can ' +
          `re-login by itself. Detail: ${detail}`,
        evidence: [evidence('Sidecar health', detail)],
        checkedOn,
      };
    }

    return {
      provider: this.id,
      operational: true,
      modalities: { image: 'UNOFFICIAL', video: 'UNOFFICIAL', 'image-to-video': 'UNOFFICIAL' },
      authentication: 'UNOFFICIAL',
      evidence: [
        evidence(
          'Text-to-video, image-to-video, text-to-image',
          'The sidecar exposes /api/v1/videos/generate, /api/v1/images/generate and ' +
            '/api/v1/videos/generate with a start_frame (generationType i2v). Endpoints were ' +
            'confirmed against the sidecar’s own OpenAPI schema, not against a live Meta request.',
        ),
        evidence(
          'Session refresh and automatic re-login',
          'The sidecar refreshes the vibes.ai session in the background (default every 1500s) ' +
            'and can re-login from auth.meta.com cookies, so the user copies cookies once rather ' +
            'than for every job.',
        ),
      ],
      checkedOn,
    };
  }

  async getAccountStatus(): Promise<AccountStatus> {
    try {
      const me = await this.call<Record<string, unknown>>('/api/v1/me', {}, 10_000);
      const label =
        (me?.username as string) ??
        (me?.name as string) ??
        (me?.user as { username?: string } | undefined)?.username ??
        'vibes.ai account';
      return {
        provider: this.id,
        authenticated: true,
        unattended: true,
        accountLabel: label,
        detail: UNOFFICIAL_NOTE,
      };
    } catch (err) {
      return {
        provider: this.id,
        authenticated: false,
        unattended: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async authorize(): Promise<AccountStatus> {
    throw new BlockedError(
      'There is nothing to authorize here. This provider has no OAuth flow: the sidecar ' +
        'authenticates with a browser session cookie you copy once from vibes.ai. See ' +
        'docs/UNOFFICIAL-VIBES.md.',
      { evidenceUrls: EVIDENCE_URLS },
    );
  }

  /* ---------------------------------------------------------------- */
  /* Project handling                                                  */
  /* ---------------------------------------------------------------- */

  private async ensureProject(): Promise<string> {
    if (this.projectId) return this.projectId;

    const list = await this.call<unknown>('/api/v1/projects?limit=50', {}, 20_000);
    const projects: Array<Record<string, unknown>> = Array.isArray(list)
      ? (list as Array<Record<string, unknown>>)
      : Array.isArray((list as { projects?: unknown })?.projects)
        ? ((list as { projects: Array<Record<string, unknown>> }).projects)
        : [];

    const existing = projects.find((p) => p?.name === this.config.vibesProjectName);
    if (existing && typeof existing.id === 'string') {
      this.projectId = existing.id;
      return existing.id;
    }

    const created = await this.call<Record<string, unknown>>(
      '/api/v1/projects',
      { method: 'POST', body: JSON.stringify({ name: this.config.vibesProjectName }) },
      20_000,
    );
    const id = created?.id ?? (created?.project as { id?: string } | undefined)?.id;
    if (typeof id !== 'string') {
      throw new ProviderError('The sidecar did not return a project id.', { detail: { created } });
    }
    this.projectId = id;
    return id;
  }

  /* ---------------------------------------------------------------- */
  /* Generation                                                        */
  /* ---------------------------------------------------------------- */

  private async submit(
    body: Record<string, unknown>,
    kind: 'image' | 'video',
  ): Promise<ProviderSubmission> {
    const projectId = await this.ensureProject();
    const path = kind === 'image' ? '/api/v1/images/generate' : '/api/v1/videos/generate';

    // poll:false so this call returns as soon as the batch exists; the
    // orchestrator owns waiting, timeouts and job state.
    const batch = await this.call<Batch>(
      path,
      { method: 'POST', body: JSON.stringify({ ...body, project_id: projectId, poll: false }) },
    );

    const batchId = batch?.id ?? (batch?.batch as { id?: string } | undefined)?.id;
    if (typeof batchId !== 'string') {
      throw new ProviderError('The sidecar did not return a batch id.', { detail: { batch } });
    }

    this.batchKinds.set(batchId, kind);

    return {
      providerJobId: batchId,
      state: batch.isComplete ? 'running' : 'running',
      notes: [UNOFFICIAL_NOTE],
    };
  }

  async generateImage(request: ImageGenerationRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    return this.submit(
      {
        prompt: request.prompt,
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.outputCount ? { variations: Math.min(Math.max(request.outputCount, 1), 4) } : {}),
      },
      'image',
    );
  }

  async generateVideo(request: VideoGenerationRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    return this.submit(
      {
        prompt: request.prompt,
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        // One variation by default: each one spends the user's free quota.
        variations: 1,
      },
      'video',
    );
  }

  async animateImage(request: AnimateImageRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    const bytes = await readFile(request.sourceImagePath);
    const uploaded = await this.call<Record<string, unknown>>(
      '/api/v1/upload/image',
      { method: 'POST', body: JSON.stringify({ image_base64: bytes.toString('base64') }) },
    );

    const handle = {
      oil_handle: uploaded?.imageHandle ?? uploaded?.oil_handle ?? null,
      image_url: uploaded?.imageUrl ?? uploaded?.image_url ?? null,
      image_ent_id: uploaded?.mediaEntId ?? uploaded?.image_ent_id ?? null,
      source: 'upload',
    };

    return this.submit(
      {
        prompt: request.animationPrompt,
        start_frame: handle,
        variations: 1,
      },
      'video',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Job lifecycle                                                     */
  /* ---------------------------------------------------------------- */

  private toStatus(batchId: string, batch: Batch): ProviderJobStatus {
    if (batch?.hasError) {
      return {
        providerJobId: batchId,
        state: 'failed',
        message: typeof batch.error === 'string' ? batch.error : JSON.stringify(batch.error ?? 'generation failed'),
      };
    }
    if (batch?.isComplete) {
      return { providerJobId: batchId, state: 'succeeded', progress: 100 };
    }
    return { providerJobId: batchId, state: 'running' };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const batch = await this.call<Batch>(`/api/v1/batches/${encodeURIComponent(providerJobId)}`, {}, 20_000);
    return this.toStatus(providerJobId, batch);
  }

  async waitForCompletion(
    providerJobId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<ProviderJobStatus> {
    const timeoutMs = options?.timeoutMs ?? this.config.jobTimeoutMs;
    const intervalMs = options?.pollIntervalMs ?? this.config.pollIntervalMs;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await this.getJobStatus(providerJobId);
      if (status.state === 'succeeded' || status.state === 'failed') return status;

      if (Date.now() >= deadline) {
        throw new ProviderError(
          `Vibes generation did not finish within ${Math.round(timeoutMs / 1000)}s. The job may ` +
            'still complete on vibes.ai; check the project in the web app.',
          { detail: { providerJobId, timeoutMs }, retryable: true },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async retrieveResult(providerJobId: string): Promise<ProviderRetrieval> {
    const batch = await this.call<Batch>(`/api/v1/batches/${encodeURIComponent(providerJobId)}`, {}, 20_000);
    const kind = this.batchKinds.get(providerJobId) ?? 'video';
    const items = Array.isArray(batch?.content) ? batch.content : [];

    const assets = items
      .filter((item): item is BatchContent & { id: string } => typeof item?.id === 'string')
      .map((item) => ({
        url: this.url(
          `/api/v1/media/${encodeURIComponent(item.id)}/download?type=${kind === 'video' ? 'video' : 'image'}`,
        ),
        kind,
        ...(this.config.vibesApiKey ? { headers: { 'x-api-key': this.config.vibesApiKey } } : {}),
      }));

    if (assets.length === 0) {
      throw new ProviderError('The batch reported completion but contained no media items.', {
        detail: { providerJobId, batch },
      });
    }

    return { assets, synthetic: false, notes: [UNOFFICIAL_NOTE] };
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    throw new BlockedError(
      'The Vibes sidecar exposes no cancel endpoint, so a submitted generation cannot be ' +
        'stopped. It will finish or fail on its own.',
      { evidenceUrls: [SIDECAR_REPO] },
    );
  }

  async getUsageLimits(): Promise<UsageLimits> {
    return {
      provider: this.id,
      remaining: null,
      limit: null,
      resetAt: null,
      detail:
        'Free-plan quota is shown only inside the vibes.ai UI; the sidecar does not expose a ' +
        'usage endpoint. Reported as unknown rather than guessed. A 429 from the sidecar means ' +
        'the quota is exhausted.',
    };
  }

  /** Human-readable label used in notes and logs. */
  static displayNameFor(path: string): string {
    return basename(path);
  }
}
