import { and, asc, eq, sql } from "drizzle-orm";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity } from
  "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  type ApplicationRelationBindingPublication,
  type ApplicationRelationBindingRepository,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { createApplicationRelationServingInspector } from
  "../src/applicationRelationServing";
import {
  ApplicationRelationBuildCorruptionError,
  createApplicationRelationBuildPort,
  type ApplicationRelationBuildPort,
} from "../src/applicationRelationBuild";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from
  "../src/appRows";
import {
  createApplicationRelationCommitPort,
} from "../src/applicationRelationCommit";
import {
  ApplicationRelationReadinessCorruptionError,
  ApplicationRelationReadinessStaleAuthorityError,
  ApplicationRelationReadinessUnavailableError,
  createApplicationRelationReadinessPort,
  hasApplicationRelationSetReadinessEvidenceAuthority,
  hasApplicationRelationReadinessAuthority,
  hasPreparedApplicationRelationReadinessAuthority,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationReadinessStepResult,
  type PreparedApplicationRelationReadiness,
  validateApplicationRelationSetReadinessInTransactionEffect,
} from "../src/applicationRelationReadiness";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { resolveLocatedTrustedScopeAuthorityEffect } from
  "../src/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../src/scopeClock";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxControlEdgeDefinitions,
  fxControlRelations,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildDocumentId,
  relationBuildPublicationInput,
  relationBuildRowId,
  type RelationBuildPublicationOptions,
} from "./applicationRelationBuildTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "e01-b-readiness-pglite",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

let fixtureOrdinal = 0;

