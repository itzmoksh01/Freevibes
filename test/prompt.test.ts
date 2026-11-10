import { describe, expect, it } from 'vitest';
import {
  composeAnimationPrompt,
  composeImagePrompt,
  composeVideoPrompt,
  MAX_PROMPT_CHARS,
  validateAspectRatio,
  validateDuration,
} from '../src/prompt/engine.js';
import { InvalidInputError } from '../src/errors.js';

describe('prompt engine', () => {
  it('emits clauses in a stable order', () => {
    const out = composeImagePrompt({
      prompt: 'a royal Indian warrior',
      subject: 'warrior on horseback',
      style: 'cinematic',
      composition: 'medium shot',
      lighting: 'golden hour',
      aspectRatio: '16:9',
    });
    expect(out.prompt).toBe(
      'a royal Indian warrior. Subject: warrior on horseback. Style: cinematic. ' +
        'Composition: medium shot. Lighting: golden hour. Aspect ratio: 16:9',
    );
    expect(out.truncated).toBe(false);
  });

  it('is deterministic', () => {
    const req = { prompt: 'a city at night', style: 'neon' } as const;
    expect(composeImagePrompt(req).prompt).toBe(composeImagePrompt(req).prompt);
  });

  it('drops duplicate clauses case-insensitively', () => {
    const out = composeImagePrompt({ prompt: 'Cinematic', style: 'cinematic' });
    expect(out.segments.filter((s) => s.toLowerCase() === 'cinematic')).toHaveLength(1);
  });

  it('collapses whitespace', () => {
    const out = composeImagePrompt({ prompt: '  a   wide\n\tshot  ' });
    expect(out.prompt).toBe('a wide shot');
  });

  it('rejects an empty prompt', () => {
    expect(() => composeImagePrompt({ prompt: '   ' })).toThrow(InvalidInputError);
  });

  it('rejects a malformed aspect ratio', () => {
    expect(() => validateAspectRatio('16x9')).toThrow(InvalidInputError);
    expect(validateAspectRatio('9:16')).toBe('9:16');
    expect(validateAspectRatio(undefined)).toBeUndefined();
  });

  it('bounds duration', () => {
    expect(() => validateDuration(0)).toThrow(InvalidInputError);
    expect(() => validateDuration(61)).toThrow(InvalidInputError);
    expect(() => validateDuration(2.5)).toThrow(InvalidInputError);
    expect(validateDuration(10)).toBe(10);
  });

  it('orders video clauses scene, subject, action, camera', () => {
    const out = composeVideoPrompt({
      prompt: 'battlefield charge',
      scene: 'historic battlefield',
      subject: 'warrior',
      action: 'riding at speed',
      cameraMovement: 'slow tracking shot',
      durationSeconds: 10,
      aspectRatio: '16:9',
    });
    const idx = (needle: string): number => out.prompt.indexOf(needle);
    expect(idx('Scene:')).toBeLessThan(idx('Subject:'));
    expect(idx('Subject:')).toBeLessThan(idx('Action:'));
    expect(idx('Action:')).toBeLessThan(idx('Camera:'));
    expect(out.prompt).toContain('Duration: 10 seconds');
  });

  it('builds an animation prompt from the source description', () => {
    const out = composeAnimationPrompt({
      sourceImagePath: '/tmp/x.png',
      animationPrompt: 'bring the portrait to life',
      cameraMovement: 'slow push-in',
      durationSeconds: 5,
    });
    expect(out.prompt).toContain('bring the portrait to life');
    expect(out.prompt).toContain('Camera: slow push-in');
  });

  it('truncates an overlong prompt and flags it', () => {
    const out = composeImagePrompt({ prompt: 'x'.repeat(MAX_PROMPT_CHARS + 500) });
    expect(out.truncated).toBe(true);
    expect(out.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
  });
});
