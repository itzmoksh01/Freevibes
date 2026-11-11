/**
 * Provider registry.
 *
 * Selection is explicit and final. There is no automatic fallback: if the
 * configured provider cannot serve a request, the request fails with that
 * provider's reason. Silently switching provider would break the free-plan
 * guarantee, so the code makes it impossible rather than merely discouraged.
 */

import type { FreevibesConfig } from '../config.js';
import { ConfigError, GuardRejectedError } from '../errors.js';
import { FixtureProvider } from './fixture.js';
import { MetaVibesFreeProvider } from './meta-vibes-free.js';
import { VibesUnofficialProvider } from './vibes-unofficial.js';
import type { ProviderAdapter } from './types.js';

export const KNOWN_PROVIDERS = ['meta-vibes-free', 'vibes-unofficial', 'fixture'] as const;
export type ProviderId = (typeof KNOWN_PROVIDERS)[number];

export function createProvider(config: FreevibesConfig): ProviderAdapter {
  const id = config.provider;

  if (id === 'fixture') {
    if (!config.allowFixtureProvider) {
      throw new GuardRejectedError(
        'The fixture provider is test-only. Set NODE_ENV=test and ' +
          'FREEVIBES_ALLOW_FIXTURE_PROVIDER=1 to use it, and never in a real run: it produces ' +
          'synthetic placeholder media.',
        { requestedProvider: id },
      );
    }
    return new FixtureProvider();
  }

  if (id === 'meta-vibes-free') {
    return new MetaVibesFreeProvider();
  }

  if (id === 'vibes-unofficial') {
    if (!config.allowUnofficial) {
      throw new GuardRejectedError(
        'The vibes-unofficial provider is off by default. It reaches Meta Vibes through a ' +
          'reverse-engineered route that Meta does not sanction and that may violate the Vibes ' +
          'terms, so it must be enabled deliberately: set FREEVIBES_ALLOW_UNOFFICIAL=true and ' +
          'run the VibesAI-api sidecar. See docs/UNOFFICIAL-VIBES.md.',
        { requestedProvider: id },
      );
    }
    return new VibesUnofficialProvider(config);
  }

  throw new ConfigError(
    `Unknown provider "${id}". Known providers: ${KNOWN_PROVIDERS.join(', ')}. ` +
      'Freevibes does not fall back to a different provider.',
    { requestedProvider: id, known: [...KNOWN_PROVIDERS] },
  );
}

/** Defence in depth: refuse any provider that would bill the user. */
export function assertProviderAllowed(provider: ProviderAdapter, config: FreevibesConfig): void {
  if (provider.paid && !config.allowPaidProviders) {
    throw new GuardRejectedError(
      `Provider "${provider.id}" is a paid provider and paid providers are disabled.`,
      { provider: provider.id },
    );
  }
}