describe("E01-B private application relation readiness", () => {
  it("prepares the exact manifest-bound relation and physical-work set", async () => {
    const fixture = await fixtureFor("prepare");
    const publication = await publishNew(fixture, fixtureOrdinal);
    const prepared = await runEffect(fixture.port.prepare({
      deploymentId: fixture.deploymentId,
      applicationManifestSha256:
        publication.manifestBinding.applicationManifestSha256,
    }));

    expect(prepared).toMatchObject({
      deploymentId: fixture.deploymentId,
      applicationManifestSha256:
        publication.manifestBinding.applicationManifestSha256,
      manifestSchemaBindingSha256:
        publication.manifestSchemaBindingSha256,
      applicationSchemaSha256: publication.binding.applicationSchemaSha256,
      schemaVersionId: publication.binding.schemaVersionId,
      schemaVersion: publication.binding.schemaVersion,
      schemaManifestSha256: publication.binding.schemaManifestSha256,
      boundPublicationSha256: publication.boundPublicationSha256,
    });
    expect(prepared.relations).toHaveLength(1);
    expect(prepared.relations[0]).toMatchObject({
      binding: publication.binding.relationBindings[0],
      immediateOrigin: null,
    });
    expect(hasApplicationRelationReadinessAuthority(fixture.port)).toBe(true);
    expect(hasPreparedApplicationRelationReadinessAuthority(
      fixture.port,
      prepared,
    )).toBe(true);
    expect(hasPreparedApplicationRelationReadinessAuthority(
      fixture.port,
      Object.freeze({ ...prepared }),
    )).toBe(false);

    const copiedPort = Object.freeze({ ...fixture.port });
    expect(hasApplicationRelationReadinessAuthority(copiedPort)).toBe(false);
  });

  it("issues stable nominal evidence for the exact direct relation set", async () => {
    const fixture = await fixtureFor("direct_set");
    const publication = await publishNew(fixture, fixtureOrdinal);
    const edgeDefinitionId = await enablePhysicalReadiness(
      fixture,
      publication,
    );
    const prepared = await prepare(fixture, publication);
    const first = await validateSet(fixture, prepared);
    const second = await validateSet(fixture, prepared);
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") {
      throw new Error("Direct relation-set readiness was not complete.");
    }
    const physicalRows = await fixture.control.drizzle.select().from(
      fxSystemEdgeDefinitionReadiness,
    ).where(and(
      eq(fxSystemEdgeDefinitionReadiness.scopeId, fixture.scopeId),
      eq(
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        edgeDefinitionId,
      ),
    ));
    const physical = physicalRows[0];
    if (physical === undefined) {
      throw new Error("Direct relation physical readiness is missing.");
    }
    expect(first.evidence.receipt).toMatchObject({
      format: "flarex.application-relation-set-readiness",
      version: 1,
      scopeId: fixture.scopeId,
      deploymentId: fixture.deploymentId,
      applicationManifestSha256:
        publication.manifestBinding.applicationManifestSha256,
      manifestSchemaBindingSha256:
        publication.manifestSchemaBindingSha256,
      applicationSchemaSha256: publication.binding.applicationSchemaSha256,
      schemaVersionId: publication.binding.schemaVersionId,
      schemaVersion: publication.binding.schemaVersion,
      schemaManifestSha256: publication.binding.schemaManifestSha256,
      boundPublicationSha256: publication.boundPublicationSha256,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: "1",
      epoch: fixture.epoch,
      frontierCommitSeq: "0",
      relationCount: 1,
      relations: [{
        relationOrdinal: 1,
        relationId: prepared.relations[0]?.binding.relationId,
        sourceTableId: prepared.relations[0]?.binding.sourceTableId,
        targetTableId: prepared.relations[0]?.binding.targetTableId,
        semanticDefinitionSha256:
          prepared.relations[0]?.binding.semanticDefinitionSha256,
        edgeDefinitionId,
        physicalDefinitionSha256:
          prepared.relations[0]?.physicalDefinitionSha256,
        readinessKind: "physical",
        attemptFence: physical.attemptFence.toString(),
        readinessSha256: encodeBytesToLowercaseHex(
          physical.readinessSha256,
        ),
      }],
    });
    expect(second.evidence.canonicalBytes).toEqual(
      first.evidence.canonicalBytes,
    );
    expect(second.evidence.sha256).toEqual(first.evidence.sha256);
    const recomputed = new Uint8Array(await globalThis.crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(first.evidence.canonicalBytes),
    ));
    expect(recomputed).toEqual(first.evidence.sha256);
    expect(hasApplicationRelationSetReadinessEvidenceAuthority(
      fixture.port,
      first.evidence,
    )).toBe(true);
    expect(hasApplicationRelationSetReadinessEvidenceAuthority(
      fixture.port,
      Object.freeze({ ...first.evidence }),
    )).toBe(false);
    const foreign = await fixtureFor("direct_set_foreign");
    expect(hasApplicationRelationSetReadinessEvidenceAuthority(
      foreign.port,
      first.evidence,
    )).toBe(false);

    const changedBytes = first.evidence.canonicalBytes;
    changedBytes[0] = (changedBytes[0] ?? 0) ^ 1;
    const changedDigest = first.evidence.sha256;
    changedDigest[0] = (changedDigest[0] ?? 0) ^ 1;
    expect(first.evidence.canonicalBytes).toEqual(
      second.evidence.canonicalBytes,
    );
    expect(first.evidence.sha256).toEqual(second.evidence.sha256);
  });

  it("folds two distinct reused relations without changing physical state", async () => {
    const fixture = await fixtureFor("two_relation_set");
    const original = await publishNew(fixture, fixtureOrdinal, {
      secondRelation: true,
      inverseName: "authoredPosts",
      secondInverseName: "reviewedPosts",
    });
    expect(original.binding.relationBindings.map(binding =>
      binding.relationOrdinal
    )).toEqual([1, 2]);
    expect(new Set(original.binding.relationBindings.map(binding =>
      binding.relationId
    )).size).toBe(2);
    expect(new Set(original.binding.relationBindings.map(binding =>
      binding.edgeDefinitionId
    )).size).toBe(2);
    expect(new Set(original.binding.relationBindings.map(binding =>
      binding.semanticDefinitionSha256
    )).size).toBe(2);

    await seedPopulatedRows(fixture, original, 3);
    const enabled = await enablePhysicalReadinessSet(fixture, original);
    expect(enabled.map(definition => definition.relationOrdinal)).toEqual([
      1,
      2,
    ]);
    const originalPrepared = await prepare(fixture, original);
    expect(new Set(originalPrepared.relations.map(relation =>
      relation.physicalDefinitionSha256
    )).size).toBe(2);
    const directSet = await validateSet(fixture, originalPrepared);
    expect(directSet.status).toBe("ready");
    if (directSet.status !== "ready") {
      throw new Error("Original two-relation set was not ready.");
    }
    expect(directSet.evidence.receipt.relations.map(child => ({
      ordinal: child.relationOrdinal,
      kind: child.readinessKind,
    }))).toEqual([
      { ordinal: 1, kind: "physical" },
      { ordinal: 2, kind: "physical" },
    ]);
    expect(new Set(directSet.evidence.receipt.relations.map(child =>
      child.readinessSha256
    )).size).toBe(2);
    const physicalRows = await fixture.control.drizzle.select().from(
      fxSystemEdgeDefinitionReadiness,
    ).where(eq(
      fxSystemEdgeDefinitionReadiness.scopeId,
      fixture.scopeId,
    ));
    expect(physicalRows).toHaveLength(2);
    const physicalByEdgeDefinitionId = new Map(physicalRows.map(row => [
      row.edgeDefinitionId,
      row,
    ] as const));
    for (const child of directSet.evidence.receipt.relations) {
      const relation = originalPrepared.relations[child.relationOrdinal - 1];
      const physical = physicalByEdgeDefinitionId.get(child.edgeDefinitionId);
      if (relation === undefined || physical === undefined) {
        throw new Error("Two-relation physical evidence mapping is missing.");
      }
      expect(child).toMatchObject({
        relationId: relation.binding.relationId,
        edgeDefinitionId: relation.edge.edgeDefinitionId,
        physicalDefinitionSha256: relation.physicalDefinitionSha256,
        attemptFence: physical.attemptFence.toString(),
        readinessSha256: encodeBytesToLowercaseHex(
          physical.readinessSha256,
        ),
      });
    }
    const physicalBefore = await physicalStateSnapshot(fixture);

    const successor = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      {
        inverseName: "articlesAuthored",
        secondInverseName: "articlesReviewed",
      },
    );
    const successorPrepared = await prepare(fixture, successor);
    expect(successor.binding.schemaVersionId).not.toBe(
      original.binding.schemaVersionId,
    );
    expect(successor.boundPublicationSha256).not.toBe(
      original.boundPublicationSha256,
    );
    for (let index = 0; index < 2; index += 1) {
      const originalBinding = original.binding.relationBindings[index];
      const successorBinding = successor.binding.relationBindings[index];
      const originalRelation = originalPrepared.relations[index];
      const successorRelation = successorPrepared.relations[index];
      if (
        originalBinding === undefined || successorBinding === undefined ||
        originalRelation === undefined || successorRelation === undefined
      ) {
        throw new Error("Two-relation readiness fixture is not dense.");
      }
      expect(successorBinding).toMatchObject({
        relationOrdinal: index + 1,
        relationId: originalBinding.relationId,
        edgeDefinitionId: originalBinding.edgeDefinitionId,
        evolution: {
          kind: "preserve",
          fromSchemaVersionId: original.binding.schemaVersionId,
          fromRelationOrdinal: index + 1,
          physical: "reuse",
        },
      });
      expect(successorBinding.semanticDefinitionSha256).not.toBe(
        originalBinding.semanticDefinitionSha256,
      );
      expect(successorRelation.physicalDefinitionSha256).toBe(
        originalRelation.physicalDefinitionSha256,
      );
    }
    expect(new Set(successorPrepared.relations.map(relation =>
      relation.edge.edgeDefinitionId
    )).size).toBe(2);
    expect(new Set(successorPrepared.relations.map(relation =>
      relation.physicalDefinitionSha256
    )).size).toBe(2);

    const steps = await advanceUntilComplete(fixture, successor);
    const settledOrdinals = steps.flatMap(step =>
      "relationOrdinal" in step ? [step.relationOrdinal] : []
    );
    const firstSecond = settledOrdinals.indexOf(2);
    expect(firstSecond).toBeGreaterThan(0);
    expect(settledOrdinals.slice(0, firstSecond).every(value => value === 1))
      .toBe(true);
    expect(settledOrdinals.slice(firstSecond).every(value => value === 2))
      .toBe(true);

    const semanticRows = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticReadiness,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        fixture.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        successor.binding.schemaVersionId,
      ),
    )).orderBy(asc(
      fxSystemApplicationRelationSemanticReadiness.relationOrdinal,
    ));
    expect(semanticRows.map(row => row.relationOrdinal)).toEqual([1, 2]);
    expect(semanticRows.every(row =>
      row.originReadinessKind === "physical"
    )).toBe(true);

    const semanticSet = await validateSet(fixture, successorPrepared);
    expect(semanticSet.status).toBe("ready");
    if (semanticSet.status !== "ready") {
      throw new Error("Successor two-relation set was not ready.");
    }
    expect(semanticSet.evidence.receipt.relationCount).toBe(2);
    expect(semanticSet.evidence.receipt.relations.map(child => ({
      ordinal: child.relationOrdinal,
      kind: child.readinessKind,
    }))).toEqual([
      { ordinal: 1, kind: "semantic" },
      { ordinal: 2, kind: "semantic" },
    ]);
    expect(new Set(semanticSet.evidence.receipt.relations.map(child =>
      child.readinessSha256
    )).size).toBe(2);
    const semanticByOrdinal = new Map(semanticRows.map(row => [
      row.relationOrdinal,
      row,
    ] as const));
    for (const child of semanticSet.evidence.receipt.relations) {
      const semantic = semanticByOrdinal.get(child.relationOrdinal);
      const physical = physicalByEdgeDefinitionId.get(
        child.edgeDefinitionId,
      );
      if (semantic === undefined || physical === undefined) {
        throw new Error("Two-relation semantic evidence mapping is missing.");
      }
      expect(child).toMatchObject({
        attemptFence: semantic.attemptFence.toString(),
        readinessSha256: encodeBytesToLowercaseHex(
          semantic.readinessSha256,
        ),
      });
      expect(child.readinessSha256).not.toBe(encodeBytesToLowercaseHex(
        physical.readinessSha256,
      ));
    }
    expect(semanticSet.evidence.sha256).not.toEqual(directSet.evidence.sha256);
    expect(await physicalStateSnapshot(fixture)).toEqual(physicalBefore);
    for (const definition of enabled) {
      expect(await sidecarCounts(
        fixture,
        definition.edgeDefinitionId,
      )).toEqual({ edges: 3, versions: 6 });
    }
  });

  it("orders one semantic child and one new physical child", async () => {
    const fixture = await fixtureFor("mixed_relation_set");
    const original = await publishNew(fixture, fixtureOrdinal, {
      inverseName: "authoredPosts",
    });
    await enablePhysicalReadiness(fixture, original);
    const successor = await runEffect(publishApplicationRelationBindingEffect(
      repositoryFor(fixture),
      await relationBuildPublicationInput(
        fixture.deploymentId,
        fixtureOrdinal + 1_000,
        {
          secondRelation: true,
          inverseName: "articlesAuthored",
          secondInverseName: "reviewedPosts",
          decisions: Object.freeze([{
            relationOrdinal: 1,
            evolution: Object.freeze({
              kind: "preserve" as const,
              fromSchemaVersionId: original.binding.schemaVersionId,
              fromRelationOrdinal: 1,
              physical: "reuse" as const,
            }),
          }, {
            relationOrdinal: 2,
            evolution: Object.freeze({ kind: "new" as const }),
          }]),
        },
      ),
    ));
    const definitions = await runEffect(fixture.relationCommit.locate({
      deploymentId: fixture.deploymentId,
      schemaVersionId: successor.binding.schemaVersionId,
    }));
    const second = definitions?.definitions[1];
    if (second === undefined) {
      throw new Error("Mixed relation-set second definition is missing.");
    }
    await advancePhysicalUntilEnabled(
      fixture,
      physicalInput(
        fixture,
        successor,
        second.edge.edgeDefinitionId,
      ),
    );
    await advanceUntilComplete(fixture, successor);
    const prepared = await prepare(fixture, successor);
    const result = await validateSet(fixture, prepared);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("Mixed relation set was not ready.");
    }
    expect(result.evidence.receipt.relations.map(child => ({
      ordinal: child.relationOrdinal,
      kind: child.readinessKind,
    }))).toEqual([
      { ordinal: 1, kind: "semantic" },
      { ordinal: 2, kind: "physical" },
    ]);
    expect(result.evidence.receipt.relations[0]).toMatchObject({
      relationId: original.binding.relationBindings[0]?.relationId,
      edgeDefinitionId:
        original.binding.relationBindings[0]?.edgeDefinitionId,
    });
    expect(result.evidence.receipt.relations[1]?.relationId).not.toBe(
      result.evidence.receipt.relations[0]?.relationId,
    );
  });

  it("rejects a foreign prepared token and an unexpected semantic head", async () => {
    const fixture = await fixtureFor("exact_set_negative");
    const original = await publishNew(fixture, fixtureOrdinal);
    await enablePhysicalReadiness(fixture, original);
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { inverseName: "articles" },
    );
    await advanceUntilComplete(fixture, reused);
    const prepared = await prepare(fixture, reused);

    const foreign = await fixtureFor("exact_set_foreign");
    const foreignPublication = await publishNew(
      foreign,
      fixtureOrdinal + 2_000,
    );
    const foreignPrepared = await prepare(foreign, foreignPublication);
    const foreignFailure = await validateSetFailure(
      fixture,
      foreignPrepared,
    );
    expect(foreignFailure).toBeInstanceOf(
      ApplicationRelationReadinessUnavailableError,
    );
    expect(foreignFailure).toMatchObject({ reason: "compositionMissing" });

    const rows = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticValidations,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticValidations.scopeId,
        fixture.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        reused.binding.schemaVersionId,
      ),
    ));
    const head = rows[0];
    if (head === undefined) {
      throw new Error("Exact-set semantic head fixture is missing.");
    }
    await fixture.control.drizzle.insert(
      fxSystemApplicationRelationSemanticValidations,
    ).values({
      ...head,
      relationOrdinal: 3,
    });
    const extraFailure = await validateSetFailure(fixture, prepared);
    expect(extraFailure).toBeInstanceOf(
      ApplicationRelationReadinessCorruptionError,
    );
    expect(extraFailure).toMatchObject({ reason: "definitionSet" });
  });

  it("stays read-only on rollback and rejects stale locked authority", async () => {
    const fixture = await fixtureFor("set_authority");
    const publication = await publishNew(fixture, fixtureOrdinal);
    await enablePhysicalReadiness(fixture, publication);
    const prepared = await prepare(fixture, publication);
    const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
      fixture.deploymentId,
      fixture.authority,
    ));
    const before = await physicalStateSnapshot(fixture);
    const rollbackMarker = new Error("rollback relation-set validation");
    await expect(fixture.control.drizzle.transaction(async (tx) => {
      const clock = await runEffect(
        lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
      );
      const result = await runEffect(
        validateApplicationRelationSetReadinessInTransactionEffect(
          fixture.port,
          tx,
          located.authority,
          clock,
          prepared,
        ),
      );
      expect(result.status).toBe("ready");
      throw rollbackMarker;
    })).rejects.toBe(rollbackMarker);
    expect(await physicalStateSnapshot(fixture)).toEqual(before);

    const movedEpoch = ScopeEpochSchema.make(
      `epoch_e01b9999-0000-4000-8000-${fixtureOrdinal.toString(16)
        .padStart(12, "0")}`,
    );
    await fixture.control.drizzle.update(fxSystemScopeClocks).set({
      epoch: movedEpoch,
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    const stale = await fixture.control.drizzle.transaction(async (tx) => {
      const clock = await runEffect(
        lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
      );
      return runEffectFailure(
        validateApplicationRelationSetReadinessInTransactionEffect(
          fixture.port,
          tx,
          located.authority,
          clock,
          prepared,
        ),
      );
    });
    expect(stale).toBeInstanceOf(
      ApplicationRelationReadinessStaleAuthorityError,
    );
    expect(stale).toMatchObject({ reason: "epoch" });
  });

  it("retains exact immediate lineage across chained semantic reuse", async () => {
    const fixture = await fixtureFor("chain");
    const original = await publishNew(fixture, fixtureOrdinal);
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const chained = await publishReuse(
      fixture,
      fixtureOrdinal + 2_000,
      reused,
      { extraUserField: true, inverseName: "articles" },
    );

    const reusedPrepared = await prepare(fixture, reused);
    const chainedPrepared = await prepare(fixture, chained);
    const reusedRelation = reusedPrepared.relations[0];
    const chainedRelation = chainedPrepared.relations[0];
    expect(reusedRelation?.immediateOrigin).toMatchObject({
      schemaVersionId: original.binding.schemaVersionId,
      relationOrdinal: 1,
      edgeDefinitionId:
        original.binding.relationBindings[0]?.edgeDefinitionId,
    });
    expect(chainedRelation?.immediateOrigin).toMatchObject({
      schemaVersionId: reused.binding.schemaVersionId,
      relationOrdinal: 1,
      semanticDefinitionSha256:
        reused.binding.relationBindings[0]?.semanticDefinitionSha256,
      edgeDefinitionId:
        original.binding.relationBindings[0]?.edgeDefinitionId,
    });
    expect(chainedRelation?.immediateOrigin?.schemaVersionId).not.toBe(
      original.binding.schemaVersionId,
    );
    expect(chainedRelation?.physicalDefinitionSha256).toBe(
      reusedRelation?.physicalDefinitionSha256,
    );
  });

  it("fails closed for an absent manifest pin and mismatched composition", async () => {
    const fixture = await fixtureFor("missing");
    const publication = await publishNew(fixture, fixtureOrdinal);
    const missing = await runEffectFailure(fixture.port.prepare({
      deploymentId: fixture.deploymentId,
      applicationManifestSha256:
        publication.manifestBinding.applicationManifestSha256.replace(
          /^./,
          publication.manifestBinding.applicationManifestSha256[0] === "0"
            ? "1"
            : "0",
        ),
    }));
    expect(missing).toBeInstanceOf(
      ApplicationRelationReadinessUnavailableError,
    );
    expect(missing).toMatchObject({ reason: "manifestBindingUnavailable" });

    const foreign = await fixtureFor("foreign");
    const invalidPort = createApplicationRelationReadinessPort(
      fixture.control.drizzle,
      fixture.authority,
      fixture.relationCommit,
      foreign.build,
    );
    const invalid = await runEffectFailure(invalidPort.prepare({
      deploymentId: fixture.deploymentId,
      applicationManifestSha256:
        publication.manifestBinding.applicationManifestSha256,
    }));
    expect(invalid).toMatchObject({ reason: "compositionMissing" });
  });

  it("fails closed before semantic state is written when the physical receipt is corrupt", async () => {
    const fixture = await fixtureFor("corrupt_physical_receipt");
    const original = await publishNew(fixture, fixtureOrdinal);
    const edgeDefinitionId = await enablePhysicalReadiness(fixture, original);
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const physicalRows = await fixture.control.drizzle.select().from(
      fxSystemEdgeDefinitionReadiness,
    ).where(and(
      eq(fxSystemEdgeDefinitionReadiness.scopeId, fixture.scopeId),
      eq(
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        edgeDefinitionId,
      ),
    ));
    const physical = physicalRows[0];
    if (physical === undefined) {
      throw new Error("E01-B physical receipt is missing from the fixture.");
    }
    const corruptBytes = Uint8Array.from(physical.receiptBytes);
    corruptBytes[0] = (corruptBytes[0] ?? 0) ^ 1;
    await fixture.control.drizzle.update(fxSystemEdgeDefinitionReadiness).set({
      receiptBytes: corruptBytes,
    }).where(and(
      eq(fxSystemEdgeDefinitionReadiness.scopeId, fixture.scopeId),
      eq(
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        edgeDefinitionId,
      ),
    ));

    const failure = await runEffectFailure(fixture.port.advance(readinessInput(
      fixture,
      reused,
    )));
    expect(failure).toBeInstanceOf(ApplicationRelationBuildCorruptionError);
    expect(failure).toMatchObject({ reason: "receiptEvidence" });
    const semanticRows = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticValidations,
    ).where(eq(
      fxSystemApplicationRelationSemanticValidations.scopeId,
      fixture.scopeId,
    ));
    expect(semanticRows).toHaveLength(0);
  });

  it("settles direct and chained semantic reuse without sidecar writes", async () => {
    const fixture = await fixtureFor("semantic_chain");
    const original = await publishNew(fixture, fixtureOrdinal);
    const edgeDefinitionId = await enablePhysicalReadiness(
      fixture,
      original,
    );
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const chained = await publishReuse(
      fixture,
      fixtureOrdinal + 2_000,
      reused,
      { extraUserField: true, inverseName: "articles" },
    );
    const before = await sidecarCounts(fixture, edgeDefinitionId);

    const blocked = await runEffect(fixture.port.advance(readinessInput(
      fixture,
      chained,
    )));
    expect(blocked).toMatchObject({
      status: "not_ready",
      reason: "semanticOriginMissing",
      relationOrdinal: 1,
      edgeDefinitionId,
    });

    const directSteps = await advanceUntilComplete(
      fixture,
      reused,
    );
    expect(directSteps.map((step) => step.status)).toEqual([
      "initialized",
      "advanced",
      "advanced",
      "ready",
      "complete",
    ]);
    const directRows = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticReadiness,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        fixture.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        reused.binding.schemaVersionId,
      ),
    ));
    expect(directRows).toHaveLength(1);
    expect(directRows[0]).toMatchObject({
      originReadinessKind: "physical",
      originSchemaVersionId: original.binding.schemaVersionId,
      physicalOriginSchemaVersionId: original.binding.schemaVersionId,
      originSemanticAttemptFence: null,
      originSemanticReadinessSha256: null,
      sourceCount: 0n,
      edgeCount: 0n,
      versionCount: 0n,
    });

    const chainedSteps = await advanceUntilComplete(
      fixture,
      chained,
    );
    expect(chainedSteps.at(-1)?.status).toBe("complete");
    const [reusedHead, chainedReceipt, physicalReceipt] = await Promise.all([
      fixture.control.drizzle.select().from(
        fxSystemApplicationRelationSemanticValidations,
      ).where(and(
        eq(
          fxSystemApplicationRelationSemanticValidations.scopeId,
          fixture.scopeId,
        ),
        eq(
          fxSystemApplicationRelationSemanticValidations.schemaVersionId,
          reused.binding.schemaVersionId,
        ),
      )).then((rows) => rows[0]),
      fixture.control.drizzle.select().from(
        fxSystemApplicationRelationSemanticReadiness,
      ).where(and(
        eq(
          fxSystemApplicationRelationSemanticReadiness.scopeId,
          fixture.scopeId,
        ),
        eq(
          fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
          chained.binding.schemaVersionId,
        ),
      )).then((rows) => rows[0]),
      fixture.control.drizzle.select().from(
        fxSystemEdgeDefinitionReadiness,
      ).where(and(
        eq(fxSystemEdgeDefinitionReadiness.scopeId, fixture.scopeId),
        eq(
          fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
          edgeDefinitionId,
        ),
      )).then((rows) => rows[0]),
    ]);
    expect(reusedHead?.readinessSha256).toBeInstanceOf(Uint8Array);
    expect(chainedReceipt).toMatchObject({
      originReadinessKind: "semantic",
      originSchemaVersionId: reused.binding.schemaVersionId,
      physicalOriginSchemaVersionId: original.binding.schemaVersionId,
      originSemanticAttemptFence: reusedHead?.attemptFence,
    });
    expect(chainedReceipt?.originSemanticReadinessSha256).toEqual(
      reusedHead?.readinessSha256,
    );
    expect(chainedReceipt?.physicalReadinessSha256).toEqual(
      physicalReceipt?.readinessSha256,
    );
    expect(await sidecarCounts(fixture, edgeDefinitionId)).toEqual(before);
  });

  it("revalidates populated current rows, edges, and endpoint versions", async () => {
    const fixture = await fixtureFor("populated_semantic");
    const original = await publishNew(fixture, fixtureOrdinal);
    await seedPopulatedRows(fixture, original, 3);
    const edgeDefinitionId = await enablePhysicalReadiness(
      fixture,
      original,
    );
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const before = await sidecarCounts(fixture, edgeDefinitionId);
    expect(before).toEqual({ edges: 3, versions: 6 });

    const steps = await advanceUntilComplete(fixture, reused);
    expect(steps.at(-1)?.status).toBe("complete");
    const receipts = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticReadiness,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        fixture.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        reused.binding.schemaVersionId,
      ),
    ));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      sourceCount: 3n,
      edgeCount: 3n,
      versionCount: 6n,
      physicalFrontierCommitSeq: 1n,
      frontierCommitSeq: 1n,
    });
    expect(await sidecarCounts(fixture, edgeDefinitionId)).toEqual(before);
  });

  it("pauses and restarts direct and chained validation across a physical attempt change", async () => {
    const fixture = await fixtureFor("physical_attempt_change");
    const original = await publishNew(fixture, fixtureOrdinal);
    await seedPopulatedRows(fixture, original, 1);
    const edgeDefinitionId = await enablePhysicalReadiness(
      fixture,
      original,
    );
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const chained = await publishReuse(
      fixture,
      fixtureOrdinal + 2_000,
      reused,
      { extraUserField: true, inverseName: "articles" },
    );
    await advanceUntilComplete(fixture, reused);
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      chained,
    )))).toMatchObject({
      status: "initialized",
      attemptFence: 1n,
    });

    expect(await runEffect(fixture.build.restart(physicalInput(
      fixture,
      original,
      edgeDefinitionId,
    )))).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
      attemptFence: 2n,
    });
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      reused,
    )))).toMatchObject({
      status: "not_ready",
      reason: "physicalReadinessMissing",
    });
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      chained,
    )))).toMatchObject({
      status: "not_ready",
      reason: "semanticOriginMissing",
    });

    await advancePhysicalUntilEnabled(
      fixture,
      physicalInput(fixture, original, edgeDefinitionId),
    );
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      reused,
    )))).toMatchObject({
      status: "restarted",
      attemptFence: 2n,
    });
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      chained,
    )))).toMatchObject({
      status: "not_ready",
      reason: "semanticOriginMissing",
    });
    await advanceUntilComplete(fixture, reused);
    expect(await runEffect(fixture.port.advance(readinessInput(
      fixture,
      chained,
    )))).toMatchObject({
      status: "restarted",
      attemptFence: 2n,
    });
    expect((await advanceUntilComplete(fixture, chained)).at(-1)?.status)
      .toBe("complete");
  });

  it("restarts only semantic validation when the locked frontier moves", async () => {
    const fixture = await fixtureFor("frontier_restart");
    const original = await publishNew(fixture, fixtureOrdinal);
    const edgeDefinitionId = await enablePhysicalReadiness(
      fixture,
      original,
    );
    const reused = await publishReuse(
      fixture,
      fixtureOrdinal + 1_000,
      original,
      { extraUserField: true },
    );
    const input = readinessInput(fixture, reused);
    expect(await runEffect(fixture.port.advance(input))).toMatchObject({
      status: "initialized",
      attemptFence: 1n,
      frontierCommitSeq: 0n,
    });
    await fixture.control.drizzle.update(fxSystemScopeClocks).set({
      lastCommitSeq: CommitSeqSchema.make(1n),
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    expect(await runEffect(fixture.port.advance(input))).toMatchObject({
      status: "restarted",
      attemptFence: 2n,
      frontierCommitSeq: 1n,
    });
    const remaining = await advanceUntilComplete(fixture, reused);
    expect(remaining.at(-1)?.status).toBe("complete");
    const head = await fixture.control.drizzle.select().from(
      fxSystemApplicationRelationSemanticValidations,
    ).where(and(
      eq(
        fxSystemApplicationRelationSemanticValidations.scopeId,
        fixture.scopeId,
      ),
      eq(
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        reused.binding.schemaVersionId,
      ),
    ));
    expect(head[0]).toMatchObject({
      lifecycle: "ready",
      physicalFrontierCommitSeq: 0n,
      frontierCommitSeq: 1n,
      attemptFence: 2n,
    });
    expect(await sidecarCounts(fixture, edgeDefinitionId)).toEqual({
      edges: 0,
      versions: 0,
    });
  });
});

