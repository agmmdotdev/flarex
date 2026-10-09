import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../persistence-postgres/src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/database/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { makeLogicalSchemaAdmission } from "../../persistence-postgres/src/storage/catalog/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../persistence-postgres/src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../../persistence-postgres/src/installation/frameworkSchema/binding/repository";
import { captureFiniteMetadataReservation } from "../../persistence-postgres/src/execution/finiteMetadataReservation";
import { captureFiniteAttemptAnchor, projectCapturedFiniteAttemptAnchor, readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { createPhysicalDefinitionLifecyclePort, preparePhysicalDefinitionLifecycleSubjectEffect,
  beginPhysicalDefinitionDrainingEffect, finalizePhysicalDefinitionRetirementEffect, inspectPhysicalDefinitionLifecycleEffect } from "../../persistence-postgres/src/installation/physicalDefinitionLifecycle";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "../../persistence-postgres/src/execution/transactionSessionActivation";
import { fxSystemSnapshotLeases, fxSystemTransactionSessions, fxSystemScopeExecutionAuthorities } from "../../persistence-postgres/src/database/schema";
import { selectApplicationMutationAdmission } from "../../persistence-postgres/src/application/applicationMutationAdmission";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { currencyCommands } from "../../medusa-adapter/src/currency-service";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("finite bound definition retirement on %s", driver => {
  it("retains actual index and unique definitions across a binding head move until the real root aborts", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-retirement-${driver}` });
    try {
      const { currency, application } = fixture;
      const { deploymentId } = currency;
      const scopeId = fixture.activation.anchor.scopeId;
      const sessionId = fixture.activation.anchor.sessionId;
      const [session] = await currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      expect(session?.executionAuthorityGeneration).toBe("application_v1");
      if (session === undefined) throw new Error("Missing authentic finite entry anchor");
      const anchor = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
      const reservation = anchor.reservation;
      if (reservation === null) throw new Error("Missing authentic finite entry reservation");
      expect(await currency.persistence.drizzle.select().from(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, sessionId))).toHaveLength(0);
      const capturedBinding = reservation.binding;
      if (capturedBinding === null) throw new Error("Missing authentic bound finite selector");
      const originalCatalog = await currency.control.drizzle.transaction(tx => Effect.runPromise(
        ensureLogicalStorageDefinitions(tx, deploymentId, fixture.logicalSchemaVersionId)));
      const candidate = originalCatalog.requirements.evidence.candidate;
      const source = candidate.sources.find(member => member.key === "medusa.product");
      if (source?.definition.kind !== "relational") throw new Error("Missing genuine native Product schema");
      const selectedTable = source.definition.schema.tables.find(table => table.indexes.some(index => index.kind === "uniqueBtree"));
      const selectedIndex = selectedTable?.indexes.find(index => index.kind === "uniqueBtree");
      if (selectedTable === undefined || selectedIndex === undefined) throw new Error("Missing genuine Product unique index");
      const descriptor = `index/${selectedIndex.identity.indexId}`;
      const orderedOrdinal = originalCatalog.requirements.ordered.findIndex(member => member.localName === selectedTable.identity.tableId && member.descriptor === descriptor);
      const uniqueOrdinal = originalCatalog.requirements.unique.findIndex(member => member.localName === selectedTable.identity.tableId && member.descriptor === descriptor);
      const ordered = originalCatalog.ordered[orderedOrdinal]?.definition;
      const unique = originalCatalog.unique[uniqueOrdinal]?.definition;
      if (ordered === undefined || unique === undefined) throw new Error("Native index did not produce both real physical definitions");
      expect(reservation.schemaVersionId).not.toBe(fixture.logicalSchemaVersionId);
      const port = createPhysicalDefinitionLifecyclePort({ controlDb: currency.control.drizzle, authority: application.authorityPorts });
      const subjects = await Promise.all([
        Effect.runPromise(preparePhysicalDefinitionLifecycleSubjectEffect(port, { definitionKind: "index", deploymentId, scopeId,
          indexDefinitionId: ordered.indexDefinitionId })),
        Effect.runPromise(preparePhysicalDefinitionLifecycleSubjectEffect(port, { definitionKind: "unique_constraint", deploymentId, scopeId,
          uniqueConstraintDefinitionId: unique.uniqueConstraintDefinitionId })),
      ]);
      const orderedSubject = subjects[0];
      if (orderedSubject === undefined) throw new Error("Missing prepared ordered retirement subject");
      for (const subject of subjects) {
        await Effect.runPromise(beginPhysicalDefinitionDrainingEffect(subject, { expectedTransitionFence: 0n }));
        await expect(Effect.runPromise(finalizePhysicalDefinitionRetirementEffect(subject, { expectedTransitionFence: 1n })))
          .rejects.toMatchObject({ _tag: "PhysicalDefinitionLifecyclePinnedError", pin: { owner: "active_binding", schemaVersionId: fixture.logicalSchemaVersionId } });
      }

      // Withdraw the complete Product source through a genuine immutable
      // proposal. B2 serves Application/Currency only; no Product callbacks run
      // against it. This tests retention without requiring search replacement.
      const prepared = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...candidate,
        sources: candidate.sources.filter(member => member.key !== source.key) }));
      const schemaVersionId = decodeCatalogSchemaVersionId(`finite-retirement-current-${driver}`);
      const resource = currency.resource;
      const controlSession = resource.kind === "postgres" ? makeCatalogControlSessionStarter({ controlDb: currency.control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(resource.control.pool) })
        : makePGliteFrameworkSchemaArtifactAdmissionFixture(resource.control).controlSessionStarter;
      await Effect.runPromise(Effect.gen(function* () {
        yield* makeLogicalSchemaAdmission({ controlDb: currency.control.drizzle, session: controlSession, deploymentId, scopeId }).admit(
          prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(101) }, {
            initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
      }));
      const nextCatalog = await currency.control.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
        const definitions = yield* ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId);
        const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(currency.control.drizzle, { deploymentId, schemaVersionId }, tx);
        yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
        return definitions;
      })));
      expect(nextCatalog.ordered.some(member => member.definition.indexDefinitionId === ordered.indexDefinitionId)).toBe(false);
      expect(nextCatalog.unique.some(member => member.definition.uniqueConstraintDefinitionId === unique.uniqueConstraintDefinitionId)).toBe(false);
      const ports = { controlDb: currency.control.drizzle, authority: application.authorityPorts };
      const reconciled = await Effect.runPromise(reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, scopeId, schemaVersionId }));
      if (reconciled.status !== "reconciled") throw new Error("Replacement ordered requirements were not declared");
      for (const indexDefinitionId of reconciled.definitionIds) {
        const definition = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(currency.control.drizzle, scopeId, indexDefinitionId));
        if (definition === null) throw new Error("Missing replacement ordered definition");
        let enabled = false;
        for (let step = 0; step < 20; step++) {
          const build = definition.access.kind === "by_creation_time"
            ? await Effect.runPromise(buildIntrinsicCreationTimeIndexV1Effect(ports, { deploymentId, scopeId, indexDefinitionId, pageSize: 16 }))
            : await Effect.runPromise(buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, scopeId, indexDefinitionId, pageSize: 16 }));
          if (build.lifecycle === "enabled") { enabled = true; break; }
        }
        expect(enabled).toBe(true);
      }
      const uniqueSet = await Effect.runPromise(reconcileAppUniqueConstraintSetBuildV1Effect(ports, { deploymentId, scopeId, schemaVersionId }));
      if (uniqueSet.status !== "reconciled") throw new Error("Replacement unique set was not declared");
      let ready = false;
      for (let step = 0; step < (uniqueSet.definitionCount + 1) * 4; step++) {
        const advanced = await Effect.runPromise(advanceAppUniqueConstraintSetBackfillV1Effect(ports, { deploymentId, scopeId, schemaVersionId, pageSize: 16 }));
        if (advanced.lifecycle === "enabled" && advanced.uniqueConstraintDefinitionId === null) { ready = true; break; }
      }
      expect(ready).toBe(true);
      const current = await currency.persistence.drizzle.transaction(tx => Effect.runPromise(readBindingSelectedEvidence(tx, application.authority)));
      if (Option.isNone(current)) throw new Error("Missing original authentic binding head");
      const host = await Effect.runPromise(makeDataBindingHost({ database: currency.persistence.drizzle,
        selection: { deploymentId, scopeId }, target: currency.bindingTarget, authority: application.authorityPorts, application: application.activation,
        logicalStorage: { controlDb: currency.control.drizzle, schemaVersionId, unique: application.uniqueConstraintEligibility } }));
      const next = await Effect.runPromise(host.prepare({ ...current.value.candidate.frame,
        logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(nextCatalog.requirements.artifact.manifestSha256) } }));
      const activated = await Effect.runPromise(host.activate(dataBindingActivationRequest(scopeId, "flarexdb_v1",
        `retirement-next-${driver}`, next.sha256, { sequence: current.value.head.frame.sequence, sha256: current.value.head.sha256 })));
      expect(Result.getOrThrow(activated.current).selected).toBe(true);
      expect(activated.receipt.frame.version).toBe(3);
      const [currentAuthority] = await currency.persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
      if (currentAuthority === undefined || activated.receipt.frame.version !== 3)
        throw new Error("Missing genuine accepted withdrawal epoch");
      expect(activated.receipt.frame.authorizationRevocationEpoch).toBe(currentAuthority.authorizationRevocationEpoch.toString());
      expect(BigInt(activated.receipt.frame.authorizationRevocationEpoch))
        .toBe(BigInt(next.frame.application.authorizationRevocationEpoch) + 1n);
      expect(next.frame.application.authorizationRevocationEpoch).toBe(current.value.candidate.frame.application.authorizationRevocationEpoch);
      const remainingCurrency = await Effect.runPromise(makeCommerceHost({ ...currency.hostInput,
        logicalStorage: { ...currency.hostInput.logicalStorage, schemaVersionId }, commands: [currencyCommands.retrieve] }));
      try {
        expect(await Effect.runPromise(remainingCurrency.read(currencyCommands.retrieve, { code: "usd" })))
          .toMatchObject({ code: "usd" });
      } finally { await Effect.runPromise(remainingCurrency.close); }
      const remainingApplication = await Effect.runPromise(application.activation.readActive());
      const remainingAdmission = await Effect.runPromise(selectApplicationMutationAdmission(remainingApplication.selection, "users:create", {
        deploymentId, controlDb: currency.control.drizzle, authority: application.authorityPorts, schema: application.schema,
      }));
      expect(remainingAdmission.basis.schemaVersionId).toBe(reservation.schemaVersionId);
      for (const subject of subjects) await expect(Effect.runPromise(finalizePhysicalDefinitionRetirementEffect(subject, { expectedTransitionFence: 1n })))
        .rejects.toMatchObject({ _tag: "PhysicalDefinitionLifecyclePinnedError", pin: { owner: "mutation_session", schemaVersionId: fixture.logicalSchemaVersionId } });

      // Forensic negative fixtures replace only the selector commitment in the
      // compact anchor. They never issue an entry or become positive authority.
      for (const binding of [
        { ...capturedBinding, sha256: "e".repeat(64) },
        { ...capturedBinding, activationSha256: "f".repeat(64) },
        { ...capturedBinding, sequence: "9223372036854775807" },
        { ...capturedBinding, candidateSha256: next.sha256 },
      ]) {
        const corruptReservation = await Effect.runPromise(captureFiniteMetadataReservation({ ...reservation, binding }));
        const corruptAnchor = await Effect.runPromise(captureFiniteAttemptAnchor({ snapshotToken: anchor.snapshotToken,
          reservation: corruptReservation }));
        const corrupt = Result.getOrThrow(projectCapturedFiniteAttemptAnchor(corruptAnchor));
        try {
          await currency.persistence.drizzle.update(fxSystemTransactionSessions).set(corrupt)
            .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
          await expect(Effect.runPromise(finalizePhysicalDefinitionRetirementEffect(orderedSubject, { expectedTransitionFence: 1n })))
            .rejects.toMatchObject({ _tag: "PhysicalDefinitionRetirementPinCorruptionError", owner: "mutation_session" });
        } finally {
          await currency.persistence.drizzle.update(fxSystemTransactionSessions).set({ finiteAttemptBytes: session.finiteAttemptBytes,
            finiteAttemptSha256: session.finiteAttemptSha256 }).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        }
      }
      // Coherently stripping every optional reservation field must not turn this
      // genuine persisted Application finite root into an unreserved profile.
      try {
        const cleared = Result.getOrThrow(projectCapturedFiniteAttemptAnchor(await Effect.runPromise(
          captureFiniteAttemptAnchor({ snapshotToken: anchor.snapshotToken }))));
        await currency.persistence.drizzle.update(fxSystemTransactionSessions).set(cleared)
          .where(eq(fxSystemTransactionSessions.sessionId, sessionId));
        for (const subject of subjects) {
          await expect(Effect.runPromise(finalizePhysicalDefinitionRetirementEffect(subject, { expectedTransitionFence: 1n })))
            .rejects.toMatchObject({ _tag: "PhysicalDefinitionRetirementPinCorruptionError", owner: "mutation_session" });
        }
      } finally {
        await currency.persistence.drizzle.update(fxSystemTransactionSessions).set({
          finiteMetadataWatermark: session.finiteMetadataWatermark, finiteAttemptBytes: session.finiteAttemptBytes,
          finiteAttemptSha256: session.finiteAttemptSha256,
        }).where(eq(fxSystemTransactionSessions.sessionId, sessionId));
      }
      // The new binding admits its remaining owners at the accepted live epoch;
      // the old Product root retains its original epoch and cannot execute reads.
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(fixture.nativeInvokeCount.get("update") ?? 0).toBe(0);
      expect(await Effect.runPromise(createPointMutationSessionAttemptTerminalizationPersistenceV1(application.sessionAuthority).abortEffect({
        selector: fixture.selector, expectedSnapshotToken: fixture.activation.anchor.snapshotToken,
        executionClaim: { claimOwner: fixture.activation.executionClaim.claimOwner, claimFence: fixture.activation.executionClaim.claimFence },
      }))).toMatchObject({ status: "terminalized", terminal: { lifecycle: "aborted" } });
      expect(await currency.persistence.drizzle.select().from(fxSystemSnapshotLeases).where(eq(fxSystemSnapshotLeases.sessionId, sessionId))).toHaveLength(0);
      for (const subject of subjects) {
        expect(await Effect.runPromise(finalizePhysicalDefinitionRetirementEffect(subject, { expectedTransitionFence: 1n })))
          .toMatchObject({ lifecycle: { lifecycle: "retired" } });
        expect(await Effect.runPromise(inspectPhysicalDefinitionLifecycleEffect(subject))).toMatchObject({ status: "persisted", lifecycle: { lifecycle: "retired" } });
      }
    } finally { await fixture.close(); }
  }, 240_000);
});
