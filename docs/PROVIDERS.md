# Writing a provider

A provider is the only part of Freevibes that knows anything about a specific
vendor. Everything above it — tools, orchestrator, jobs, media pipeline — is
provider-agnostic.

## The contract

`src/providers/types.ts` defines `ProviderAdapter`:

```ts
interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly paid: boolean;

  getCapabilities(): Promise<ProviderCapabilities>;
  getAccountStatus(): Promise<AccountStatus>;
  authorize(): Promise<AccountStatus>;

  generateImage(request: ImageGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission>;
  generateVideo(request: VideoGenerationRequest, ctx: ProviderContext): Promise<ProviderSubmission>;
  animateImage(request: AnimateImageRequest, ctx: ProviderContext): Promise<ProviderSubmission>;

  getJobStatus(providerJobId: string): Promise<ProviderJobStatus>;
  waitForCompletion(providerJobId: string, opts?: {...}): Promise<ProviderJobStatus>;
  retrieveResult(providerJobId: string): Promise<ProviderRetrieval>;
  cancelJob(providerJobId: string): Promise<void>;
  getUsageLimits(): Promise<UsageLimits>;
}
```

Implement only what the vendor actually supports. For anything it does not
support, **throw `BlockedError`** with the missing capability and a source URL.
Do not return an empty success, and do not implement a method as a no-op that
looks like it worked.

## Rules a provider must follow

1. **Report capabilities honestly.** `getCapabilities()` must reflect what you
   verified, not what you hope. Derive statuses from evidence rows, and use
   `VERIFIED_WORKING` only after a real request succeeded.
2. **Never fake a job.** No synthetic asset may be returned with `synthetic:
   false`, and no placeholder may be presented as real generation.
3. **Refuse, don't degrade.** If authorization is missing, throw `BlockedError`.
   Never fall back to a different product to make a feature look complete.
4. **No credentials from a browser.** Session-cookie replay, CAPTCHA bypass and
   fingerprint spoofing are out of scope for this project permanently.
5. **Respect the entitlement.** If the provider bills, set `paid = true`; the
   registry will refuse to load it in free mode.
6. **Return URLs or paths, not bytes.** The media pipeline owns downloading,
   validation and storage. `retrieveResult()` returns `{ url }` or `{ localPath }`.

## Adding one

1. Create `src/providers/my-provider.ts` implementing `ProviderAdapter`.
2. Add evidence rows to `src/evidence.ts` for every capability you claim, each
   with `sourceUrl` and `verifiedOn`.
3. Register it in `src/providers/registry.ts`:

```ts
if (id === 'my-provider') {
  return new MyProvider();
}
```

4. Set `FREEVIBES_PROVIDER=my-provider`.
5. Add tests alongside `test/provider.test.ts`, including a test that a blocked
   path throws `BlockedError` rather than returning a result.

## Example: a minimal honest provider

```ts
export class MyProvider implements ProviderAdapter {
  readonly id = 'my-provider';
  readonly displayName = 'My Provider';
  readonly paid = true; // billing the user; free mode will refuse to load it

  async getCapabilities(): Promise<ProviderCapabilities> {
    return {
      provider: this.id,
      operational: true,
      modalities: {
        image: 'VERIFIED_WORKING',   // verified with a real request on 2026-11-10
        video: 'NOT_SUPPORTED',
        'image-to-video': 'NOT_SUPPORTED',
      },
      authentication: 'VERIFIED_WORKING',
      evidence: [/* one row per claim, with sourceUrl + verifiedOn */],
      checkedOn: '2026-11-10',
    };
  }

  async generateImage(req, ctx) {
    const res = await fetch('https://api.example.com/v1/images', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MY_KEY}` },
      body: JSON.stringify({ prompt: req.prompt }),
    });
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, { retryable: res.status >= 500 });
    const body = await res.json();
    return { providerJobId: body.id, state: 'running' };
  }

  async generateVideo() {
    throw new BlockedError('This provider has no video model.', {
      evidenceUrls: ['https://api.example.com/docs/models'],
    });
  }
  // ...
}
```

## The blocked reference implementation

`src/providers/meta-vibes-free.ts` is the model to copy for an unavailable
capability: it implements all eleven methods, returns real capability data, and
refuses every generation path with a `BlockedError` that names the missing API,
the missing permission, the missing entitlement, and the source that was checked.

## Testing a provider

```bash
npm test -- test/provider.test.ts
```

Assert both directions: that a supported path returns a submission, and that an
unsupported path throws `BlockedError` with a non-empty `evidenceUrls`.