interface Fixture {
  readonly control: PGliteFlarexPersistence;
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly scopeUuid: ScopeUuidV1;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly build: ReturnType<typeof createApplicationRelationBuildPort>;
  readonly authority: Parameters<typeof createApplicationRelationBuildPort>[1];
  readonly port: ApplicationRelationReadinessPort;
}

async function fixtureFor(suffix: string): Promise<Fixture> {
  ensureRelationBuildTestWebCrypto();
  fixtureOrdinal += 1;
  const control = await createPGlitePersistence();
  await control.migrate();
  const uuidSuffix = fixtureOrdinal.toString(16).padStart(12, "0");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_e01_b_${suffix}_${fixtureOrdinal}`,
  );
  const scopeId = ScopeIdSchema.make(
    `scope_e01b0000-0000-4000-8000-${uuidSuffix}`,
  );
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(scopeId),
  ).scopeUuid;
  const epoch = ScopeEpochSchema.make(
    `epoch_e01b0000-0000-4000-8000-${uuidSuffix}`,
  );
  await control.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_e01_b_${suffix}_${fixtureOrdinal}`,
  });
  await control.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await control.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, storage_generation_fence,
        last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const pointTarget = createPGliteLocatedPointMutationSessionActivationTargetV1(
    control,
    LOCATOR,
  );
  const relationCommit = createApplicationRelationCommitPort(
    control.drizzle,
    {
      scopeMetadata: control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeSessionTargets: { resolve: async () => pointTarget },
    },
  );
  const buildTarget = createPGliteLocatedIndexBuildReconciliationTargetV1(
    control,
    LOCATOR,
  );
  const authority = {
    scopeMetadata: control,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeClockTargets: { resolve: async () => buildTarget },
  } satisfies Parameters<typeof createApplicationRelationBuildPort>[1];
  const build = createApplicationRelationBuildPort(
    control.drizzle,
    authority,
    relationCommit,
    createApplicationRelationServingInspector(),
  );
  const port = createApplicationRelationReadinessPort(
    control.drizzle,
    authority,
    relationCommit,
    build,
  );
  return Object.freeze({
    control,
    deploymentId,
    scopeId,
    scopeUuid,
    epoch,
    relationCommit,
    build,
    authority,
    port,
  });
}

