import { Effect, Result } from "effect";
import { expect } from "vitest";
import { privatePayloadReverseSeed } from "./privatePayloadReverseSeed";
import { preparePrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import { runPrivatePayloadReverseServing } from "./privatePayloadReverseServing";
import { publishedScopeCounts } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

/** Two genuine scopes contain equal native Product keys and distinct verified
 * principals. Neither a source ID, permission point nor issued grant crosses. */
export async function privatePayloadReverseServingScopes(first: PrivatePayloadSaveFixture, second: PrivatePayloadSaveFixture) {
  const a = await privatePayloadReverseSeed(first, "rr4-scope-a", 1, "prod_private_rr4_shared");
  const b = await privatePayloadReverseSeed(second, "rr4-scope-b", 1, "prod_private_rr4_shared");
  expect(a.productId).toBe(b.productId);
  expect(a.principal.scopeId).not.toBe(b.principal.scopeId);
  expect(a.principal.principalDigest).not.toBe(b.principal.principalDigest);
  const pa = await Effect.runPromise(preparePrivateReverseReadProfile(first, a.principal, a.productId));
  const pb = await Effect.runPromise(preparePrivateReverseReadProfile(second, b.principal, b.productId));
  const body = 'const identity = await ctx.auth.getUserIdentity(); const page = await ctx.privateMixed.call("payload", "private-reference-page", { limit: 1 }); return { page, subject: identity?.subject ?? null };';
  for (const [fixture, seed, profile, subject] of [[first, a, pa, null], [second, b, pb, "editor-b"]] as const) {
    const served = await Effect.runPromise(runPrivatePayloadReverseServing(fixture, profile, seed.policyId, body));
    expect(Result.getOrThrow(served.result)).toMatchObject({ kind: "published", successfulResult: { valueJson:
      { page: { docs: [{ id: seed.ids[0], title: `${fixture === first ? "rr4-scope-a" : "rr4-scope-b"} 0` }], hasMore: false }, subject } } });
  }
  const count = (fixture: PrivatePayloadSaveFixture) => publishedScopeCounts(fixture.fixture.application.persistence.drizzle, fixture.fixture.application.authority.scopeId);
  const baseline = [await count(first), await count(second)];
  // Each refused authority is isolated: a valid target with a foreign policy,
  // then the valid policy with a foreign target grant/borrow.
  for (const [policyId, profile] of [[a.policyId, pb], [b.policyId, { ...pb, target: pa.target, borrow: pa.borrow }]] as const) {
    let responses = 0;
    const refused = await Effect.runPromise(runPrivatePayloadReverseServing(second, profile, policyId, body,
      { onResponse: () => { responses++; } }));
    expect(refused.result).toMatchObject({ _tag: "Failure" }); expect(responses).toBe(0);
    expect([await count(first), await count(second)]).toEqual(baseline);
  }
}
