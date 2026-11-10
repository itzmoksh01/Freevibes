/**
 * Feasibility evidence.
 *
 * This file is the machine-readable twin of docs/META-FEASIBILITY.md. Each row
 * records one capability of one Meta product, the official source that was
 * checked, and the date it was checked. Nothing here is inferred from another
 * product's feature set.
 *
 * Rule enforced by the code that reads this table: a modality is only ever
 * reported as usable when its status is VERIFIED_WORKING or
 * OFFICIALLY_AUTHORIZED_AUTOMATION. Everything else is reported as-is,
 * including BLOCKED.
 */

import type { CapabilityEvidence, CapabilityStatus, Modality, ProviderCapabilities } from './types.js';

export const FEASIBILITY_CHECKED_ON = '2026-11-10';

export const META_EVIDENCE: readonly CapabilityEvidence[] = [
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Text-to-image generation in the Vibes / Meta AI experience',
    modality: 'image',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
    summary:
      'Meta documents image and video generation ("vibes") as a feature of the Meta AI app and ' +
      'vibes.ai. The documentation describes the consumer interface only: it contains no endpoint, ' +
      'no authentication scheme and no programmatic access of any kind.',
    freePlanEligible: true,
    automationPermitted: false,
    blockingReason:
      'A user-facing feature is not an API. No official request schema, auth flow or endpoint is ' +
      'published for Vibes image generation, so there is nothing legitimate to call.',
  },
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Text-to-video and image-to-video generation',
    modality: 'video',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
    summary:
      'Animate (image-to-video), remix and video editing are documented as consumer flows in the ' +
      'Meta AI and Vibes apps. Maximum clip length is documented as 10 seconds. No developer ' +
      'surface is documented for any of these flows.',
    freePlanEligible: true,
    automationPermitted: false,
    blockingReason:
      'Video generation exists only inside the consumer apps and vibes.ai. There is no documented ' +
      'API, no OAuth client, and no authorized automation interface.',
  },
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Image-to-video animation ("Animate")',
    modality: 'image-to-video',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
    summary:
      'Animating an existing image into a vibe is documented as a tap-and-prompt flow inside the ' +
      'Meta AI and Vibes apps. No request format, endpoint or upload mechanism is published for ' +
      'third-party callers.',
    freePlanEligible: true,
    automationPermitted: false,
    blockingReason:
      'Image-to-video exists only as a consumer UI flow. There is no documented way to submit a ' +
      'source image and an animation prompt programmatically.',
  },
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Programmatic retrieval and download of generated media',
    modality: 'retrieval',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
    summary:
      'Downloading a generated vibe is a user action in the app. No documented download endpoint ' +
      'or asset URL scheme exists for third-party clients.',
    automationPermitted: false,
    blockingReason: 'No documented retrieval or download mechanism.',
  },
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Third-party account authorization for unattended use',
    modality: 'auth',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://dev.meta.ai/docs/models',
    summary:
      'Meta Model API authenticates with a Bearer API key issued per team. No OAuth application ' +
      'registration, scopes or token exchange exists that would let a third-party tool act on a ' +
      'personal Vibes account.',
    automationPermitted: false,
    blockingReason:
      'There is no sanctioned way for a local tool to obtain delegated access to a Vibes account. ' +
      'The only mechanism observed in the wild is reuse of a browser session cookie, which this ' +
      'project will not do.',
  },
  {
    product: 'Meta AI Vibes (consumer)',
    capability: 'Free-plan generation quota',
    modality: 'quota',
    status: 'UNVERIFIED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://www.meta.com/help/artificial-intelligence/1337455336906126/',
    summary:
      'Meta describes Vibes generation without publishing a quota table. Per-account limits are ' +
      'surfaced inside the product UI. Because no API exists, a quota cannot be read ' +
      'programmatically and is reported as UNVERIFIED rather than guessed.',
    freePlanEligible: true,
    automationPermitted: false,
    blockingReason: 'Quota is only visible in the consumer UI.',
  },
  {
    product: 'Meta Model API',
    capability: 'Video generation (text-to-video or image-to-video)',
    modality: 'video',
    status: 'NOT_SUPPORTED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://dev.meta.ai/docs/models',
    summary:
      'The published model catalogue contains no video-generation model. Muse Wonder, Muse Spark ' +
      'and Muse Ember return text; Muse Image returns images; Muse Voice Transcribe returns text; ' +
      'SAM 3.1 returns boxes and masks. Video appears only as an *input* modality for understanding ' +
      'and segmentation.',
    endpoint: 'https://api.meta.ai/v1',
    authentication: 'Bearer API key, per team',
    billing: 'Pay-as-you-go; no video-generation line item exists',
    freePlanEligible: false,
    automationPermitted: false,
    blockingReason:
      'Meta Model API cannot generate video at all. Video understanding and video segmentation ' +
      'must not be represented as video generation.',
  },
  {
    product: 'Meta Model API',
    capability: 'Image-to-video animation',
    modality: 'image-to-video',
    status: 'NOT_SUPPORTED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://dev.meta.ai/docs/models',
    summary:
      'No model in the published catalogue animates a still image into video. Muse Image edits ' +
      'and composes images; it does not produce motion. SAM 3.1 tracks objects across frames of ' +
      'an existing clip, which is analysis, not generation.',
    authentication: 'Bearer API key, per team',
    billing: 'No image-to-video line item exists',
    freePlanEligible: false,
    automationPermitted: false,
    blockingReason: 'Meta Model API has no image-to-video generation capability.',
  },
  {
    product: 'Meta Model API',
    capability: 'Image generation via Muse Image (muse-image-1.0)',
    modality: 'image',
    status: 'OFFICIALLY_DOCUMENTED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://dev.meta.ai/docs/pricing-rate-limits',
    summary:
      'Muse Image is a documented, supported image model reachable through the Responses API and ' +
      'through POST /v1/images/generations and POST /v1/images/edits, billed at $0.01 per ' +
      'generated image.',
    endpoint: 'POST https://api.meta.ai/v1/images/generations',
    authentication: 'Bearer API key, per team',
    billing: '$0.01 per generated image, pay-as-you-go',
    freePlanEligible: false,
    automationPermitted: true,
    blockingReason:
      'This is a paid API product. It is explicitly out of scope for free-meta-vibes mode: ' +
      'constraint 2.1 forbids presenting Muse Image as the Vibes free image generator, and no ' +
      'paid provider may be activated silently.',
  },
  {
    product: 'Meta Model API',
    capability: 'Free tier or free allowance for generation',
    modality: 'quota',
    status: 'NOT_SUPPORTED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://dev.meta.ai/docs/pricing-rate-limits',
    summary:
      'Meta documents pay-as-you-go billing with no minimums, plus an optional Muse Code ' +
      'subscription. Contributor mode is a discount, not a free allowance. No free tier is ' +
      'published for image generation; promotional credits are discretionary and not a standing offer.',
    billing: 'Pay-as-you-go only',
    freePlanEligible: false,
    automationPermitted: false,
    blockingReason: 'There is no free generation allowance on Meta Model API.',
  },
  {
    product: 'Third-party reverse-engineered clients',
    capability: 'Unofficial cookie-based automation of vibes.ai',
    modality: 'video',
    status: 'BLOCKED',
    verifiedOn: FEASIBILITY_CHECKED_ON,
    sourceUrl: 'https://github.com/mir-ashiq/VibesAI-api',
    summary:
      'Several community projects automate vibes.ai by reverse-engineering the web application and ' +
      'replaying a copied meta_session browser cookie, or by driving the page with a browser ' +
      'extension. Their own documentation states the endpoints are private, undocumented and ' +
      'subject to change.',
    automationPermitted: false,
    blockingReason:
      'This is precisely the class of integration the product brief forbids in section 2.4: ' +
      'cookie extraction, undocumented endpoints and consumer-interface automation. Freevibes ' +
      'will not implement, wrap, or depend on it, and will not copy its endpoint knowledge.',
  },
];