async function publishNew(
  fixture: Fixture,
  ordinal: number,
  options: RelationBuildPublicationOptions = {},
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(
      fixture.deploymentId,
      ordinal,
      options,
    ),
  ));
}

async function publishReuse(
  fixture: Fixture,
  ordinal: number,
  origin: ApplicationRelationBindingPublication,
  options: Readonly<{
    readonly extraUserField?: boolean;
    readonly inverseName?: string;
    readonly secondInverseName?: string;
  }>,
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(fixture.deploymentId, ordinal, {
      ...options,
      secondRelation: origin.binding.relationBindings.length === 2,
      decisions: Object.freeze(origin.binding.relationBindings.map(
        binding => Object.freeze({
          relationOrdinal: binding.relationOrdinal,
          evolution: Object.freeze({
            kind: "preserve" as const,
            fromSchemaVersionId: origin.binding.schemaVersionId,
            fromRelationOrdinal: binding.relationOrdinal,
            physical: "reuse" as const,
          }),
        }))),
    }),
  ));
}

function prepare(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  return runEffect(fixture.port.prepare({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      publication.manifestBinding.applicationManifestSha256,
  }));
}

async function validateSet(
  fixture: Fixture,
  prepared: PreparedApplicationRelationReadiness,
) {
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
    fixture.deploymentId,
    fixture.authority,
  ));
  return fixture.control.drizzle.transaction(async (tx) => {
    const clock = await runEffect(
      lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
    );
    return runEffect(
      validateApplicationRelationSetReadinessInTransactionEffect(
        fixture.port,
        tx,
        located.authority,
        clock,
        prepared,
      ),
    );
  });
}

