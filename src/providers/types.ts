/**
 * Provider contract.
 *
 * Every provider implements the same surface so the orchestrator never learns
 * provider-specific details. Methods are optional-by-behaviour rather than
 * optional-by-type: a provider that cannot do something throws a BlockedError
 * explaining what is missing, instead of returning an empty success.
 */

import type { Logger } from '../logger.js';
import type {
  AccountStatus,
  AnimateImageRequest,
  ImageGenerationRequest,
  JobState,
  ProviderCapabilities,
  ProviderJobStatus,
  UsageLimits,
  VideoGenerationRequest,
} from '../types.js';

export interface ProviderContext {
  logger: Logger;
  /** Directory the provider may write intermediate output into. */
  workDir: string;
}

/** What a provider returns after accepting a job. */
export interface ProviderSubmission {
  providerJobId: string;
  state: JobState;
  /** Non-fatal notes to surface to the caller. */
  notes?: string[];
}

/** One piece of media a provider says is ready. */
export interface RetrievedMedia {
  /** Remote URL to download, or a local path already on disk. */
  url?: string;
  localPath?: string;
  kind: 'image' | 'video';
  mimeType?: string;
}

export interface ProviderRetrieval {
  assets: RetrievedMedia[];
  /** True when the media is a placeholder produced by a test fixture. */
  synthetic: boolean;
  notes?: string[];
}

export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  /** True for any provider that bills the user. Never active in free mode. */
  readonly paid: boolean;

  getCapabilities(): Promise<ProviderCapabilities>;
  getAccountStatus(): Promise<AccountStatus>;
  authorize(): Promise<AccountStatus>;

  generateImage(request: ImageGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission>;
  generateVideo(request: VideoGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission>;
  animateImage(request: AnimateImageRequest, ctx: ProviderContext): Promise<ProviderSubmission>;

  getJobStatus(providerJobId: string): Promise<ProviderJobStatus>;
  waitForCompletion(providerJobId: string, options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<ProviderJobStatus>;
  retrieveResult(providerJobId: string): Promise<ProviderRetrieval>;
  cancelJob(providerJobId: string): Promise<void>;
  getUsageLimits(): Promise<UsageLimits>;
}
