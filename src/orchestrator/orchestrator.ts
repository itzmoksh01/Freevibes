/**
 * Job orchestrator.
 *
 * Owns the lifecycle of a generation request: validate, record, submit, wait,
 * retrieve, download, validate, store, report. The provider is the only
 * provider-shaped thing it knows about, and a provider that cannot serve a
 * request produces a recorded `blocked` job rather than a fabricated result.
 */

import { stat } from 'node:fs/promises';
import type { FreevibesConfig } from '../config.js';
import type { JobStore } from '../db/job-store.js';
import { BlockedError, InvalidInputError, FreevibesError, toErrorPayload } from '../errors.js';
import type { Logger } from '../logger.js';
import type { AssetManager } from '../media/assets.js';
import type { MediaKind } from '../media/validator.js';
import {
  composeAnimationPrompt,
  composeImagePrompt,
  composeVideoPrompt,
  type ComposedPrompt,
} from '../prompt/engine.js';
import type { ProviderAdapter, ProviderContext, ProviderSubmission } from '../providers/types.js';
import type {
  AnimateImageRequest,
  GenerationResult,
  ImageGenerationRequest,
  MediaAsset,
  Modality,
  VideoGenerationRequest,
} from '../types.js';

export interface OrchestratorDeps {
  provider: ProviderAdapter;
  jobs: JobStore;
  assets: AssetManager;
  config: FreevibesConfig;
  logger: Logger;
}

async function assertLocalFilesExist(paths: string[] | undefined, field: string): Promise<void> {
  if (!paths || paths.length === 0) return;
  for (const p of paths) {
    try {
      const info = await stat(p);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw new InvalidInputError(`${field} refers to a file that does not exist: ${p}`, { field, path: p });
    }
  }
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  private get ctx(): ProviderContext {
    return { logger: this.deps.logger, workDir: this.deps.config.dataDir };
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const composed = composeImagePrompt(request);
    await assertLocalFilesExist(request.referenceImages, 'reference_images');
    return this.run({
      modality: 'image',
      composed,
      request,
      submit: () => this.deps.provider.generateImage(request, this.ctx),
      mediaKind: 'image',
    });
  }

  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    const composed = composeVideoPrompt(request);
    await assertLocalFilesExist(request.referenceImages, 'reference_images');
    return this.run({
      modality: 'video',
      composed,
      request,
      submit: () => this.deps.provider.generateVideo(request, this.ctx),
      mediaKind: 'video',
    });
  }

  async animateImage(request: AnimateImageRequest): Promise<GenerationResult> {
    const composed = composeAnimationPrompt(request);
    await assertLocalFilesExist([request.sourceImagePath], 'source_image_path');
    return this.run({
      modality: 'image-to-video',
      composed,
      request,
      submit: () => this.deps.provider.animateImage(request, this.ctx),
      mediaKind: 'video',
    });
  }

  private async run(args: {
    modality: Modality;
    composed: ComposedPrompt;
    request: unknown;
    submit: () => Promise<ProviderSubmission>;
    mediaKind: MediaKind;
  }): Promise<GenerationResult> {
    const { jobs, provider, assets, config, logger } = this.deps;

    const job = jobs.create({
      provider: provider.id,
      modality: args.modality,
      prompt: args.composed.prompt,
      request: args.request,
    });

    logger.info('job created', { jobId: job.id, modality: args.modality, provider: provider.id });

    // 1. Submit.
    let submission: ProviderSubmission;
    try {
      jobs.transition(job.id, 'submitted', { incrementAttempts: true, detail: 'submitted to provider' });
      submission = await args.submit();
    } catch (err) {
      if (err instanceof BlockedError) {
        const payload = err.toPayload();
        jobs.transition(job.id, 'blocked', {
          errorCode: payload.code,
          errorMessage: payload.message,
          detail: 'provider reported the capability as blocked',
        });
        logger.warn('job blocked', { jobId: job.id, code: payload.code });
        throw err;
      }
      const payload = toErrorPayload(err);
      jobs.transition(job.id, 'failed', {
        errorCode: payload.code,
        errorMessage: payload.message,
        detail: 'provider submission failed',
      });
      logger.error('job submission failed', { jobId: job.id, code: payload.code });
      throw err;
    }

    jobs.transition(job.id, 'running', {
      providerJobId: submission.providerJobId,
      detail: 'provider accepted the job',
    });

    // 2. Wait.
    try {
      await provider.waitForCompletion(submission.providerJobId, {
        timeoutMs: config.jobTimeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      });
    } catch (err) {
      if (err instanceof BlockedError) {
        jobs.transition(job.id, 'blocked', {
          errorCode: 'BLOCKED',
          errorMessage: err.message,
          detail: 'provider reported the capability as blocked',
        });
        throw err;
      }
      const payload = toErrorPayload(err);
      jobs.transition(job.id, 'failed', {
        errorCode: payload.code,
        errorMessage: payload.message,
        detail: 'job did not complete',
      });
      throw err;
    }

    // 3. Retrieve and store.
    const stored: MediaAsset[] = [];
    let synthetic = false;
    try {
      const retrieval = await provider.retrieveResult(submission.providerJobId);
      synthetic = retrieval.synthetic;
      if (retrieval.assets.length === 0) {
        throw new FreevibesError('PROVIDER_ERROR', 'Provider reported success but returned no media.');
      }

      for (const media of retrieval.assets) {
        if (media.localPath) {
          stored.push(await assets.storeLocalFile(media.localPath, media.kind ?? args.mediaKind, job.id, args.composed.prompt));
        } else if (media.url) {
          stored.push(await assets.downloadAndStore(media.url, media.kind ?? args.mediaKind, job.id, args.composed.prompt));
        } else {
          throw new FreevibesError('PROVIDER_ERROR', 'Retrieved media had neither a URL nor a local path.');
        }
      }
    } catch (err) {
      const payload = toErrorPayload(err);
      jobs.transition(job.id, 'failed', {
        errorCode: payload.code,
        errorMessage: payload.message,
        detail: 'result retrieval or storage failed',
      });
      logger.error('job retrieval failed', { jobId: job.id, code: payload.code });
      throw err;
    }

    jobs.transition(job.id, 'succeeded', {
      outputPaths: stored.map((a) => a.path),
      detail: `${stored.length} asset(s) stored`,
    });

    logger.info('job succeeded', { jobId: job.id, assets: stored.length });

    const result: GenerationResult = {
      jobId: job.id,
      provider: provider.id,
      providerJobId: submission.providerJobId,
      assets: stored,
      synthetic,
    };
    const notes = [...(submission.notes ?? [])];
    if (notes.length > 0) result.notes = notes;
    return result;
  }
}
