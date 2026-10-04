import { randomUUID } from "node:crypto";
import { Effect, Exit, Result, Schema, Tracer } from "effect";
import { expect } from "vitest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { captureFiniteApplicationMetadata, inspectFiniteApplicationMetadata,
  prepareApplicationBindingSelection, prepareRetainedApplicationBindingSelection,
  readCapturedFiniteApplicationMetadata, readFiniteApplicationMetadata,
  type AcceptedApplicationBinding, type FiniteApplicationMetadata } from "../src/applicationActivation";
import { withApplicationBindingEvidenceInTransaction } from "../src/applicationBindingProjection";
import { retainPreparedHost } from "../src/preparedHostRuntime";
import { createSessionJournalStorePersistence } from "../src/sessionJournalStore";
import { createPointMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { closeFiniteExecutionAuthorityObservation, lockScopeClockForUpdateInTransactionEffect,
  openFiniteExecutionAuthorityObservation, requireFiniteExecutionAuthorityObservation,
  ScopeExecutionAuthoritySchema, selectScopeClockRows } from "../src/scopeClock";
import { eq } from "drizzle-orm";
import { fxSystemScopeClocks } from "../src/schema";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { cmsHostFixture } from "./cmsHostFixture";
import { runEffect } from "./effectTestRuntime";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";
import { activatePointMutationSession, pointMutationSessionActivationFixture,
  TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";

/** Real full entry, immutable content and separate transaction-owned authority. */
export async function finiteApplicationMetadataScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing actual schema");
  const controlPersistence = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const base = await cmsHostFixture(persistence, { controlPersistence,
    physicalLocator: { kind: "database_per_scope", databaseKey: "finite_metadata_target", schemaName } });
  const deploymentId = Schema.decodeUnknownSync(TransactionGrantDeploymentIdV1Schema)(base.fixture.deploymentId);
  const scopeId = decodeReplacementScopeIdV1(base.fixture.authority.scopeId);
  const schemaVersionId = base.fixture.relation.binding.schemaVersionId;
  const activation = await activatePointMutationSession(createPointMutationSessionActivationPersistenceV1(
    base.fixture.pointCommitAuthority, { leaseDurationMilliseconds: 60_000, randomUuid: randomUUID }),
  pointMutationSessionActivationFixture(deploymentId, scopeId, { executionProfile: "finiteRoot", evidence: { schemaVersionId } }));
  if (activation.status !== "created") throw new Error("Expected genuine attempt");
  const anchor = activation.anchor;
  const store = createSessionJournalStorePersistence(base.fixture.pointCommitAuthority,
    { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, randomUuid: randomUUID });
  const root = await runEffect(store.openAttemptEffect({ selector: { deploymentId, scopeId,
    sessionId: anchor.sessionId, attemptFence: anchor.attemptFence }, executionClaim: activation.executionClaim,
  snapshotToken: anchor.snapshotToken, schemaVersionId, executionProfile: "finiteRoot" }));
  const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
    prepareRetainedApplicationBindingSelection(base.fixture.relationActivation).pipe(Effect.map(selection => ({ selection })))));
  const selection = await runEffect(retained.use(host => Effect.succeed(host.selection)));
  const otherSelection = await runEffect(prepareApplicationBindingSelection(base.fixture.relationActivation));
  let captured: FiniteApplicationMetadata | undefined;
  let accepted: AcceptedApplicationBinding | undefined;
  try {
    await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      yield* withApplicationBindingEvidenceInTransaction(selection, tx, clock, (evidence, binding) => Effect.gen(function* () {
        expect(evidence.projection).toEqual(base.reference);
        accepted = binding;
        captured = yield* Effect.fromResult(captureFiniteApplicationMetadata(binding, selection, tx, clock, root, anchor.snapshotToken.commitSeq));
      }));
      if (accepted === undefined) throw new Error("Missing entry issuer");
      expect(Result.isFailure(captureFiniteApplicationMetadata(accepted, selection, tx, clock, root, anchor.snapshotToken.commitSeq))).toBe(true);
    })));
    if (captured === undefined) throw new Error("Missing immutable metadata");
    const metadata = captured;
    const selector = inspectFiniteApplicationMetadata(metadata, root);
    if (selector === null) throw new Error("Missing reservation selector");
    const detached = Result.getOrThrow(readCapturedFiniteApplicationMetadata(metadata, root));
    detached.basis.headSha256.fill(0);
    detached.basis.activationSha256.fill(0);
    expect(inspectFiniteApplicationMetadata(metadata, root)).toEqual(selector);
    const spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    for (const ending of ["success", "failure", "interruption"] as const) {
      await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
        yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
        const row = (yield* Effect.promise(() => selectScopeClockRows(tx).where(eq(fxSystemScopeClocks.scopeId, scopeId))))[0];
        const authority = yield* Schema.decodeUnknownEffect(Schema.toType(ScopeExecutionAuthoritySchema))(row);
        const observation = openFiniteExecutionAuthorityObservation(tx, authority, anchor);
        const outcome = yield* Effect.exit(Effect.gen(function* () {
          for (const [input, selected, attempt, observed] of [
            [new Proxy(metadata, {}), selection, root, observation],
            [metadata, otherSelection, root, observation],
            [metadata, selection, new Proxy(root, {}), observation],
            [metadata, selection, root, { ...observation }],
          ] as const) expect(Result.isFailure(readFiniteApplicationMetadata(input, selected, attempt, tx, observed))).toBe(true);
          const first = yield* Effect.fromResult(readFiniteApplicationMetadata(metadata, selection, root, tx, observation));
          expect(first.basis.headSha256).toBe(selector.headSha256);
          expect(first.snapshotCommitSeq).toBe(anchor.snapshotToken.commitSeq);
          if (ending === "failure") return yield* Effect.fail("metadata read failed");
          if (ending === "interruption") return yield* Effect.interrupt;
        }).pipe(Effect.ensuring(Effect.sync(() => closeFiniteExecutionAuthorityObservation(tx)))));
        expect(Exit.isSuccess(outcome)).toBe(ending === "success");
        expect(Result.isFailure(requireFiniteExecutionAuthorityObservation(tx, observation))).toBe(true);
        expect(Result.isFailure(readFiniteApplicationMetadata(metadata, selection, root, tx, observation))).toBe(true);
      }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    }
    expect(spans).not.toContain("ApplicationActivation.readLegacyTransaction");
    expect(spans).not.toContain("ApplicationRelationReadinessFold.validatePreparedInTransaction");
    await runEffect(retained.close);
    expect(Result.isFailure(readCapturedFiniteApplicationMetadata(metadata, root))).toBe(true);
  } finally { await runEffect(retained.close); }
}
