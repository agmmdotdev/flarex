import { Effect, Option, Result } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { makeDataBindingHost, dataBindingActivationRequest,
  type DataBindingActivationReport } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/repository";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../../persistence-postgres/src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../persistence-postgres/src/database/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { makeLogicalSchemaAdmission } from "../../../persistence-postgres/src/storage/catalog/logicalSchemaAdmission";
import { readLogicalStorageRequirements, ensureLogicalStorageDefinitions } from "../../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../../persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract } from "../../../persistence-postgres/src/frameworks/commerceTransaction/logicalSelection";
import { fxSystemLogicalSourceInitializations } from "../../../persistence-postgres/src/storage/catalog/logicalStorageInitialization";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { MixedMutationProductFixture } from "./mixedMutationWorkerdFixture";
import type { Json } from "flarex-protocol/json";

/** Re-admit unchanged source semantics when a new real Application analysis is
 * selected, then activate its genuine binding. A fresh Product reader selects
 * the resulting catalog rather than retaining the old standalone selection. */
export async function rebindMixedMutationApplication(fixture: MixedMutationProductFixture, requestId: string): Promise<{
  activated: DataBindingActivationReport<Effect.Error<ReturnType<MixedMutationProductFixture["application"]["activation"]["readActive"]>>>;
  proveCurrentInitializationAndWrite: () => Promise<{ title: string; readCallbacks: number; writeCallbacks: number }>;
  readCurrentProduct: () => Promise<Json>;
}> {
  const { currency, application } = fixture;
  const location = { scopeId: fixture.activation.anchor.scopeId,
    storageGeneration: fixture.activation.anchor.storageGeneration };
  const selected = await currency.persistence.drizzle.transaction(tx => Effect.runPromise(readBindingSelectedEvidence(tx, location)));
  if (Option.isNone(selected)) throw new Error("Missing genuine mixed binding head");
  const originalReference = selected.value.candidate.frame.logicalSchema;
  if (originalReference === null) throw new Error("Missing genuine mixed logical schema");
  const active = await Effect.runPromise(application.activation.readActive());
  const requirements = await Effect.runPromise(readLogicalStorageRequirements(currency.control.drizzle,
    currency.deploymentId, originalReference.schemaVersionId));
  const analysis = { candidateId: active.basis.candidateId, analysisId: active.basis.analysisId,
    manifestSha256: encodeBytesToLowercaseHex(active.basis.manifestSha256),
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(active.basis.sourceArtifactRootSha256) };
  const originalAnalysis = requirements.evidence.candidate.applicationAnalysis;
  let logicalSchema = originalReference;
  if (analysis.candidateId !== originalAnalysis.candidateId || analysis.analysisId !== originalAnalysis.analysisId) {
    // This helper supports equal semantics and exact ABA restoration. A changed
    // native program/schema needs its own source compiler and activation proof.
    if (analysis.manifestSha256 !== originalAnalysis.manifestSha256 ||
      analysis.sourceArtifactRootSha256 !== originalAnalysis.sourceArtifactRootSha256)
      throw new Error("Application rebind requires unchanged native source semantics");
    const prepared = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...requirements.evidence.candidate,
      applicationAnalysis: analysis }));
    const schemaVersionId = decodeCatalogSchemaVersionId(`mixed-rebind-${requestId}`);
    const resource = currency.resource;
    const session = resource.kind === "postgres" ? makeCatalogControlSessionStarter({ controlDb: currency.control.drizzle,
      driver: makePostgresCatalogControlSessionDriver(resource.control.pool) })
      : makePGliteFrameworkSchemaArtifactAdmissionFixture(resource.control).controlSessionStarter;
    await Effect.runPromise(Effect.gen(function* () {
      yield* makeLogicalSchemaAdmission({ controlDb: currency.control.drizzle, session,
        deploymentId: currency.deploymentId, scopeId: location.scopeId }).admit(prepared,
        { schemaVersionId, version: decodeCatalogSchemaVersion(requirements.artifact.version + 1) }, {
          initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
          lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
    }));
    const catalog = await currency.control.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
      const definitions = yield* ensureLogicalStorageDefinitions(tx, currency.deploymentId, schemaVersionId);
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(currency.control.drizzle,
        { deploymentId: currency.deploymentId, schemaVersionId }, tx);
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
      return definitions;
    })));
    const ports = { controlDb: currency.control.drizzle, authority: application.authorityPorts };
    const input = { deploymentId: currency.deploymentId, scopeId: location.scopeId, schemaVersionId };
    const ordered = await Effect.runPromise(reconcilePublishedIndexBuildsV1Effect(ports, input));
    if (ordered.status !== "reconciled") throw new Error("Rebound index requirements were not declared");
    for (const indexDefinitionId of ordered.definitionIds) {
      const definition = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(currency.control.drizzle, location.scopeId, indexDefinitionId));
      if (definition === null) throw new Error("Missing rebound index definition");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const buildInput = { deploymentId: currency.deploymentId, scopeId: location.scopeId, indexDefinitionId, pageSize: 16 };
        const result = definition.access.kind === "by_creation_time"
          ? await Effect.runPromise(buildIntrinsicCreationTimeIndexV1Effect(ports, buildInput))
          : await Effect.runPromise(buildAppDeveloperOrderedIndexV1Effect(ports, buildInput));
        if (result.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("Rebound index did not become ready");
    }
    const unique = await Effect.runPromise(reconcileAppUniqueConstraintSetBuildV1Effect(ports, input));
    if (unique.status !== "reconciled") throw new Error("Rebound unique requirements were not declared");
    let uniqueEnabled = false;
    for (let step = 0; step < (unique.definitionCount + 1) * 4; step++) {
      const result = await Effect.runPromise(advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...input, pageSize: 16 }));
      if (result.lifecycle === "enabled" && result.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("Rebound unique requirements did not become ready");
    logicalSchema = { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) };
  }
  const bindings = await Effect.runPromise(makeDataBindingHost({ database: currency.persistence.drizzle,
    selection: { deploymentId: currency.deploymentId, scopeId: location.scopeId },
    target: currency.bindingTarget, authority: application.authorityPorts, application: application.activation,
    logicalStorage: { controlDb: currency.control.drizzle, schemaVersionId: logicalSchema.schemaVersionId,
      unique: application.uniqueConstraintEligibility } }));
  const reference = await Effect.runPromise(bindings.readApplicationReference());
  const candidate = await Effect.runPromise(bindings.prepare({ ...selected.value.candidate.frame, application: reference, logicalSchema }));
  const activated = await Effect.runPromise(bindings.activate(dataBindingActivationRequest(location.scopeId,
    location.storageGeneration, requestId, candidate.sha256,
    { sequence: selected.value.head.frame.sequence, sha256: selected.value.head.sha256 })));
  if (!Result.getOrThrow(activated.current).selected) throw new Error("Refreshed mixed binding was not selected");
  return { activated, proveCurrentInitializationAndWrite: async () => {
    const product = fixture.product;
    const sourceKey = "medusa.product";
    const initialization = product.hostInput.logicalStorage.initialization;
    const predicate = and(eq(fxSystemLogicalSourceInitializations.scopeUuid, projectScopeIdUuidV1(location.scopeId).scopeUuid),
      eq(fxSystemLogicalSourceInitializations.sourceKey, sourceKey), eq(fxSystemLogicalSourceInitializations.stepId, initialization.stepId));
    const [receipt] = await currency.persistence.drizzle.select().from(fxSystemLogicalSourceInitializations).where(predicate);
    if (receipt === undefined) throw new Error("Missing genuine original Product seed receipt");
    const currentRequirements = await Effect.runPromise(readLogicalStorageRequirements(currency.control.drizzle,
      currency.deploymentId, logicalSchema.schemaVersionId));
    const source = currentRequirements.evidence.candidate.sources.find(member => member.key === sourceKey);
    if (source === undefined) throw new Error("Missing genuine rebound Product source");
    const currentSelection = { ...product.hostInput.logicalStorage, schemaVersionId: logicalSchema.schemaVersionId };
    const currentContract = await Effect.runPromise(Effect.fromResult(captureLogicalCommerceSelection(currentSelection))
      .pipe(Effect.flatMap(prepareLogicalCommerceContract)));
    expect(receipt).toMatchObject({ sourceSha256: source.sourceSha256,
      datasetSha256: initialization.datasetSha256, rowCount: initialization.expectedRowCount });
    expect(receipt.contractSha256).not.toBe(currentContract.sha256Hex);
    let readCallbacks = 0;
    let writeCallbacks = 0;
    const read = defineCommerceCommand("reboundProductRead", "read", (context, args) => Effect.gen(function* () {
      readCallbacks++;
      return yield* context.nested(product.runtime.commands.retrieve, args);
    }));
    const write = defineCommerceCommand("reboundProductWrite", "write", (context, args) => Effect.gen(function* () {
      writeCallbacks++;
      return yield* context.nested(product.runtime.commands.internalProductUpdate, args);
    }));
    const current = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, logicalStorage: currentSelection,
      commands: [read, write, product.runtime.commands.retrieve, product.runtime.commands.internalProductUpdate] }));
    const readArgs = { id: fixture.seed.productId, config: { select: ["id", "title"] } };
    const title = `${fixture.seed.newTitle} after rebind`;
    const writeArgs = { id: fixture.seed.productId, title };
    try {
      for (const corrupt of [{ sourceSha256: "e".repeat(64) }, { datasetSha256: "d".repeat(64) }, { rowCount: receipt.rowCount + 1 }]) {
        try {
          expect(await currency.persistence.drizzle.update(fxSystemLogicalSourceInitializations).set(corrupt).where(predicate)
            .returning()).toHaveLength(1);
          await expect(Effect.runPromise(current.read(read, readArgs)))
            .rejects.toMatchObject({ _tag: "CommerceTransactionError", reason: "seedMismatch" });
          await expect(Effect.runPromise(current.run(current.newRequestKey(), write, writeArgs)))
            .rejects.toMatchObject({ _tag: "CommerceTransactionError", reason: "seedMismatch" });
          expect(readCallbacks).toBe(0);
          expect(writeCallbacks).toBe(0);
        } finally {
          await currency.persistence.drizzle.update(fxSystemLogicalSourceInitializations).set({ sourceSha256: receipt.sourceSha256,
            datasetSha256: receipt.datasetSha256, rowCount: receipt.rowCount }).where(predicate);
        }
      }
      expect(await Effect.runPromise(current.read(read, readArgs))).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
      await Effect.runPromise(current.run(current.newRequestKey(), write, writeArgs));
      expect(await Effect.runPromise(current.read(read, readArgs))).toMatchObject({ id: fixture.seed.productId, title });
      expect(await currency.persistence.drizzle.select().from(fxSystemLogicalSourceInitializations).where(predicate)).toEqual([receipt]);
      return { title, readCallbacks, writeCallbacks };
    } finally { await Effect.runPromise(current.close); }
  }, readCurrentProduct: async () => {
    const product = fixture.product;
    const reader = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      logicalStorage: { ...product.hostInput.logicalStorage, schemaVersionId: logicalSchema.schemaVersionId },
      commands: [product.runtime.commands.retrieve] }));
    try { return await Effect.runPromise(reader.read(product.runtime.commands.retrieve, { id: fixture.seed.productId,
      config: { relations: ["options.values", "tags", "variants.options", "images", "categories"] } })); }
    finally { await Effect.runPromise(reader.close); }
  } };
}