async function validateSetFailure(
  fixture: Fixture,
  prepared: PreparedApplicationRelationReadiness,
) {
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
    fixture.deploymentId,
    fixture.authority,
  ));
  return fixture.control.drizzle.transaction(async (tx) => {
    const clock = await runEffect(
      lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
    );
    return runEffectFailure(
      validateApplicationRelationSetReadinessInTransactionEffect(
        fixture.port,
        tx,
        located.authority,
        clock,
        prepared,
      ),
    );
  });
}

function readinessInput(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      publication.manifestBinding.applicationManifestSha256,
  });
}

async function enablePhysicalReadiness(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const definitions = await enablePhysicalReadinessSet(fixture, publication);
  const definition = definitions[0];
  if (definition === undefined) {
    throw new Error("E01-B physical definition is missing.");
  }
  return definition.edgeDefinitionId;
}

async function enablePhysicalReadinessSet(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  if (definitions === null) {
    throw new Error("E01-B physical definition set is missing.");
  }
  const enabled: Array<Readonly<{
    readonly relationOrdinal: number;
    readonly relationId: PreparedApplicationRelationReadiness["relations"][number]["binding"]["relationId"];
    readonly edgeDefinitionId: Parameters<
      ApplicationRelationBuildPort["advance"]
    >[0]["edgeDefinitionId"];
  }>> = [];
  for (let index = 0; index < definitions.definitions.length; index += 1) {
    const definition = definitions.definitions[index];
    if (
      definition === undefined ||
      definition.binding.relationOrdinal !== index + 1
    ) {
      throw new Error("E01-B physical definition set is not dense.");
    }
    await advancePhysicalUntilEnabled(
      fixture,
      physicalInput(
        fixture,
        publication,
        definition.edge.edgeDefinitionId,
      ),
    );
    enabled.push(Object.freeze({
      relationOrdinal: definition.binding.relationOrdinal,
      relationId: definition.binding.relationId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    }));
  }
  return Object.freeze(enabled);
}

