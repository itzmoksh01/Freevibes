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
import type { ProviderAdapter } from './types.js';

export const KNOWN_PROVIDERS = ['meta-vibes-free', 'fixture'] as const;
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
