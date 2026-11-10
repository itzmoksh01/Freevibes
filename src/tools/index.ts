/**
 * MCP tool definitions.
 *
 * Tool names and input field names follow the product brief exactly, so an
 * agent can call them without guessing. Every handler returns either a real
 * result or a structured failure — never a success it did not observe.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../context.js';
import { BlockedError, InvalidInputError, FreevibesError, toErrorPayload } from '../errors.js';
import type { JobState } from '../types.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

/**
 * Convert any thrown value into a tool result.
 *
 * A BLOCKED provider is reported as a structured, non-retryable failure with
 * the evidence that justifies it — not as an error page and not as a success.
 */
function toToolResult(err: unknown): ToolResult {
  if (err instanceof BlockedError) {
    const p = err.toPayload();
    return fail({
      ok: false,
      status: 'BLOCKED',
      reason: p.message,
      detail: p.detail ?? {},
      evidenceUrls: p.evidenceUrls ?? [],
      guidance:
        'No generation was attempted. Report this to the user as an unavailable capability. ' +
        'Do not retry, do not fall back to another provider, and do not describe the request as ' +
        'queued or in progress.',
    });
  }

  if (err instanceof FreevibesError) {
    const p = err.toPayload();
    return fail({ ok: false, status: p.code, reason: p.message, detail: p.detail ?? {}, retryable: p.retryable });
  }

  const p = toErrorPayload(err);
  return fail({ ok: false, status: 'INTERNAL_ERROR', reason: p.message });
}

// Shape only. Semantic checks (ratio format, duration bounds) live in the
// domain layer so that every rejection comes back as structured JSON rather
// than a protocol-level validation error the agent cannot parse.
const aspectRatio = z.string().optional().describe('Aspect ratio, for example "16:9", "9:16" or "1:1".');

