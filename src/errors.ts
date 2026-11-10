/**
 * Structured error types.
 *
 * Every failure that crosses a tool boundary is expressed as one of these so
 * that a calling agent receives a machine-readable reason instead of a stack
 * trace. Nothing here ever invents a success.
 */

export type FreevibesErrorCode =
  | 'BLOCKED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'GUARD_REJECTED'
  | 'DOWNLOAD_FAILED'
  | 'VALIDATION_FAILED'
  | 'JOB_TIMEOUT'
  | 'CANCELLED'
  | 'CONFIG_ERROR';

export interface FreevibesErrorPayload {
  code: FreevibesErrorCode;
  message: string;
  /** Machine-readable detail, safe to show to a user. */
  detail?: Record<string, unknown>;
  /** Documentation that justifies the failure, when one exists. */
  evidenceUrls?: string[];
  /** True when retrying the same request could plausibly succeed later. */
  retryable?: boolean;
}

export class FreevibesError extends Error {
  readonly code: FreevibesErrorCode;
  readonly detail?: Record<string, unknown>;
  readonly evidenceUrls: string[];
  readonly retryable: boolean;

  constructor(code: FreevibesErrorCode, message: string, opts: {
    detail?: Record<string, unknown>;
    evidenceUrls?: string[];
    retryable?: boolean;
    cause?: unknown;
  } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'FreevibesError';
    this.code = code;
    this.detail = opts.detail;
    this.evidenceUrls = opts.evidenceUrls ?? [];
    this.retryable = opts.retryable ?? false;
  }

  toPayload(): FreevibesErrorPayload {
    const payload: FreevibesErrorPayload = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.detail) payload.detail = this.detail;
    if (this.evidenceUrls.length > 0) payload.evidenceUrls = this.evidenceUrls;
    return payload;
  }
}

/**
 * Raised when a capability is not available through a legitimate, documented
 * route. This is the honest answer the project is built around: a BLOCKED
 * provider reports exactly what is missing rather than simulating a result.
 */
export class BlockedError extends FreevibesError {
  constructor(message: string, opts: {
    detail?: Record<string, unknown>;
    evidenceUrls?: string[];
    cause?: unknown;
  } = {}) {
    super('BLOCKED', message, { ...opts, retryable: false });
    this.name = 'BlockedError';
  }
}

export class InvalidInputError extends FreevibesError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('INVALID_INPUT', message, { detail, retryable: false });
    this.name = 'InvalidInputError';
  }
}

export class GuardRejectedError extends FreevibesError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('GUARD_REJECTED', message, { detail, retryable: false });
    this.name = 'GuardRejectedError';
  }
}

export class NotFoundError extends FreevibesError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('NOT_FOUND', message, { detail, retryable: false });
    this.name = 'NotFoundError';
  }
}

export class ProviderError extends FreevibesError {
  constructor(message: string, opts: {
    detail?: Record<string, unknown>;
    retryable?: boolean;
    cause?: unknown;
  } = {}) {
    super('PROVIDER_ERROR', message, opts);
    this.name = 'ProviderError';
  }
}

export class DownloadError extends FreevibesError {
  constructor(message: string, opts: {
    detail?: Record<string, unknown>;
    retryable?: boolean;
    cause?: unknown;
  } = {}) {
    super('DOWNLOAD_FAILED', message, opts);
    this.name = 'DownloadError';
  }
}

export class MediaValidationError extends FreevibesError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, { detail, retryable: false });
    this.name = 'MediaValidationError';
  }
}

export class ConfigError extends FreevibesError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('CONFIG_ERROR', message, { detail, retryable: false });
    this.name = 'ConfigError';
  }
}

/** Normalise any thrown value into a serialisable payload. */
export function toErrorPayload(err: unknown): FreevibesErrorPayload {
  if (err instanceof FreevibesError) return err.toPayload();
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'PROVIDER_ERROR', message, retryable: false };
}
