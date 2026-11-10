/**
 * The primary provider: `meta-vibes-free`.
 *
 * This adapter is deliberately inert. Every generation path returns a
 * structured BlockedError naming the missing capability and citing the official
 * source that was checked, because no legitimate unattended route to Meta Vibes
 * generation exists today.
 *
 * It exists as a real implementation, not a stub: it reports capability status,
 * refuses clearly, and is the single place a future verified integration would
 * be added. What it must never do is pretend.
 */

import { BlockedError } from '../errors.js';
import { buildProviderCapabilities, FEASIBILITY_CHECKED_ON } from '../evidence.js';
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

const EVIDENCE_URLS = [
  'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
  'https://dev.meta.ai/docs/models',
  'https://dev.meta.ai/docs/pricing-rate-limits',
];

const BLOCKED_MESSAGE =
  'Meta Vibes free-plan generation is not available through any legitimate unattended route. ' +
  'The Vibes experience is a consumer product with no published API; the only mechanisms that ' +
  'reach it are reverse-engineered cookie clients and browser automation, which Freevibes ' +
  'refuses to implement (product brief, section 2.4). No request was sent and no media was ' +
  'generated.';

function blocked(capability: string, extra: Record<string, unknown> = {}): BlockedError {
  return new BlockedError(BLOCKED_MESSAGE, {
    detail: {
      provider: 'meta-vibes-free',
      capability,
      checkedOn: FEASIBILITY_CHECKED_ON,
      missingApi: 'A documented generation endpoint with a sanctioned auth flow for third-party tools',
      missingPermission: 'No developer authorization surface exists for personal Vibes accounts',
      missingEntitlement: 'Free-plan entitlement is real but unreachable programmatically',
      ...extra,
    },
    evidenceUrls: EVIDENCE_URLS,
  });
}

export class MetaVibesFreeProvider implements ProviderAdapter {
  readonly id = 'meta-vibes-free';
  readonly displayName = 'Meta Vibes (free plan)';
  readonly paid = false;

  async getCapabilities(): Promise<ProviderCapabilities> {
    return buildProviderCapabilities(this.id);
  }

  async getAccountStatus(): Promise<AccountStatus> {
    return {
      provider: this.id,
      authenticated: false,
      unattended: false,
      detail:
        'No account is linked, because there is no sanctioned way for a local tool to obtain ' +
        'delegated access to a Vibes account. Freevibes will not read browser cookies or reuse a ' +
        'session token.',
    };
  }

  async authorize(): Promise<AccountStatus> {
    throw blocked('authorize', {
      reason:
        'There is no OAuth application registration, scope set or token exchange for Vibes. ' +
        'Authorization would require copying a browser session cookie, which is forbidden.',
    });
  }

  async generateImage(_request: ImageGenerationRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    throw blocked('generate_image');
  }

  async generateVideo(_request: VideoGenerationRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    throw blocked('generate_video');
  }

  async animateImage(_request: AnimateImageRequest, _ctx: ProviderContext): Promise<ProviderSubmission> {
    throw blocked('animate_image');
  }

  async getJobStatus(_providerJobId: string): Promise<ProviderJobStatus> {
    throw blocked('get_job_status');
  }

  async waitForCompletion(
    _providerJobId: string,
    _options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<ProviderJobStatus> {
    throw blocked('wait_for_completion');
  }

  async retrieveResult(_providerJobId: string): Promise<ProviderRetrieval> {
    throw blocked('retrieve_result');
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    throw blocked('cancel_job');
  }

  async getUsageLimits(): Promise<UsageLimits> {
    return {
      provider: this.id,
      remaining: null,
      limit: null,
      resetAt: null,
      detail:
        'Free-plan quotas are shown only inside the Vibes consumer UI. With no API there is no ' +
        'way to read them, so this is reported as unknown rather than guessed.',
    };
  }
}
