/**
 * Shared domain types.
 *
 * The vocabulary here is intentionally the same one the product brief uses, so
 * that a capability reported by the server can be traced straight back to an
 * evidence row in docs/META-FEASIBILITY.md.
 */

export type Modality = 'image' | 'video' | 'image-to-video';

/**
 * Evidence classification. A capability is only ever reported as usable when
 * it reaches VERIFIED_WORKING or OFFICIALLY_AUTHORIZED_AUTOMATION.
 */
export type CapabilityStatus =
  | 'OFFICIALLY_DOCUMENTED'
  | 'OFFICIALLY_AUTHORIZED_AUTOMATION'
  | 'VERIFIED_WORKING'
  /**
   * Reached through an unofficial route: works, but the vendor does not
   * sanction it, it can break without notice, and using it may violate the
   * vendor's terms. Never the default; always opt-in.
   */
  | 'UNOFFICIAL'
  | 'UNVERIFIED'
  | 'NOT_SUPPORTED'
  | 'BLOCKED';

export const USABLE_STATUSES: readonly CapabilityStatus[] = [
  'VERIFIED_WORKING',
  'OFFICIALLY_AUTHORIZED_AUTOMATION',
  'UNOFFICIAL',
];

export interface CapabilityEvidence {
  /** Which Meta product the row describes. Never merged across products. */
  product: string;
  capability: string;
  modality: Modality | 'auth' | 'retrieval' | 'quota';
  status: CapabilityStatus;
  /** ISO date the row was last checked against the live source. */
  verifiedOn: string;
  sourceUrl: string;
  summary: string;
  /** Present only when the source documents them. */
  endpoint?: string;
  authentication?: string;
  billing?: string;
  freePlanEligible?: boolean;
  automationPermitted?: boolean;
  blockingReason?: string;
}

export interface ProviderCapabilities {
  provider: string;
  /** True only when every modality in `modalities` is usable. */
  operational: boolean;
  modalities: Record<Modality, CapabilityStatus>;
  authentication: CapabilityStatus;
  /** Human-readable reason the provider cannot serve requests, when it cannot. */
  blockedReason?: string;
  evidence: CapabilityEvidence[];
  checkedOn: string;
}

export interface AccountStatus {
  provider: string;
  authenticated: boolean;
  /** Whether the provider can act on the account without human interaction. */
  unattended: boolean;
  accountLabel?: string;
  detail?: string;
}

export interface UsageLimits {
  provider: string;
  /** Null means "not knowable without a working integration". */
  remaining?: number | null;
  limit?: number | null;
  resetAt?: string | null;
  detail: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  style?: string;
  subject?: string;
  composition?: string;
  lighting?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  outputCount?: number;
}

export interface VideoGenerationRequest {
  prompt: string;
  subject?: string;
  scene?: string;
  action?: string;
  cameraMovement?: string;
  lighting?: string;
  visualStyle?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  audioPreferences?: string;
  referenceImages?: string[];
}

export interface AnimateImageRequest {
  sourceImagePath: string;
  animationPrompt: string;
  subjectMovement?: string;
  environmentMovement?: string;
  cameraMovement?: string;
  visualStyle?: string;
  durationSeconds?: number;
}

export type JobState =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'interrupted';

export interface JobRecord {
  id: string;
  provider: string;
  modality: Modality;
  state: JobState;
  prompt: string;
  requestJson: string;
  providerJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  outputPaths: string[];
  attempts: number;
  /** Identifier of the server process that holds the lease on this job. */
  ownerId: string | null;
  /** Last time the owning process proved it was alive. */
  heartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProviderJobStatus {
  providerJobId: string;
  state: JobState;
  progress?: number;
  message?: string;
}

export interface MediaAsset {
  path: string;
  bytes: number;
  kind: 'image' | 'video';
  mimeType: string;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface GenerationResult {
  jobId: string;
  provider: string;
  providerJobId: string;
  assets: MediaAsset[];
  /** True when the provider produced placeholder media rather than real output. */
  synthetic: boolean;
  notes?: string[];
}
