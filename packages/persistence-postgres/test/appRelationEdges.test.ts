import { webcrypto } from "node:crypto";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { asc, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogRelationId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import type { PhysicalEdgeDefinitionV1 } from
  "flarex-protocol/internal/application-schema-binding";
import {
  decodeRelationDeclarationV1Result,
  type RelationDeclarationV1,
} from "flarex-protocol/internal/relation-declaration-v1";
import {
  canonicalizeRelationOccurrenceV1,
  decodeRelationOccurrenceV1Result,
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Error,
  type RelationOccurrenceV1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  AppRelationEdgeConflictError,
  AppRelationEdgeCorruptionError,
  AppRelationEdgeInputError,
  AppRelationEdgeOccurrenceCollisionError,
  AppRelationEdgePersistenceError,
  applyAppRelationEdgeChangesInTransactionEffect,
  readAppRelationEdgeAdjacencyVersionInTransactionEffect,
  readIncomingAppRelationEdgePageInTransactionEffect,
  type AppRelationEdgeDefinitionPin,
  type AppRelationEdgeMutationOptions,
  type AppRelationEdgeMutationStatementName,
  type AppRelationEdgeStorageAction,
} from "../src/appRelationEdges";
import { makePhysicalEdgeDefinition } from
  "../src/applicationRelationBinding/Policy";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxSystemScopeClocks,
} from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const scopeId = ScopeIdSchema.make(
  "scope_5a000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_5a000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_5a000000-0000-0000-0000-000000000002",
);
const otherEpoch = ScopeEpochSchema.make(
  "epoch_5a000000-0000-0000-0000-000000000098",
);
const sourceTableId = decodeCatalogTableId(11);
const targetTableId = decodeCatalogTableId(12);
const relationId = decodeCatalogRelationId(21);
const edgeDefinitionId = decodeCatalogEdgeDefinitionId(31);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_edges");
const sourceA = decodeAppRowIdHexV1("5a00000000000000000000000000000a");
const sourceB = decodeAppRowIdHexV1("5a00000000000000000000000000000b");
const targetA = decodeAppRowIdHexV1("5a00000000000000000000000000001a");
const targetB = decodeAppRowIdHexV1("5a00000000000000000000000000001b");
const definition = definitionPin(false);

