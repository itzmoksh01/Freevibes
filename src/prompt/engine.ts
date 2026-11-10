/**
 * Prompt engine.
 *
 * Deterministic, offline composition of a structured request into a single
 * coherent prompt. No model is called, nothing is invented about the subject,
 * and the same input always produces the same output — which is what makes it
 * testable.
 *
 * The engine also validates the fields a provider would care about, so bad
 * input is rejected before any provider is touched.
 */

import { InvalidInputError } from '../errors.js';
import type { AnimateImageRequest, ImageGenerationRequest, VideoGenerationRequest } from '../types.js';

export const MAX_PROMPT_CHARS = 2000;
export const MIN_DURATION_SECONDS = 1;
export const MAX_DURATION_SECONDS = 60;

const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/;

export interface ComposedPrompt {
  prompt: string;
  /** The individual clauses, in the order they were emitted. */
  segments: string[];
  /** True when the composed prompt hit MAX_PROMPT_CHARS and was cut. */
  truncated: boolean;
}

function normalise(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

function compose(segments: Array<string | undefined>): ComposedPrompt {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const raw of segments) {
    const s = normalise(raw);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(s);
  }

  if (kept.length === 0) {
    throw new InvalidInputError('The request produced an empty prompt.');
  }

  let prompt = kept.join('. ');
  let truncated = false;
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS - 1).trimEnd() + '…';
    truncated = true;
  }

  return { prompt, segments: kept, truncated };
}

export function validateAspectRatio(value: string | undefined): string | undefined {
  const v = normalise(value);
  if (v === undefined) return undefined;
  if (!ASPECT_RATIO_PATTERN.test(v)) {
    throw new InvalidInputError(
      `aspect_ratio must look like "16:9" or "1:1", received "${v}".`,
      { field: 'aspect_ratio' },
    );
  }
  const [w, h] = v.split(':').map(Number) as [number, number];
  if (w <= 0 || h <= 0) {
    throw new InvalidInputError(`aspect_ratio components must be positive, received "${v}".`, {
      field: 'aspect_ratio',
    });
  }
  return v;
}

export function validateDuration(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvalidInputError('duration must be a whole number of seconds.', { field: 'duration' });
  }
  if (value < MIN_DURATION_SECONDS || value > MAX_DURATION_SECONDS) {
    throw new InvalidInputError(
      `duration must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds, received ${value}.`,
      { field: 'duration' },
    );
  }
  return value;
}

export function requirePrompt(value: string, field = 'prompt'): string {
  const v = normalise(value);
  if (!v) throw new InvalidInputError(`${field} must not be empty.`, { field });
  return v;
}

export function composeImagePrompt(request: ImageGenerationRequest): ComposedPrompt {
  const base = requirePrompt(request.prompt);
  return compose([
    base,
    request.subject ? `Subject: ${request.subject}` : undefined,
    request.style ? `Style: ${request.style}` : undefined,
    request.composition ? `Composition: ${request.composition}` : undefined,
    request.lighting ? `Lighting: ${request.lighting}` : undefined,
    validateAspectRatio(request.aspectRatio)
      ? `Aspect ratio: ${validateAspectRatio(request.aspectRatio)}`
      : undefined,
  ]);
}

export function composeVideoPrompt(request: VideoGenerationRequest): ComposedPrompt {
  const base = requirePrompt(request.prompt);
  const duration = validateDuration(request.durationSeconds);
  const aspect = validateAspectRatio(request.aspectRatio);

  return compose([
    base,
    request.scene ? `Scene: ${request.scene}` : undefined,
    request.subject ? `Subject: ${request.subject}` : undefined,
    request.action ? `Action: ${request.action}` : undefined,
    request.cameraMovement ? `Camera: ${request.cameraMovement}` : undefined,
    request.lighting ? `Lighting: ${request.lighting}` : undefined,
    request.visualStyle ? `Visual style: ${request.visualStyle}` : undefined,
    duration !== undefined ? `Duration: ${duration} seconds` : undefined,
    aspect ? `Aspect ratio: ${aspect}` : undefined,
    request.audioPreferences ? `Audio: ${request.audioPreferences}` : undefined,
  ]);
}

export function composeAnimationPrompt(request: AnimateImageRequest): ComposedPrompt {
  const base = requirePrompt(request.animationPrompt, 'animation_prompt');
  const duration = validateDuration(request.durationSeconds);

  return compose([
    base,
    request.subjectMovement ? `Subject movement: ${request.subjectMovement}` : undefined,
    request.environmentMovement ? `Environment movement: ${request.environmentMovement}` : undefined,
    request.cameraMovement ? `Camera: ${request.cameraMovement}` : undefined,
    request.visualStyle ? `Visual style: ${request.visualStyle}` : undefined,
    duration !== undefined ? `Duration: ${duration} seconds` : undefined,
  ]);
}