/** Statuses that mean "this could actually serve a request today". */
const USABLE: readonly CapabilityStatus[] = ['VERIFIED_WORKING', 'OFFICIALLY_AUTHORIZED_AUTOMATION'];

function statusFor(modality: Modality): CapabilityStatus {
  const rows = META_EVIDENCE.filter((r) => r.modality === modality);
  if (rows.length === 0) return 'UNVERIFIED';
  if (rows.some((r) => USABLE.includes(r.status))) return 'VERIFIED_WORKING';
  // Report the most specific blocking status rather than collapsing to a
  // generic one: NOT_SUPPORTED and BLOCKED mean different things to a user.
  if (rows.some((r) => r.status === 'BLOCKED')) return 'BLOCKED';
  if (rows.some((r) => r.status === 'NOT_SUPPORTED')) return 'NOT_SUPPORTED';
  if (rows.some((r) => r.status === 'OFFICIALLY_DOCUMENTED')) return 'OFFICIALLY_DOCUMENTED';
  return 'UNVERIFIED';
}

export function buildProviderCapabilities(provider = 'meta-vibes-free'): ProviderCapabilities {
  const modalities: Record<Modality, CapabilityStatus> = {
    image: statusFor('image'),
    video: statusFor('video'),
    'image-to-video': statusFor('image-to-video'),
  };

  const operational = Object.values(modalities).every((s) => USABLE.includes(s));

  const blockedReason = operational
    ? undefined
    : 'No legitimate unattended route to Meta Vibes generation exists. The free Vibes ' +
      'experience is a consumer product with no published API, and the only mechanisms that ' +
      'reach it are reverse-engineered cookie clients and browser automation, which this ' +
      'project refuses to implement.';

  return {
    provider,
    operational,
    modalities,
    authentication: 'BLOCKED',
    ...(blockedReason ? { blockedReason } : {}),
    evidence: [...META_EVIDENCE],
    checkedOn: FEASIBILITY_CHECKED_ON,
  };
}
