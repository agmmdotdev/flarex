import { Effect } from "effect";
import { expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { inspectPrivateParticipantReadSelection, preparePrivateParticipantReadAccess,
  preparePrivateParticipantReadSelection } from "../../src/execution/journal/privateReadAccess";

const principal = { scopeId: ScopeIdSchema.make("private_read_scope"), principalDigest: "a".repeat(64) };
const selection = { principal, participant: "private-product", sourceKey: "medusa.product",
  nativeProfileRevision: "b".repeat(64), method: "retrieve", ids: ["product-one"] };

it("owns an immutable neutral read selection and refuses copied authority", async () => {
  const mutable = { ...selection, principal: { ...principal }, ids: [...selection.ids] };
  const access = await Effect.runPromise(preparePrivateParticipantReadSelection(mutable));
  mutable.principal.principalDigest = "c".repeat(64);
  mutable.ids[0] = "unselected-product";
  const captured = inspectPrivateParticipantReadSelection(access);
  expect(captured?.selection).toMatchObject({ principal, ids: ["product-one"] });
  expect(Object.isFrozen(captured?.selection.principal)).toBe(true);
  expect(Object.isFrozen(captured?.selection.ids)).toBe(true);
  expect(inspectPrivateParticipantReadSelection({ profileRevision: access.profileRevision })).toBeUndefined();
});

it("pins the exact source, principal, native policy and ID selection into read replay identity", async () => {
  const first = await Effect.runPromise(preparePrivateParticipantReadAccess(selection));
  expect((await Effect.runPromise(preparePrivateParticipantReadAccess({ ...selection }))).profileRevision).toBe(first.profileRevision);
  for (const changed of [
    { ...selection, ids: ["product-two"] },
    { ...selection, principal: { ...principal, principalDigest: "c".repeat(64) } },
    { ...selection, principal: { ...principal, scopeId: ScopeIdSchema.make("other_read_scope") } },
    { ...selection, sourceKey: "another-source" },
    { ...selection, nativeProfileRevision: "d".repeat(64) },
    { ...selection, ids: "native" as const, nativeAccess: { collection: "articles", ids: ["article-one"] } },
    { ...selection, ids: "native" as const, nativeAccess: { collection: "articles", ids: ["article-two"] } },
  ]) expect((await Effect.runPromise(preparePrivateParticipantReadAccess(changed))).profileRevision).not.toBe(first.profileRevision);
  const native = await Effect.runPromise(preparePrivateParticipantReadAccess({ ...selection, ids: "native", nativeAccess: { collection: "articles", ids: ["one"] } }));
  expect((await Effect.runPromise(preparePrivateParticipantReadAccess({ ...selection, ids: "native",
    nativeAccess: { collection: "articles", ids: ["two"] } }))).profileRevision).not.toBe(native.profileRevision);
});

it("refuses ambiguous native grants and oversized selections before borrowing", async () => {
  for (const invalid of [
    { ...selection, ids: "native" as const },
    { ...selection, nativeAccess: {} },
    { ...selection, ids: Array.from({ length: 257 }, (_, i) => `product-${i}`) },
    { ...selection, principal: { ...principal, principalDigest: "not-a-digest" } },
  ]) expect(await Effect.runPromise(Effect.flip(preparePrivateParticipantReadAccess(invalid))))
    .toMatchObject({ kind: "rejection", cause: { reason: "invalidAuthority" } });
});