function physicalInput(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
  edgeDefinitionId: Parameters<
    ApplicationRelationBuildPort["advance"]
  >[0]["edgeDefinitionId"],
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
    edgeDefinitionId,
  });
}

async function advancePhysicalUntilEnabled(
  fixture: Fixture,
  input: Parameters<ApplicationRelationBuildPort["advance"]>[0],
): Promise<void> {
  for (let step = 0; step < 128; step += 1) {
    const result = await runEffect(fixture.build.advance(input));
    if (result.lifecycle === "enabled") return;
  }
  throw new Error("E01-B physical readiness did not settle.");
}

async function seedPopulatedRows(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
  count: number,
): Promise<void> {
  const rows = [
    ...Array.from({ length: count }, (_, index) => ({
      tableId: 2,
      ordinal: 201 + index,
      fields: Object.freeze({ name: `target-${index + 1}` }),
    })),
    ...Array.from({ length: count }, (_, index) => ({
      tableId: 1,
      ordinal: 101 + index,
      fields: Object.freeze({
        author: relationBuildDocumentId(2, 201 + index),
        ...(publication.binding.relationBindings.length === 2
          ? { reviewer: relationBuildDocumentId(2, 201 + index) }
          : {}),
      }),
    })),
  ];
  const commitSeq = CommitSeqSchema.make(1n);
  await fixture.control.drizzle.transaction(async (tx) => {
    for (const row of rows) {
      const tableId = decodeCatalogTableId(row.tableId);
      const rowId = relationBuildRowId(row.ordinal);
      const creationTime = decodeAppCreationTimeV1(row.ordinal);
      const value = await canonicalizeFlarexValueV1({
        _id: appDocumentIdV1FromRowIdentity({ tableId, rowId }),
        _creationTime: creationTime,
        ...row.fields,
      }, "appDocument");
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.scopeId,
        tableId,
        rowId,
        writeEpoch: fixture.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: publication.binding.schemaVersionId,
        creationTime,
        value: {
          codecVersion: value.codecVersion,
          valueJson: value.valueJson,
          canonicalBytes: value.canonicalBytes,
          sha256: value.sha256,
        },
      });
    }
  });
  await fixture.control.drizzle.update(fxSystemScopeClocks).set({
    lastCommitSeq: commitSeq,
  }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
}

