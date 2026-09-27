import { Effect, Result } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  type ApplicationNativeMutationFixture, type ApplicationNativeMutationPersistence } from "./fixtures/applicationNativeMutationTestFixture";
import { startCatalogControlDeadline, type CatalogControlSessionStarter } from "../src/catalogControlSession";
import { makeLogicalSchemaAdmission } from "../src/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../src/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../src/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../src/indexBuildReconciliation";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../src/intrinsicCreationTimeIndexBuildV1";
import { locateAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../src/appUniqueConstraintSetBuildV1";
import { makeFrameworkSchemaTarget } from "../src/frameworkSchema/target";
import type { FrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import type { DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { fxSystemDataBindingHeads, fxSystemDataBindingActivations, fxSystemDataBindingCandidates } from "../src/frameworkSchema/binding/schema";
import { fxSystemIndexBuildStates, fxControlSchemaVersionUniqueConstraintSets } from "../src/schema";
import { runEffectTransaction } from "../src/effectTransaction";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";

import type { PreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalRelationalAdmissionScenario } from "./logicalRelationalAdmissionScenario";
import { logicalRelationalPublicationScenario } from "./logicalRelationalPublicationScenario";
const query = <Value>(statement: PromiseLike<Value>) => runDrizzleStatementEffect(statement,
  cause => new Error("Binding fixture statement", { cause }));
export const logicalSchemaBindingScenario = Effect.fn("LogicalSchemaBinding.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, session: CatalogControlSessionStarter, prepared: PreparedLogicalSchemaCandidate,
  native: Readonly<{ source: Parameters<typeof logicalRelationalAdmissionScenario>[2]; rows: Parameters<typeof logicalRelationalAdmissionScenario>[3]; reads: Parameters<typeof logicalRelationalAdmissionScenario>[4]; execute: Parameters<typeof logicalRelationalAdmissionScenario>[5]; verify: Parameters<typeof logicalRelationalPublicationScenario>[4]; concurrentExecute: Parameters<typeof logicalRelationalPublicationScenario>[5];
    hostProof?: (target: FrameworkSchemaTarget, schemaVersionId: ReturnType<typeof decodeCatalogSchemaVersionId>) => Effect.Effect<void, unknown>;
    jointNativeProof?: (target: FrameworkSchemaTarget,
      schemaVersionId: ReturnType<typeof decodeCatalogSchemaVersionId>) => Effect.Effect<void, unknown> }>,
) {
  const { deploymentId, authority, authorityPorts, control, target } = fixture;
  const schemaVersionId = decodeCatalogSchemaVersionId("binding-joint-candidate");
  const admission = makeLogicalSchemaAdmission({ controlDb: control.drizzle, session, deploymentId, scopeId: authority.scopeId });
  (yield* admission.admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
    initialDeadline: (yield* startCatalogControlDeadline("initial", 20_000)),
    lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000,
  }));
  const catalog = (yield* runEffectTransaction(work => control.drizzle.transaction(work), "Arrange joint catalog",
    (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const definitions = yield* ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId);
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(tx, { deploymentId, schemaVersionId });
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
      return definitions;
    }), cause => new Error("Joint catalog transaction", { cause })));
  const ports = { controlDb: control.drizzle, authority: authorityPorts };
  const reconciled = (yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, scopeId: authority.scopeId, schemaVersionId }));
  if (reconciled.status !== "reconciled") throw new Error("Incomplete joint index requirements");
  const bindingTarget = (yield* makeFrameworkSchemaTarget({ database: target.drizzle, deploymentId,
    canonicalPhysicalDatabaseIdentity: "logical-binding-target", physicalLocator: fixture.active.basis.authority.physicalLocator }));
  const input = { database: target.drizzle,
    selection: { deploymentId, scopeId: fixture.authority.scopeId }, target: bindingTarget, authority: authorityPorts,
    application: fixture.activation, logicalStorage: { controlDb: control.drizzle, schemaVersionId, unique: fixture.uniqueConstraintEligibility } };
  const host = (yield* makeDataBindingHost(input));
  const reference = (yield* host.readApplicationReference());
  const frame = { format: "flarex.data-binding-set", application: reference,
    logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) },
    payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] } satisfies DataBindingSetFrame;
  expect((yield* Effect.result(host.prepare(frame)))).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
  expect(yield* query(target.drizzle.select().from(fxSystemDataBindingCandidates))).toHaveLength(0);
  for (const indexDefinitionId of reconciled.definitionIds) {
    const definition = (yield* locateAppIndexDefinitionByIdEffect(control.drizzle, authority.scopeId, indexDefinitionId));
    if (definition === null) throw new Error("Missing index definition");
    let enabled = false;
    for (let step = 0; step < 20; step++) {
      const result = definition.access.kind === "by_creation_time"
        ? (yield* buildIntrinsicCreationTimeIndexV1Effect(ports, { deploymentId, scopeId: authority.scopeId, indexDefinitionId, pageSize: 10 }))
        : (yield* buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, scopeId: authority.scopeId, indexDefinitionId, pageSize: 10 }));
      if (result.lifecycle === "enabled") { enabled = true; break; }
    }
    expect(enabled).toBe(true);
  }
  const uniqueSet = yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports, { deploymentId, scopeId: authority.scopeId, schemaVersionId });
  if (uniqueSet.status !== "reconciled") throw new Error("Joint unique set was not declared");
  let uniqueEnabled = false;
  for (let step = 0; step < (uniqueSet.definitionCount + 1) * 4; step++) {
    const result = (yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports, { deploymentId, scopeId: authority.scopeId, schemaVersionId, pageSize: 10 }));
    if (result.lifecycle === "enabled" && result.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  expect(uniqueEnabled).toBe(true);
  for (const logicalSchema of [null, { ...frame.logicalSchema, manifestSha256: "f".repeat(64) },
    { ...frame.logicalSchema, schemaVersionId: "other-schema" }]) {
    expect((yield* Effect.result(host.prepare({ ...frame, logicalSchema })))).toMatchObject({
      _tag: "Failure", failure: { reason: "logicalSchemaMismatch" },
    });
  }
  const candidate = (yield* host.prepare(frame));
  const request = dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "joint-activation", candidate.sha256, null);
  // Pick an actual non-Application requirement so the Application readiness gate
  // stays valid while joint readiness changes after candidate preparation.
  const nativeTable = catalog.requirements.evidence.tableBindings.find(binding => binding.table.namespace === "medusa");
  if (nativeTable === undefined) throw new Error("Missing native table");
  const nativeIndex = catalog.ordered.find(index => index.definition.access.tableId === nativeTable.tableId)?.definition;
  if (nativeIndex === undefined) throw new Error("Missing native index");
  const setLifecycle = (lifecycle: "enabled" | "validating") => target.drizzle.update(fxSystemIndexBuildStates).set({ lifecycle }).where(and(
    eq(fxSystemIndexBuildStates.scopeId, authority.scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, nativeIndex.indexDefinitionId)));
  yield* query(setLifecycle("validating"));
  expect((yield* Effect.result(host.activate(request)))).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
  expect(yield* query(target.drizzle.select().from(fxSystemDataBindingHeads))).toHaveLength(0);
  expect(yield* query(target.drizzle.select().from(fxSystemDataBindingActivations))).toHaveLength(0);
  yield* query(setLifecycle("enabled"));
  const activated = (yield* host.activate(request));
  expect(Result.getOrThrow(activated.current).selected).toBe(true);
  expect(((yield* host.withCurrent(readAdmittedDataBinding))).frame).toEqual(frame);
  if (native.hostProof === undefined) {
    yield* logicalRelationalAdmissionScenario(fixture, schemaVersionId, native.source, native.rows, native.reads, native.execute);
    yield* logicalRelationalPublicationScenario(fixture, schemaVersionId, native.source, native.execute, native.verify, native.concurrentExecute);
  } else yield* native.hostProof(bindingTarget, schemaVersionId);
  const restarted = (yield* makeDataBindingHost(input));
  expect((yield* restarted.recover(request))).toEqual(activated);
  yield* query(setLifecycle("validating"));
  expect((yield* Effect.result(restarted.withCurrent(readAdmittedDataBinding)))).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
  const staleRecovery = (yield* restarted.recover(request));
  expect(staleRecovery.receipt).toEqual(activated.receipt);
  expect(staleRecovery.current).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
  yield* query(setLifecycle("enabled"));
  expect(yield* query(target.drizzle.select().from(fxSystemDataBindingActivations))).toHaveLength(1);
  yield* Effect.acquireUseRelease(
    query(control.drizzle.delete(fxControlSchemaVersionUniqueConstraintSets).where(and(
      eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, deploymentId),
      eq(fxControlSchemaVersionUniqueConstraintSets.schemaVersionId, schemaVersionId),
    )).returning()),
    removed => Effect.gen(function* () {
      expect(removed).toHaveLength(1);
      const cold = yield* makeDataBindingHost(input);
      const recovered = yield* cold.recover(request);
      expect(recovered.receipt).toEqual(activated.receipt);
      expect(recovered.current).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
      expect(yield* Effect.result(cold.activate({ ...request, requestId: "unready-new-request" })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
      // Return the same host to prove a failed cold preparation was not cached.
      return cold;
    }),
    removed => query(control.drizzle.insert(fxControlSchemaVersionUniqueConstraintSets).values(removed)).pipe(Effect.orDie),
  ).pipe(Effect.flatMap(cold => cold.recover(request)), Effect.tap(recovered => Effect.sync(() => expect(recovered).toEqual(activated))));
  if (native.jointNativeProof !== undefined) yield* native.jointNativeProof(bindingTarget, schemaVersionId);
  const { logicalStorage, ...physicalInput } = input;
  const unconfigured = (yield* makeDataBindingHost(physicalInput));
  expect((yield* Effect.result(unconfigured.withCurrent(readAdmittedDataBinding)))).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaMismatch" } });
  yield* Effect.tryPromise({ try: () => fixture.moveHead(), catch: cause => new Error("Advance Application fixture", { cause }) });
  const nextReference = (yield* host.readApplicationReference());
  expect((yield* Effect.result(host.prepare({ ...frame, application: nextReference })))).toMatchObject({ _tag: "Failure", failure: { reason: "staleApplication" } });
});
