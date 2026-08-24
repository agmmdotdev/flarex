import { and, eq, sql } from "drizzle-orm";
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
  ApplicationRelationReadinessUnavailableError,
  createApplicationRelationReadinessPort,
  hasApplicationRelationReadinessAuthority,
  hasPreparedApplicationRelationReadinessAuthority,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationReadinessStepResult,
} from "../src/applicationRelationReadiness";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildDocumentId,
  relationBuildPublicationInput,
  relationBuildRowId,
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
    expect(prepared.physicalDefinitions).toHaveLength(1);
    expect(prepared.physicalDefinitions[0]?.edgeDefinitionId).toBe(
      publication.binding.relationBindings[0]?.edgeDefinitionId,
    );
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
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(fixture.deploymentId, ordinal),
  ));
}

async function publishReuse(
  fixture: Fixture,
  ordinal: number,
  origin: ApplicationRelationBindingPublication,
  options: Readonly<{
    readonly extraUserField?: boolean;
    readonly inverseName?: string;
  }>,
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(fixture.deploymentId, ordinal, {
      ...options,
      decisions: Object.freeze([{
        relationOrdinal: 1,
        evolution: Object.freeze({
          kind: "preserve" as const,
          fromSchemaVersionId: origin.binding.schemaVersionId,
          fromRelationOrdinal: 1,
          physical: "reuse" as const,
        }),
      }]),
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
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  const definition = definitions?.definitions[0];
  if (definition === undefined) {
    throw new Error("E01-B physical definition is missing.");
  }
  const input = physicalInput(
    fixture,
    publication,
    definition.edge.edgeDefinitionId,
  );
  await advancePhysicalUntilEnabled(fixture, input);
  return definition.edge.edgeDefinitionId;
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