async function advanceUntilComplete(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
): Promise<ReadonlyArray<ApplicationRelationReadinessStepResult>> {
  const input = readinessInput(fixture, publication);
  const steps: ApplicationRelationReadinessStepResult[] = [];
  for (let step = 0; step < 128; step += 1) {
    const result = await runEffect(fixture.port.advance(input));
    steps.push(result);
    if (result.status === "complete") return Object.freeze(steps);
    if (result.status === "not_ready") {
      throw new Error(`E01-B readiness blocked: ${result.reason}.`);
    }
  }
  throw new Error("E01-B semantic readiness did not settle.");
}

async function sidecarCounts(
  fixture: Fixture,
  edgeDefinitionId: Awaited<ReturnType<typeof enablePhysicalReadiness>>,
) {
  const [edges, versions] = await Promise.all([
    fixture.control.drizzle.select({ count: sql<number>`count(*)::integer` })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
        eq(fxAppEdgeCurrent.edgeDefinitionId, edgeDefinitionId),
      )),
    fixture.control.drizzle.select({ count: sql<number>`count(*)::integer` })
      .from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, fixture.scopeUuid),
        eq(
          fxAppEdgeAdjacencyVersions.edgeDefinitionId,
          edgeDefinitionId,
        ),
      )),
  ]);
  return Object.freeze({
    edges: edges[0]?.count ?? -1,
    versions: versions[0]?.count ?? -1,
  });
}

