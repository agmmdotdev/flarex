import { Cause, Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation, LogicalCommerceEventValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { captureAtomicCommerceConfiguration, prepareAtomicCommerceConfiguration } from "../../../src/frameworks/atomicCommerce/configuration";
import { prepareCurrentApplicationBinding } from "../../../src/application/activation/currentBinding";
import { readRelationalSessionCoLocatedInstallation } from "../../../src/database/relationalTransaction/session";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { inspectLogicalReferenceFailure } from "../../../src/frameworks/commerceTransaction/commerceAdapter";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { logicalCommerceInventory } from "./logicalCommerceInventory";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { referenceCheckpointSchema as schema, referenceCheckpointOrigin as evidence } from "../../storage/relationalSchema/referenceCheckpointSchema";

const sourceKey = "medusa.neutral-reference-checkpoint";
const decodeMode = Schema.decodeUnknownEffect(Schema.Literals(["selected", "laterDelete", "laterMissing", "caughtMissing", "default"]));

function expectFailure<Value>(exit: Exit.Exit<Value, CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  if (Exit.isSuccess(exit)) throw new Error("Expected a failed checkpoint operation");
  expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
  const failure = exit.cause.reasons[0];
  if (failure === undefined || !Cause.isFailReason(failure)) throw new Error("Expected a typed checkpoint failure, without defects or interruption");
  expect(failure.error.reason).toBe(reason);
  return failure.error;
}

/** Inspect the genuine prepared policy through its existing host and current
 * application lifetime. Only the resulting digest leaves the retained owner. */
const preparedIdentity = Effect.fn("ReferenceCheckpoint.preparedIdentity")(function* (input: AtomicCommerceHostInput<unknown>) {
  return yield* Effect.acquireUseRelease(retainPreparedHost(input.hostRuntime, Effect.gen(function* () {
    const captured = yield* captureAtomicCommerceConfiguration(input);
    return yield* prepareCurrentApplicationBinding(captured.application, captured.database,
      (binding, context) => prepareAtomicCommerceConfiguration(captured, binding, context.authority), {
        selection: { deploymentId: captured.deploymentId, scopeId: captured.scopeId },
        installation: yield* Effect.fromResult(readRelationalSessionCoLocatedInstallation(captured.session, captured.database)),
      });
  })), retained => retained.use(preparation => preparation.withFiniteEntry(({ payload }) => Effect.succeed(payload.identityDigest))),
  retained => retained.close);
});

/** Genuine two-table admission, atomic command execution and cold reads. The
 * fixture arranges data and inspects outcomes; it does not implement references. */
export async function referenceCheckpointScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: ["parent", "child"].map(localName => ({ kind: "definition", localName,
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/" + localName } })) }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-reference-checkpoint", sources: [source] });
    const auditRole = async () => {
      if (driver === "postgres") expect((await fixture.persistence.query(
        "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
        .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    };
    await auditRole();
    const read = defineCommerceCommand("referenceCheckpointRead", "read", ctx => Effect.gen(function* () {
      return { parents: [...yield* (yield* ctx.table("parent")).prepareRead({ order: { column: "id", direction: "asc" }, take: 4 }).find(ctx.manager)],
        children: [...yield* (yield* ctx.table("child")).prepareRead({ order: { column: "id", direction: "asc" }, take: 4 }).find(ctx.manager)] };
    }));
    let reachedCheckpoint = 0;
    let checkedMissing = 0;
    let refusedRescue = 0;
    let caughtReferenceFailure: CommerceTransactionError | undefined;
    const change = defineCommerceCommand("referenceCheckpointChange", "write", (ctx, input) => Effect.gen(function* () {
      const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const parents = yield* ctx.table("parent"), children = yield* ctx.table("child");
      yield* children.write(ctx.manager, "insert", [{ id: mode + "-child", parent_id: mode + "-parent" }]);
      if (mode === "default") {
        expect(ctx.checkpointRelationalReferences).toBeUndefined();
        yield* parents.write(ctx.manager, "insert", [{ id: mode + "-parent" }]);
        return null;
      }
      const checkpoint = ctx.checkpointRelationalReferences;
      if (checkpoint === undefined) return yield* Effect.die(new Error("Missing admitted checkpoint capability"));
      if (mode === "caughtMissing") {
        const missing = expectFailure(yield* Effect.exit(checkpoint("child")), "invalidInput");
        expect(inspectLogicalReferenceFailure(missing)).toMatchObject({ origin: "checkpoint", sourceColumn: "parent_id",
          child: { tableName: "child" }, target: { tableName: "parent", column: "id", key: mode + "-parent" } });
        caughtReferenceFailure = missing;
        checkedMissing++;
        expectFailure(yield* Effect.exit(parents.write(ctx.manager, "insert", [{ id: mode + "-parent" }])), "rollbackOnly");
        refusedRescue++;
        return null;
      }
      yield* parents.write(ctx.manager, "insert", [{ id: mode + "-parent" }]);
      yield* checkpoint("child");
      reachedCheckpoint++;
      if (mode === "laterDelete") yield* parents.delete(ctx.manager, [mode + "-parent"]);
      if (mode === "laterMissing") yield* children.write(ctx.manager, "update", [{ id: mode + "-child", parent_id: "missing-after-checkpoint" }]);
      return null;
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "reference-checkpoint-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const input = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-reference-checkpoint" } };
    const coldRead = Effect.fn("ReferenceCheckpoint.coldRead")(function* () {
      return yield* Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }),
        host => host.read(read, null), host => host.close);
    });
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...input, logicalStorage, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("referenceCheckpoint");
    const root = defineAtomicCommerceCommand("referenceCheckpointRoot", (ctx, mode) => ctx.call(participant, change, mode));
    const validatedModes: string[] = [];
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
      expect(command).toBe(change); expect(call.commandName).toBe("referenceCheckpointChange"); expect(call.events).toEqual([]);
      expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
      expect(activity.mutations.every(mutation => mutation.table === "parent" || mutation.table === "child")).toBe(true);
      validatedModes.push(call.commandName);
    });
    const member = { participant, logicalStorage, commands: [change], validateLogicalCall };
    const hostInput = { ...input, commands: [root], participants: [member] };
    const selectedInput = { ...hostInput, participants: [{ ...member, allowReferenceCheckpoints: true as const }] };
    const inventory = () => logicalCommerceInventory(fixture.persistence.drizzle);
    await Effect.runPromise(Effect.gen(function* () {
      const omitted = yield* preparedIdentity(hostInput);
      const ownUndefined = { ...member };
      Object.defineProperty(ownUndefined, "allowReferenceCheckpoints", { value: undefined, enumerable: true });
      expect(Object.hasOwn(ownUndefined, "allowReferenceCheckpoints")).toBe(true);
      expect(yield* preparedIdentity({ ...hostInput, participants: [ownUndefined] })).toEqual(omitted);
      expect(yield* preparedIdentity(selectedInput)).not.toEqual(omitted);
      const { validateLogicalCall: _perCall, ...withoutPerCall } = member;
      let aggregateCalls = 0;
      const validateLogical: LogicalCommerceEventValidation = () => Effect.sync(() => { aggregateCalls++; });
      const beforeAdmission = yield* inventory();
      for (const unsupported of [{ ...withoutPerCall, allowReferenceCheckpoints: true as const },
        { ...withoutPerCall, allowReferenceCheckpoints: true as const, validateLogical }]) {
        expectFailure(yield* Effect.exit(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, participants: [unsupported] }),
          () => Effect.die(new Error("Checkpoint admitted without per-call validation")), host => host.close)), "unsupportedProfile");
      }
      expect(aggregateCalls).toBe(0); expect(yield* inventory()).toEqual(beforeAdmission);
      expect(yield* coldRead()).toEqual({ parents: [], children: [] });
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost(selectedInput), host => Effect.gen(function* () {
        yield* host.run(host.newRequestKey(), root, "selected");
        expect(reachedCheckpoint).toBe(1);
        expect(yield* coldRead()).toEqual({ parents: [{ id: "selected-parent" }],
          children: [{ id: "selected-child", parent_id: "selected-parent" }] });
        const before = yield* inventory();
        const late = expectFailure(yield* Effect.exit(host.run(host.newRequestKey(), root, "laterDelete")), "invalidInput");
        expect(reachedCheckpoint).toBe(2);
        // Removed-parent noAction refusal precedes live-target evidence issuance.
        expect(inspectLogicalReferenceFailure(late)).toBeUndefined();
        expect(yield* inventory()).toEqual(before);
        const changedTarget = expectFailure(yield* Effect.exit(host.run(host.newRequestKey(), root, "laterMissing")), "invalidInput");
        expect(reachedCheckpoint).toBe(3);
        expect(inspectLogicalReferenceFailure(changedTarget)).toMatchObject({ origin: "close", sourceColumn: "parent_id",
          target: { key: "missing-after-checkpoint" } });
        expect(yield* inventory()).toEqual(before);
        const caught = yield* Effect.exit(host.run(host.newRequestKey(), root, "caughtMissing"));
        expectFailure(caught, "rollbackOnly");
        if (Exit.isFailure(caught)) expect(caught.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error === caughtReferenceFailure)).toBe(true);
        expect(checkedMissing).toBe(1); expect(refusedRescue).toBe(1);
        expect(yield* inventory()).toEqual(before);
      }), host => host.close);
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost(hostInput), host => host.run(host.newRequestKey(), root, "default"), host => host.close);
      expect(yield* coldRead()).toEqual({ parents: [{ id: "default-parent" }, { id: "selected-parent" }],
        children: [{ id: "default-child", parent_id: "default-parent" }, { id: "selected-child", parent_id: "selected-parent" }] });
      expect(validatedModes).toHaveLength(4);
    }));
    await auditRole();
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
}
