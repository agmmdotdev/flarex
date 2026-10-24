import { Cause, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import type { CommerceCommandContext } from "../../../src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../../src/frameworks/atomicCommerce/commands";
import { requireAtomicCommerceScopeExclusion } from "../../../src/frameworks/atomicCommerce/execution";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { referenceCheckpointSchema as schema, referenceCheckpointOrigin as evidence } from "../../storage/relationalSchema/referenceCheckpointSchema";
import { logicalCommerceInventory } from "../commerceTransaction/logicalCommerceInventory";

const sourceKey = "neutral.participant-scope-exclusion";
const decodeMode = Schema.decodeUnknownEffect(Schema.Literals(["live", "copy", "proxy", "expiredBorrow"]));

function expectFailure<Value>(exit: Exit.Exit<Value, CommerceTransactionError>, reasons: readonly CommerceTransactionError["reason"][]) {
  if (Exit.isSuccess(exit)) throw new Error("Scope exclusion unexpectedly succeeded");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reasons.includes(reason.error.reason))).toBe(true);
}

/** Uses real admission, scope locking and bounded manager lifetimes. The fixture
 * only invokes the guard and observes durable outcomes; it issues no authority. */
export async function participantScopeExclusionScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: ["parent", "child"].map(localName => ({ kind: "definition", localName,
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/" + localName } })) }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-participant-scope-exclusion", sources: [source] });
    const auditRole = async () => {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    };
    await auditRole();
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "scope-exclusion-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: sourceKey } };
    let escapedParticipant: CommerceCommandContext | undefined;
    let escapedRoot: AtomicCommerceContext | undefined;
    let checked = 0;
    const leaf = defineCommerceCommand("scopeExclusionLeaf", "read", ctx => requireAtomicCommerceScopeExclusion(ctx).pipe(Effect.as(null)));
    const command = defineCommerceCommand("scopeExclusionParticipant", "write", (ctx, value) => Effect.gen(function* () {
      const mode = yield* decodeMode(value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      escapedParticipant = ctx;
      if (mode === "copy") { yield* requireAtomicCommerceScopeExclusion({ ...ctx }); return null; }
      if (mode === "proxy") { yield* requireAtomicCommerceScopeExclusion(new Proxy(ctx, {})); return null; }
      if (mode === "expiredBorrow") {
        let expired: CommerceCommandContext | undefined;
        yield* ctx.borrow(child => Effect.sync(() => { expired = child; }));
        if (expired === undefined) return yield* Effect.die(new Error("Borrow did not issue a context"));
        yield* requireAtomicCommerceScopeExclusion(expired);
        return null;
      }
      yield* requireAtomicCommerceScopeExclusion(ctx);
      checked++;
      yield* ctx.borrow(child => Effect.gen(function* () {
        yield* requireAtomicCommerceScopeExclusion(child);
        checked++;
        yield* child.borrow(grandchild => requireAtomicCommerceScopeExclusion(grandchild).pipe(Effect.tap(() => Effect.sync(() => { checked++; }))));
      }));
      yield* ctx.nested(leaf, null);
      return null;
    }));
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [command] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("scopeExclusion");
    const root = defineAtomicCommerceCommand("scopeExclusionRoot", (ctx, mode) => Effect.gen(function* () {
      escapedRoot = ctx;
      if (mode === "live") yield* requireAtomicCommerceScopeExclusion(ctx);
      return yield* ctx.call(participant, command, mode);
    }));
    const member = { participant, logicalStorage, commands: [command, leaf] };
    const participantOnly = defineAtomicCommerceCommand("scopeExclusionParticipantOnly", ctx => ctx.call(participant, command, "live"));
    const hostInput = { ...input, commands: [root], participants: [member] };
    const inventory = () => logicalCommerceInventory(fixture.persistence.drizzle);
    await Effect.runPromise(Effect.gen(function* () {
      for (const scheduling of [{}, { operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const }]) {
        yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, ...scheduling, executionIsolation: "scopeExclusive" }), host => Effect.gen(function* () {
          const beforeChecked = checked;
          yield* host.run(host.newRequestKey(), root, "live");
          expect(checked - beforeChecked).toBe(3);
          if (escapedParticipant === undefined || escapedRoot === undefined) return yield* Effect.die(new Error("Missing escaped context controls"));
          const before = yield* inventory();
          expectFailure(yield* Effect.exit(requireAtomicCommerceScopeExclusion(escapedParticipant)), ["invalidAuthority", "closed"]);
          expectFailure(yield* Effect.exit(requireAtomicCommerceScopeExclusion(escapedRoot)), ["invalidAuthority", "closed"]);
          expectFailure(yield* Effect.exit(requireAtomicCommerceScopeExclusion({ ...escapedRoot })), ["invalidAuthority"]);
          for (const mode of ["copy", "proxy", "expiredBorrow"]) {
            expectFailure(yield* Effect.exit(host.run(host.newRequestKey(), root, mode)), ["invalidAuthority"]);
            expect(yield* inventory()).toEqual(before);
          }
        }), host => host.close);
      }
      const before = yield* inventory();
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [root, participantOnly] }), host => Effect.gen(function* () {
        expectFailure(yield* Effect.exit(host.run(host.newRequestKey(), participantOnly, null)), ["unsupportedProfile"]);
        expectFailure(yield* Effect.exit(host.run(host.newRequestKey(), root, "live")), ["unsupportedProfile"]);
      }), host => host.close);
      expect(yield* inventory()).toEqual(before);
      yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [command] }), host =>
        Effect.exit(host.run(host.newRequestKey(), command, "live")).pipe(Effect.tap(exit => Effect.sync(() => expectFailure(exit, ["invalidAuthority"])))), host => host.close);
      expect(yield* inventory()).toEqual(before);
    }));
    await auditRole();
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
}