async function physicalStateSnapshot(fixture: Fixture) {
  const [relations, definitions, builds, receipts, edges, versions] =
    await Promise.all([
      fixture.control.drizzle.select().from(fxControlRelations).orderBy(
        asc(fxControlRelations.relationId),
      ),
      fixture.control.drizzle.select().from(
        fxControlEdgeDefinitions,
      ).orderBy(asc(fxControlEdgeDefinitions.edgeDefinitionId)),
      fixture.control.drizzle.select().from(
        fxSystemEdgeDefinitionBuilds,
      ).orderBy(asc(fxSystemEdgeDefinitionBuilds.edgeDefinitionId)),
      fixture.control.drizzle.select().from(
        fxSystemEdgeDefinitionReadiness,
      ).orderBy(
        asc(fxSystemEdgeDefinitionReadiness.edgeDefinitionId),
        asc(fxSystemEdgeDefinitionReadiness.attemptFence),
      ),
      fixture.control.drizzle.select().from(fxAppEdgeCurrent).orderBy(
        asc(fxAppEdgeCurrent.edgeDefinitionId),
        asc(fxAppEdgeCurrent.sourceRowId),
        asc(fxAppEdgeCurrent.targetRowId),
        asc(fxAppEdgeCurrent.duplicateOrdinal),
      ),
      fixture.control.drizzle.select().from(
        fxAppEdgeAdjacencyVersions,
      ).orderBy(
        asc(fxAppEdgeAdjacencyVersions.edgeDefinitionId),
        asc(fxAppEdgeAdjacencyVersions.direction),
        asc(fxAppEdgeAdjacencyVersions.endpointRowId),
      ),
    ]);
  return structuredClone({
    relations,
    definitions,
    builds,
    receipts,
    edges,
    versions,
  });
}

function repositoryFor(
  fixture: Fixture,
): ApplicationRelationBindingRepository {
  return {
    db: fixture.control.drizzle,
    runTransaction: <Value>(
      run: (tx: StableTableCatalogTransaction) => Promise<Value>,
    ): Promise<Value> => fixture.control.drizzle.transaction(run),
  };
}