export function registerTools(server: McpServer, ctx: AppContext): void {
  /* ---------------------------------------------------------------- */
  /* Capabilities                                                      */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_get_capabilities',
    {
      title: 'Get Freevibes capabilities',
      description:
        'Report which generation capabilities are actually available, with the official source ' +
        'behind each answer. Call this before requesting generation so you know what is possible.',
      inputSchema: {},
    },
    async () => {
      try {
        const capabilities = await ctx.provider.getCapabilities();
        const account = await ctx.provider.getAccountStatus();
        const limits = await ctx.provider.getUsageLimits();

        return ok({
          ok: true,
          mode: ctx.config.mode,
          provider: capabilities.provider,
          operational: capabilities.operational,
          modalities: capabilities.modalities,
          authentication: capabilities.authentication,
          blockedReason: capabilities.blockedReason ?? null,
          account,
          usageLimits: limits,
          checkedOn: capabilities.checkedOn,
          evidence: capabilities.evidence.map((e) => ({
            product: e.product,
            capability: e.capability,
            status: e.status,
            verifiedOn: e.verifiedOn,
            sourceUrl: e.sourceUrl,
            summary: e.summary,
            blockingReason: e.blockingReason ?? null,
          })),
          note: capabilities.operational
            ? 'Generation is available.'
            : 'Generation is NOT available. Report the blocked reason to the user and do not ' +
              'promise output. See docs/META-FEASIBILITY.md in the repository.',
        });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Image generation                                                  */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_generate_image',
    {
      title: 'Generate an image',
      description:
        'Generate one or more images from a structured prompt. Returns the on-disk path of every ' +
        'validated asset. Fails with a structured BLOCKED result when no legitimate provider is available.',
      inputSchema: {
        prompt: z.string().describe('What the image should show.'),
        style: z.string().optional().describe('Visual style, for example "cinematic", "watercolour".'),
        subject: z.string().optional().describe('Primary subject.'),
        composition: z.string().optional().describe('Framing or composition, for example "close-up".'),
        lighting: z.string().optional().describe('Lighting description.'),
        aspect_ratio: aspectRatio,
        reference_images: z.array(z.string()).optional().describe('Absolute paths to reference images.'),
        output_count: z.number().int().optional().describe('How many images to produce (1-4).'),
      },
    },
    async (args) => {
      try {
        if (args.output_count !== undefined && (args.output_count < 1 || args.output_count > 4)) {
          throw new InvalidInputError('output_count must be between 1 and 4.', { field: 'output_count' });
        }
        const result = await ctx.orchestrator.generateImage({
          prompt: args.prompt,
          ...(args.style !== undefined ? { style: args.style } : {}),
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.composition !== undefined ? { composition: args.composition } : {}),
          ...(args.lighting !== undefined ? { lighting: args.lighting } : {}),
          ...(args.aspect_ratio !== undefined ? { aspectRatio: args.aspect_ratio } : {}),
          ...(args.reference_images !== undefined ? { referenceImages: args.reference_images } : {}),
          ...(args.output_count !== undefined ? { outputCount: args.output_count } : {}),
        });
        return ok({ ok: true, ...result });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Video generation                                                  */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_generate_video',
    {
      title: 'Generate a video',
      description:
        'Generate a video from a structured prompt. Returns the on-disk path of the validated MP4. ' +
        'Fails with a structured BLOCKED result when no legitimate provider is available.',
      inputSchema: {
        prompt: z.string().describe('What the video should show.'),
        subject: z.string().optional().describe('Primary subject.'),
        scene: z.string().optional().describe('Setting or environment.'),
        action: z.string().optional().describe('What happens in the shot.'),
        camera_movement: z.string().optional().describe('Camera motion, for example "slow push-in".'),
        lighting: z.string().optional().describe('Lighting description.'),
        visual_style: z.string().optional().describe('Visual style.'),
        duration: z.number().int().optional().describe('Clip length in seconds (1-60).'),
        aspect_ratio: aspectRatio,
        audio_preferences: z.string().optional().describe('Audio or music preference.'),
        reference_images: z.array(z.string()).optional().describe('Absolute paths to reference images.'),
      },
    },
    async (args) => {
      try {
        const result = await ctx.orchestrator.generateVideo({
          prompt: args.prompt,
          ...(args.subject !== undefined ? { subject: args.subject } : {}),
          ...(args.scene !== undefined ? { scene: args.scene } : {}),
          ...(args.action !== undefined ? { action: args.action } : {}),
          ...(args.camera_movement !== undefined ? { cameraMovement: args.camera_movement } : {}),
          ...(args.lighting !== undefined ? { lighting: args.lighting } : {}),
          ...(args.visual_style !== undefined ? { visualStyle: args.visual_style } : {}),
          ...(args.duration !== undefined ? { durationSeconds: args.duration } : {}),
          ...(args.aspect_ratio !== undefined ? { aspectRatio: args.aspect_ratio } : {}),
          ...(args.audio_preferences !== undefined ? { audioPreferences: args.audio_preferences } : {}),
          ...(args.reference_images !== undefined ? { referenceImages: args.reference_images } : {}),
        });
        return ok({ ok: true, ...result });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Image to video                                                    */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_animate_image',
    {
      title: 'Animate an image',
      description:
        'Animate a still image into a video. Returns the on-disk path of the validated video. ' +
        'Fails with a structured BLOCKED result when no legitimate provider is available.',
      inputSchema: {
        source_image_path: z.string().describe('Absolute path to the image to animate.'),
        animation_prompt: z.string().describe('How the image should move.'),
        subject_movement: z.string().optional().describe('How the subject moves.'),
        environment_movement: z.string().optional().describe('How the environment moves.'),
        camera_movement: z.string().optional().describe('Camera motion.'),
        visual_style: z.string().optional().describe('Visual style.'),
        duration: z.number().int().optional().describe('Clip length in seconds (1-60).'),
      },
    },
    async (args) => {
      try {
        const result = await ctx.orchestrator.animateImage({
          sourceImagePath: args.source_image_path,
          animationPrompt: args.animation_prompt,
          ...(args.subject_movement !== undefined ? { subjectMovement: args.subject_movement } : {}),
          ...(args.environment_movement !== undefined ? { environmentMovement: args.environment_movement } : {}),
          ...(args.camera_movement !== undefined ? { cameraMovement: args.camera_movement } : {}),
          ...(args.visual_style !== undefined ? { visualStyle: args.visual_style } : {}),
          ...(args.duration !== undefined ? { durationSeconds: args.duration } : {}),
        });
        return ok({ ok: true, ...result });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Job inspection                                                    */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_get_job_status',
    {
      title: 'Get job status',
      description: 'Return the recorded state, history and stored assets for one job.',
      inputSchema: {
        job_id: z.string().min(1).describe('The job id returned by a generation tool.'),
      },
    },
    async (args) => {
      try {
        const job = ctx.jobs.get(args.job_id);
        return ok({
          ok: true,
          job: {
            id: job.id,
            provider: job.provider,
            modality: job.modality,
            state: job.state,
            prompt: job.prompt,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            completedAt: job.completedAt,
            errorCode: job.errorCode,
            errorMessage: job.errorMessage,
            outputPaths: job.outputPaths,
          },
          history: ctx.jobs.events(job.id),
          assets: ctx.assets.listByJob(job.id),
        });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  server.registerTool(
    'freevibes_list_jobs',
    {
      title: 'List jobs',
      description: 'List recent jobs, newest first, optionally filtered by state.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Maximum rows to return (default 20).'),
        state: z
          .enum(['queued', 'submitted', 'running', 'succeeded', 'failed', 'cancelled', 'blocked', 'interrupted'])
          .optional()
          .describe('Only return jobs in this state.'),
      },
    },
    async (args) => {
      try {
        const jobs = ctx.jobs.list({
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.state !== undefined ? { state: args.state as JobState } : {}),
        });
        return ok({
          ok: true,
          count: jobs.length,
          jobs: jobs.map((j) => ({
            id: j.id,
            modality: j.modality,
            state: j.state,
            prompt: j.prompt.slice(0, 120),
            createdAt: j.createdAt,
            outputPaths: j.outputPaths,
          })),
        });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  server.registerTool(
    'freevibes_cancel_job',
    {
      title: 'Cancel a job',
      description: 'Ask the provider to cancel a job that has not reached a terminal state.',
      inputSchema: {
        job_id: z.string().min(1).describe('The job id to cancel.'),
      },
    },
    async (args) => {
      try {
        const job = ctx.jobs.get(args.job_id);
        if (['succeeded', 'failed', 'cancelled', 'blocked'].includes(job.state)) {
          return ok({ ok: true, jobId: job.id, state: job.state, note: 'Job already reached a terminal state.' });
        }
        if (job.providerJobId) {
          await ctx.provider.cancelJob(job.providerJobId);
        }
        const updated = ctx.jobs.transition(job.id, 'cancelled', { detail: 'cancelled by request' });
        return ok({ ok: true, jobId: updated.id, state: updated.state });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  server.registerTool(
    'freevibes_get_usage_limits',
    {
      title: 'Get usage limits',
      description: 'Report remaining generation allowance where the provider can actually report it.',
      inputSchema: {},
    },
    async () => {
      try {
        const limits = await ctx.provider.getUsageLimits();
        return ok({ ok: true, ...limits });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* Diagnostics                                                       */
  /* ---------------------------------------------------------------- */
  server.registerTool(
    'freevibes_doctor',
    {
      title: 'Diagnose the installation',
      description:
        'Check configuration, database, asset directory and provider status. Use this when ' +
        'generation is failing for an unclear reason.',
      inputSchema: {},
    },
    async () => {
      try {
        const capabilities = await ctx.provider.getCapabilities();
        const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

        checks.push({ name: 'node_version', ok: Number(process.versions.node.split('.')[0]) >= 20, detail: process.versions.node });
        checks.push({ name: 'mode', ok: ctx.config.mode === 'free-meta-vibes', detail: ctx.config.mode });
        checks.push({ name: 'paid_providers', ok: !ctx.config.allowPaidProviders, detail: 'disabled' });
        checks.push({ name: 'database', ok: true, detail: `${ctx.config.dbPath} (schema v${ctx.schemaVersion}, WAL)` });

        try {
          await ctx.assets.ensureDirs();
          checks.push({ name: 'asset_directory', ok: true, detail: ctx.config.assetDir });
        } catch (err) {
          checks.push({
            name: 'asset_directory',
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          });
        }

        checks.push({
          name: 'provider',
          ok: capabilities.operational,
          detail: capabilities.operational
            ? `${capabilities.provider} is operational`
            : `${capabilities.provider} is not operational: ${capabilities.blockedReason ?? 'blocked'}`,
        });

        return ok({
          ok: checks.every((c) => c.ok),
          checks,
          capabilities: {
            provider: capabilities.provider,
            operational: capabilities.operational,
            modalities: capabilities.modalities,
            checkedOn: capabilities.checkedOn,
          },
          jobsByState: ctx.jobs.countByState(),
          recoveredJobs: ctx.recoveredJobs,
        });
      } catch (err) {
        return toToolResult(err);
      }
    },
  );
}