describe("S12 app relation-edge storage", () => {
  it("puts, reorders, removes, retargets, and coalesces endpoint versions", async () => {
    const persistence = await edgePersistence();
    const first = await apply(persistence, scopeId, 1n, [
      put(definition, occurrence(sourceA, targetA), 0),
      put(definition, occurrence(sourceA, targetB), 1),
    ]);
    expect(first).toEqual({
      putCount: 2,
      removeCount: 0,
      reorderCount: 0,
      advancedEndpointCount: 3,
    });

    const reordered = await apply(persistence, scopeId, 2n, [
      reorder(definition, occurrence(sourceA, targetA), 1),
      reorder(definition, occurrence(sourceA, targetB), 0),
    ]);
    expect(reordered.advancedEndpointCount).toBe(3);
    const ordered = await persistence.drizzle.select({
      targetRowId: fxAppEdgeCurrent.targetRowId,
      position: fxAppEdgeCurrent.position,
      commitSeq: fxAppEdgeCurrent.commitSeq,
    }).from(fxAppEdgeCurrent).orderBy(asc(fxAppEdgeCurrent.position));
    expect(ordered.map((row) => row.position)).toEqual([0, 1]);
    expect(ordered.every((row) => row.commitSeq === 2n)).toBe(true);

    const staleRemove = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(1n),
        actions: [remove(definition, occurrence(sourceA, targetA))],
      }))
    );
    expect(staleRemove).toBeInstanceOf(AppRelationEdgeConflictError);

    const retargeted = await apply(persistence, scopeId, 3n, [
      remove(definition, occurrence(sourceA, targetA)),
      put(definition, occurrence(sourceB, targetA), 0),
    ]);
    expect(retargeted).toEqual({
      putCount: 1,
      removeCount: 1,
      reorderCount: 0,
      advancedEndpointCount: 3,
    });
    expect(await version(persistence, scopeId, "outgoing", sourceA)).toBe(3n);
    expect(await version(persistence, scopeId, "outgoing", sourceB)).toBe(3n);
    expect(await version(persistence, scopeId, "incoming", targetA)).toBe(3n);

    await apply(persistence, scopeId, 4n, [
      remove(definition, occurrence(sourceA, targetB)),
    ]);
    const remaining = await persistence.drizzle.select({
      sourceRowId: fxAppEdgeCurrent.sourceRowId,
    }).from(fxAppEdgeCurrent);
    expect(remaining).toHaveLength(1);
    expect(await version(persistence, scopeId, "outgoing", sourceA)).toBe(4n);
  });

  it("keeps physical definitions and scopes isolated", async () => {
    const persistence = await edgePersistence();
    const replacement = definitionPin(false, 32);
    await apply(persistence, scopeId, 1n, [
      put(definition, occurrence(sourceA, targetA), 0),
      put(replacement, occurrence(sourceA, targetA), 0),
    ]);
    await apply(persistence, otherScopeId, 1n, [
      put(definition, occurrence(sourceA, targetA), 0),
    ]);
    const rows = await persistence.drizzle.select({
      edgeDefinitionId: fxAppEdgeCurrent.edgeDefinitionId,
      scopeUuid: fxAppEdgeCurrent.scopeUuid,
    }).from(fxAppEdgeCurrent);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.edgeDefinitionId)).size).toBe(2);
    expect(new Set(rows.map((row) => row.scopeUuid)).size).toBe(2);

    const scalar = definitionPin(true, 33);
    await apply(persistence, scopeId, 2n, [
      put(scalar, occurrence(sourceB, targetB), null),
    ]);
    const invalidScalarPosition = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(3n),
        actions: [reorder(scalar, occurrence(sourceB, targetB), 0)],
      }))
    );
    expect(invalidScalarPosition).toBeInstanceOf(AppRelationEdgeInputError);
  });

  it("fails closed on duplicate identity and retained digest collision", async () => {
    const persistence = await edgePersistence();
    const duplicateBatch = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(1n),
        actions: [
          put(definition, occurrence(sourceA, targetA), 0),
          put(definition, occurrence(sourceA, targetA), 1),
        ],
      }))
    );
    expect(duplicateBatch).toBeInstanceOf(AppRelationEdgeInputError);
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toEqual([]);

    await apply(persistence, scopeId, 1n, [
      put(definition, occurrence(sourceA, targetA), 0),
    ]);
    const duplicate = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(2n),
        actions: [put(definition, occurrence(sourceA, targetA), 0)],
      }))
    );
    expect(duplicate).toBeInstanceOf(AppRelationEdgeConflictError);

    await persistence.drizzle.delete(fxAppEdgeCurrent);
    await persistence.drizzle.delete(fxAppEdgeAdjacencyVersions);
    const wanted = await canonical(occurrence(sourceA, targetA));
    const conflicting = await canonical(occurrence(sourceB, targetA));
    await persistence.drizzle.insert(fxAppEdgeCurrent).values({
      scopeUuid: projectScopeIdUuidV1(scopeId).scopeUuid,
      relationId,
      edgeDefinitionId,
      sourceTableId,
      sourceRowId: rowBytes(sourceB),
      targetTableId,
      targetRowId: rowBytes(targetA),
      duplicateOrdinal: 0,
      occurrenceCodecVersion: 1,
      occurrenceBytes: conflicting.canonicalBytes,
      occurrenceSha256: wanted.sha256,
      locale: null,
      position: 0,
      schemaVersionId,
      writeEpochUuid: projectScopeEpochUuidV1(epoch).epochUuid,
      commitSeq: CommitSeqSchema.make(1n),
    });
    const collision = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(2n),
        actions: [put(definition, occurrence(sourceA, targetA), 0)],
      }))
    );
    expect(collision).toBeInstanceOf(
      AppRelationEdgeOccurrenceCollisionError,
    );
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toHaveLength(1);
  });

  it("classifies incoherent retained evidence as corruption", async () => {
    const persistence = await edgePersistence();
    await apply(persistence, scopeId, 1n, [
      put(definition, occurrence(sourceA, targetA), 0),
    ]);
    await persistence.query(`
      update fx_app_edge_current
      set occurrence_bytes = convert_to('corrupt-edge-evidence', 'UTF8'),
          occurrence_sha256 = decode(repeat('ab', 32), 'hex')
    `);
    const failure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(2n),
        actions: [remove(definition, occurrence(sourceA, targetA))],
      }))
    );
    expect(failure).toBeInstanceOf(AppRelationEdgeCorruptionError);
  });

  it("uses bounded statement batches across reads, writes, and versions", async () => {
    const persistence = await edgePersistence();
    const actions = Array.from({ length: 513 }, (_, index) => {
      const source = decodeAppRowIdHexV1(
        (10_000 + index).toString(16).padStart(32, "0"),
      );
      return put(definition, occurrence(source, targetA), index % 1024);
    });
    const putStatements: AppRelationEdgeMutationStatementName[] = [];
    expect(await apply(persistence, scopeId, 1n, actions, {
      observeStatement: (statement) => putStatements.push(statement),
    })).toEqual({
      putCount: 513,
      removeCount: 0,
      reorderCount: 0,
      advancedEndpointCount: 514,
    });
    expect(putStatements).toEqual([
      "createMutationSavepoint",
      "lockScopeClock",
      "readCurrentBatch",
      "readCurrentBatch",
      "readCurrentBatch",
      "readAffectedVersions",
      "readAffectedVersions",
      "readAffectedVersions",
      "insertCurrent",
      "insertCurrent",
      "advanceAdjacencyVersions",
      "advanceAdjacencyVersions",
      "releaseMutationSavepoint",
    ]);
    const reordered = actions.map((action, index) => reorder(
      action.definition,
      action.occurrence,
      (512 - index) % 1024,
    ));
    expect((await apply(persistence, scopeId, 2n, reordered)).reorderCount)
      .toBe(513);
    const removed = actions.map((action) =>
      remove(action.definition, action.occurrence)
    );
    expect((await apply(persistence, scopeId, 3n, removed)).removeCount)
      .toBe(513);
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toEqual([]);
    expect(
      await persistence.drizzle.select().from(fxAppEdgeAdjacencyVersions),
    ).toHaveLength(514);
  }, 120_000);

  it("rejects the 4,097th action before any SQL", async () => {
    const persistence = await edgePersistence();
    const actions = Array.from({ length: 4_097 }, (_, index) => {
      const source = decodeAppRowIdHexV1(
        (30_000 + index).toString(16).padStart(32, "0"),
      );
      return put(definition, occurrence(source, targetA), index % 1024);
    });
    const statements: AppRelationEdgeMutationStatementName[] = [];
    const failure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(
        tx,
        {
          scopeId,
          schemaVersionId,
          commitSeq: CommitSeqSchema.make(1n),
          actions,
        },
        { observeStatement: (statement) => statements.push(statement) },
      ))
    );
    expect(failure).toMatchObject({
      _tag: "AppRelationEdgeInputError",
      reason: "transactionOccurrenceLimitExceeded",
    });
    expect(statements).toEqual([]);
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toEqual([]);
  });

  it("rejects a current-edge change behind an affected endpoint version", async () => {
    const persistence = await edgePersistence();
    await apply(persistence, scopeId, 5n, [
      put(definition, occurrence(sourceA, targetA), 0),
    ]);
    const failure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(4n),
        actions: [put(definition, occurrence(sourceB, targetA), 1)],
      }))
    );
    expect(failure).toMatchObject({
      _tag: "AppRelationEdgeConflictError",
      reason: "staleAdjacencyVersion",
    });
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toHaveLength(1);
    expect(await version(persistence, scopeId, "incoming", targetA)).toBe(5n);
  });

  it("rejects stored positions that disagree with the physical definition", async () => {
    const persistence = await edgePersistence();
    const scalar = definitionPin(true, 33);
    await apply(persistence, scopeId, 1n, [
      put(scalar, occurrence(sourceB, targetB), null),
    ]);
    await persistence.drizzle.update(fxAppEdgeCurrent).set({ position: 0 });
    const mutationFailure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(2n),
        actions: [remove(scalar, occurrence(sourceB, targetB))],
      }))
    );
    expect(mutationFailure).toBeInstanceOf(AppRelationEdgeCorruptionError);
    const pageFailure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(readIncomingAppRelationEdgePageInTransactionEffect(tx, {
        scopeId,
        definition: scalar,
        targetRowId: targetB,
        maximumIdentities: 128,
      }))
    );
    expect(pageFailure).toBeInstanceOf(AppRelationEdgeCorruptionError);
  });

  it("reads at most 128 incoming identities with one-row lookahead", async () => {
    const persistence = await edgePersistence();
    const actions: AppRelationEdgeStorageAction[] = [];
    for (let index = 1; index <= 130; index += 1) {
      const source = decodeAppRowIdHexV1(index.toString(16).padStart(32, "0"));
      actions.push(put(definition, occurrence(source, targetA), 0));
    }
    await apply(persistence, scopeId, 9n, actions);
    const first = await page(persistence, undefined);
    expect(first.items).toHaveLength(128);
    expect(first.exhausted).toBe(false);
    expect(first.nextFrontier).not.toBeNull();
    expect(first.versionBefore).toBe(9n);
    expect(first.versionAfter).toBe(9n);
    const second = await page(persistence, first.nextFrontier ?? undefined);
    expect(second.items).toHaveLength(2);
    expect(second.exhausted).toBe(true);
    expect(second.nextFrontier).toBeNull();
  });

  it("rolls current edges and endpoint versions back with the caller transaction", async () => {
    const persistence = await edgePersistence();
    await expect(persistence.drizzle.transaction(async (tx) => {
      await runEdge(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(1n),
        actions: [put(definition, occurrence(sourceA, targetA), 0)],
      }));
      throw new Error("injected S12 rollback");
    })).rejects.toThrow("injected S12 rollback");
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toEqual([]);
    expect(
      await persistence.drizzle.select().from(fxAppEdgeAdjacencyVersions),
    ).toEqual([]);
  });

  it("keeps a captured mixed-action failure atomic", async () => {
    const persistence = await edgePersistence();
    const failure = await persistence.drizzle.transaction((tx) =>
      runEdgeFailure(applyAppRelationEdgeChangesInTransactionEffect(tx, {
        scopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(1n),
        actions: [
          put(definition, occurrence(sourceA, targetA), 0),
          remove(definition, occurrence(sourceB, targetB)),
        ],
      }))
    );
    expect(failure).toBeInstanceOf(AppRelationEdgeConflictError);
    expect(await persistence.drizzle.select().from(fxAppEdgeCurrent)).toEqual([]);
    expect(
      await persistence.drizzle.select().from(fxAppEdgeAdjacencyVersions),
    ).toEqual([]);
  });

  it("preserves the original failure when savepoint cleanup also fails", async () => {
    const persistence = await edgePersistence();
    const cleanupDefect = new Error("injected savepoint cleanup failure");
    const exit = await persistence.drizzle.transaction((tx) => runEdgeExit(
      applyAppRelationEdgeChangesInTransactionEffect(
        tx,
        {
          scopeId,
          schemaVersionId,
          commitSeq: CommitSeqSchema.make(1n),
          actions: [remove(definition, occurrence(sourceA, targetA))],
        },
        {
          observeStatement: (statement) => {
            if (statement === "rollbackMutationSavepoint") {
              throw cleanupDefect;
            }
          },
        },
      ),
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected the S12 mutation and cleanup to fail");
    }
    expect(Result.getOrThrow(Cause.findError(exit.cause))).toMatchObject({
      _tag: "AppRelationEdgeConflictError",
      reason: "missingOccurrence",
    });
    expect(Result.getOrThrow(Cause.findDie(exit.cause)).defect)
      .toBe(cleanupDefect);
  });

  it("restores transaction usability after a late persistence failure", async () => {
    const persistence = await edgePersistence();
    await persistence.query(`
      create function reject_edge_version_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'injected edge-version failure';
      end
      $$
    `);
    await persistence.query(`
      create trigger reject_edge_version_insert
      before insert on fx_app_edge_adjacency_version
      for each statement execute function reject_edge_version_insert()
    `);
    const captured = await persistence.drizzle.transaction(async (tx) => {
      await tx.update(fxSystemScopeClocks).set({
        lastCommitSeq: CommitSeqSchema.make(101n),
      }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
      const failure = await runEdgeFailure(
        applyAppRelationEdgeChangesInTransactionEffect(tx, {
          scopeId,
          schemaVersionId,
          commitSeq: CommitSeqSchema.make(1n),
          actions: [put(definition, occurrence(sourceA, targetA), 0)],
        }),
      );
      const currentRows = await tx.select().from(fxAppEdgeCurrent);
      const versionRows = await tx.select().from(fxAppEdgeAdjacencyVersions);
      const clockRows = await tx.select({
        lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
      }).from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        scopeId,
      ));
      return { failure, currentRows, versionRows, clockRows };
    });
    expect(captured.failure).toBeInstanceOf(AppRelationEdgePersistenceError);
    expect(captured.currentRows).toEqual([]);
    expect(captured.versionRows).toEqual([]);
    expect(captured.clockRows).toEqual([{ lastCommitSeq: 101n }]);
    expect(await persistence.drizzle.select({
      lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
    }).from(fxSystemScopeClocks).where(eq(
      fxSystemScopeClocks.scopeId,
      scopeId,
    ))).toEqual([{ lastCommitSeq: 101n }]);
  });
});

async function edgePersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, last_commit_seq, epoch)
     values ($1, 'flarexdb_v1', 100, $2),
            ($3, 'flarexdb_v1', 100, $4)`,
    [scopeId, epoch, otherScopeId, otherEpoch],
  );
  return persistence;
}

function definitionPin(
  scalar: boolean,
  numericEdgeDefinitionId: number = 31,
): AppRelationEdgeDefinitionPin {
  const declaration = relationDeclaration(scalar);
  const physical: PhysicalEdgeDefinitionV1 = makePhysicalEdgeDefinition(
    sourceTableId,
    targetTableId,
    declaration,
  );
  return Object.freeze({
    relationId,
    edgeDefinitionId: decodeCatalogEdgeDefinitionId(numericEdgeDefinitionId),
    physical,
  });
}

function relationDeclaration(scalar: boolean): RelationDeclarationV1 {
  return Result.getOrThrow(decodeRelationDeclarationV1Result({
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: "posts",
      path: [{ kind: "field", name: "authors" }],
      forwardName: "authors",
    },
    target: { table: "users" },
    value: scalar
      ? { cardinality: "one", required: false }
      : {
        cardinality: "many",
        minItems: 0,
        maxItems: 1024,
        ordered: true,
        duplicates: "forbid",
      },
    inverse: { cardinality: "many", name: "posts" },
    localized: false,
    onTargetDelete: "restrict",
  }));
}

function occurrence(
  sourceRowId: typeof sourceA,
  targetRowId: typeof targetA,
): RelationOccurrenceV1 {
  return Result.getOrThrow(decodeRelationOccurrenceV1Result({
    format: "flarex.relation-occurrence",
    version: 1,
    sourceDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: sourceTableId,
      rowId: sourceRowId,
    }),
    sourcePath: [{ kind: "field", name: "authors" }],
    targetDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: targetTableId,
      rowId: targetRowId,
    }),
    duplicateOrdinal: 0,
  }));
}

function put(
  edge: AppRelationEdgeDefinitionPin,
  edgeOccurrence: RelationOccurrenceV1,
  position: number | null,
): AppRelationEdgeStorageAction {
  return { kind: "put", definition: edge, occurrence: edgeOccurrence, position };
}

function reorder(
  edge: AppRelationEdgeDefinitionPin,
  edgeOccurrence: RelationOccurrenceV1,
  position: number | null,
): AppRelationEdgeStorageAction {
  return {
    kind: "reorder",
    definition: edge,
    occurrence: edgeOccurrence,
    position,
  };
}

function remove(
  edge: AppRelationEdgeDefinitionPin,
  edgeOccurrence: RelationOccurrenceV1,
): AppRelationEdgeStorageAction {
  return { kind: "remove", definition: edge, occurrence: edgeOccurrence };
}

function apply(
  persistence: PGliteFlarexPersistence,
  owningScopeId: typeof scopeId,
  commitSeq: bigint,
  actions: ReadonlyArray<AppRelationEdgeStorageAction>,
  options: AppRelationEdgeMutationOptions = {},
) {
  return persistence.drizzle.transaction((tx) => runEdge(
    applyAppRelationEdgeChangesInTransactionEffect(
      tx,
      {
        scopeId: owningScopeId,
        schemaVersionId,
        commitSeq: CommitSeqSchema.make(commitSeq),
        actions,
      },
      options,
    ),
  ));
}

function version(
  persistence: PGliteFlarexPersistence,
  owningScopeId: typeof scopeId,
  direction: "incoming" | "outgoing",
  endpointRowId: typeof sourceA,
) {
  return persistence.drizzle.transaction((tx) => runEffect(
    readAppRelationEdgeAdjacencyVersionInTransactionEffect(tx, {
      scopeId: owningScopeId,
      edgeDefinitionId,
      direction,
      endpointRowId,
    }),
  ));
}

function page(
  persistence: PGliteFlarexPersistence,
  after: Readonly<{ sourceRowId: typeof sourceA; duplicateOrdinal: 0 }> |
    undefined,
) {
  return persistence.drizzle.transaction((tx) => runEffect(
    readIncomingAppRelationEdgePageInTransactionEffect(tx, {
      scopeId,
      definition,
      targetRowId: targetA,
      maximumIdentities: 128,
      ...(after === undefined ? {} : { after }),
    }),
  ));
}

function canonical(input: RelationOccurrenceV1) {
  return runEdge(canonicalizeRelationOccurrenceV1(input));
}

function rowBytes(rowId: typeof sourceA): Uint8Array {
  return appRowIdHexV1ToBytes(rowId);
}

const relationOccurrenceSha256 = RelationOccurrenceSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => new Uint8Array(await webcrypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: (cause) => new RelationOccurrenceSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});

function runEdge<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
): Promise<A> {
  return runEffect(effect.pipe(
    Effect.provideService(RelationOccurrenceSha256, relationOccurrenceSha256),
  ));
}

function runEdgeFailure<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
): Promise<E> {
  return runEffectFailure(effect.pipe(
    Effect.provideService(RelationOccurrenceSha256, relationOccurrenceSha256),
  ));
}

function runEdgeExit<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
) {
  return runEffect(Effect.exit(effect.pipe(
    Effect.provideService(RelationOccurrenceSha256, relationOccurrenceSha256),
  )));
}
