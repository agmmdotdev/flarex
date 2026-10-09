import {
  PointCommitPublicationObservation,
  type PointCommitPublicationEvent,
} from "../../../src/commit/point/observation";
import { conditionalUniqueSpec } from "../../storage/unique/conditionalUniqueTestSupport";
import { readOrderedMembershipStorage } from "../../storage/indexes/orderedMembershipStorageScenario";
import { canonicalizeAppUniqueKeyV1Result } from "../../../src/storage/unique/appUniqueKeyContract";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import { ExecutionDiagnostics } from "../../../src/execution/diagnostics/operation";
import { and, eq, getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxSystemIndexBuildStates,
  fxAppRowRevisions,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxAppUniqueKeys,
} from "../../../src/database/schema";
import { Effect, Result } from "effect";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  encodeAppOrderedIndexKeyV1,
  ORDERED_INDEX_MISSING_V1,
  orderedIndexCreationTimeV1,
  orderedIndexValueFromFlarexValueV1,
} from "flarex-protocol/ordered-index";
import { expect, it } from "vitest";
import { buildAppDeveloperOrderedIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { AppUniqueKeyConflictError } from "../../../src/storage/unique/appUniqueKeyErrors";
import {
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
} from "../../../src/commit/point/errors";
import { createPostgresLocatedIndexBuildReconciliationTargetV1 } from "../../../src/database/postgres";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";
import {
  withPostgresPersistence,
  uuidFactory,
  createScope,
  prepareUniqueConstraintForPostgres,
  createAttempt,
  createPublisher,
  uniqueKeyState,
  durableState,
  enableIntrinsicIndexForPostgres,
  intrinsicIndexState,
  compareIntrinsicIndexRows,
  prepareDeveloperIndexForPostgres,
  createIndexedAttempt,
  createPort,
  developerIndexState,
  developerIndexBuildCursor,
  setValidatingUniqueSetBuild,
  uniqueSetBuildCursors,
  pointRowIdHex,
  describePostgres,
} from "./support/postgresFixture";
import { installedPublicationDiagnostics } from "./support/postgresDiagnostics";
import {
  withMaterializationDmlTrigger,
  withMaterializationDmlCounter,
  deferredSignal,
  waitForBlockedPointCommit,
} from "./support/postgresFaults";

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("batches CE1 unique ownership through the native publisher", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96419300");
      for (const rowCount of [1, 32, 33, 128]) {
        const scope = await createScope(persistence, randomUuid, `ce1_unique_${rowCount}`);
        const unique = await prepareUniqueConstraintForPostgres(persistence, scope);
        const inserted = await createAttempt(persistence, randomUuid, scope, "ce1_unique_insert", rowCount);
        const events: PointCommitPublicationEvent[] = [];
        const observation = new PointCommitPublicationObservation({ detail: true, record: event => events.push(event) });
        const measured = await withPostgresExecutionObservation(persistence.pool, async markPhase =>
          runEffect(createPublisher(persistence, {
            ...unique,
            publicationObservation: observation,
          }).publish(inserted.publicationCommand).pipe(
            Effect.provideService(ExecutionDiagnostics, installedPublicationDiagnostics(markPhase)))),
        );
        expect(measured.value).toMatchObject({ kind: "published" });
        // Driver calls are the two installed stages; their nested native DML
        // remains proved by actual claim counts and bounded storage witnesses.
        expect(measured.observation.familyQueries.fx_accept_app_publication).toBe(1);
        expect(measured.observation.familyQueries.fx_apply_app_publication).toBe(1);
        expect(events.filter(event => event.kind === "batch" && event.owner === "uniqueClaims")
          .reduce((count, event) => count + (event.kind === "batch" ? event.counts.rows ?? 0 : 0), 0)).toBe(rowCount);
        expect(events.filter(event => event.kind === "batch" && event.owner === "uniqueReleases")).toEqual([]);
        observation.assertHealthy();
        const claims = await persistence.query("select row_id from fx_app_unique_key where scope_uuid = $1", [inserted.command.sealIdentity.scopeUuid]);
        expect(claims.rows).toHaveLength(rowCount);
        if (rowCount === 128) {
          // All existing owners must be authenticated across read batches; every
          // changed key releases and acquires a claim (256 actions, one commit).
          const beforeKeys = await uniqueKeyState(persistence, inserted.command.sealIdentity.scopeUuid);
          const documentIds = inserted.command.rowIntents.map(intent => intent.documentId);
          const expectedKeys = documentIds.map((documentId, index) => {
            const key = Result.getOrThrow(canonicalizeAppUniqueKeyV1Result({ sparse: false, localeKey: null,
              values: [orderedIndexValueFromFlarexValueV1(`ce1_unique_move_name_${index}`)] }));
            if (key.kind !== "claim") throw new Error("Expected canonical replacement key");
            return { rowIdHex: decodeAppDocumentIdentityV1(documentId).rowId, encodedKeyHex: key.encodedKey };
          }).sort((left, right) => left.rowIdHex.localeCompare(right.rowIdHex));
          const moved = await createAttempt(persistence, randomUuid, scope, "ce1_unique_move", { kind: "bulkPatch", documentIds });
          expect(await runEffect(createPublisher(persistence, unique).publish(moved.publicationCommand)))
            .toMatchObject({ kind: "published" });
          const updated = await uniqueKeyState(persistence, inserted.command.sealIdentity.scopeUuid);
          expect(updated.map(({ rowIdHex, encodedKeyHex }) => ({ rowIdHex, encodedKeyHex }))
            .sort((left, right) => left.rowIdHex.localeCompare(right.rowIdHex))).toEqual(expectedKeys);
          const previousKeys = new Set(beforeKeys.map(row => row.encodedKeyHex));
          expect(updated.every(row => !previousKeys.has(row.encodedKeyHex))).toBe(true);
          expect(await durableState(persistence, inserted.command.sealIdentity.scopeUuid))
            .toMatchObject({ revisions: "256", commit_headers: "2", outcomes: "2", last_commit_seq: "2" });
        }
      }
    });
  }, 120_000);

  it("counts every unique constraint against the shared transition budget", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96419310");
      for (const rowCount of [64, 65]) {
        const scope = await createScope(persistence, randomUuid, `unique_fanout_${rowCount}`);
        const unique = await prepareUniqueConstraintForPostgres(persistence, scope, undefined, ["unique_name", "unique_name_second"]);
        const inserted = await createAttempt(persistence, randomUuid, scope, `unique_fanout_insert_${rowCount}`, rowCount);
        if (rowCount === 64) {
          expect(await runEffect(createPublisher(persistence, unique).publish(inserted.publicationCommand)))
            .toMatchObject({ kind: "published" });
          const claims = await persistence.query("select row_id from fx_app_unique_key where scope_uuid = $1", [inserted.command.sealIdentity.scopeUuid]);
          expect(claims.rows).toHaveLength(128);
        } else {
          expect(await runFailure(createPublisher(persistence, unique).publish(inserted.publicationCommand)))
            .toMatchObject({ reason: "mutationLimitExceeded", observed: 130, maximum: 128 });
          expect(await durableState(persistence, inserted.command.sealIdentity.scopeUuid))
            .toMatchObject({ revisions: "0", current_rows: "0", commit_headers: "0", outcomes: "0", last_commit_seq: "0" });
          const claims = await persistence.query("select row_id from fx_app_unique_key where scope_uuid = $1", [inserted.command.sealIdentity.scopeUuid]);
          expect(claims.rows).toHaveLength(0);
        }
      }
    });
  }, 120_000);

  it("batches CE1 intrinsic membership preparation and rejects late corruption before row writes", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419000");
      for (const rowCount of [1, 32, 33, 128]) {
        const scope = await createScope(
          persistence,
          randomUuid,
          `ce1_intrinsic_${rowCount}`,
        );
        const intrinsic = await enableIntrinsicIndexForPostgres(
          persistence,
          scope,
        );
        const inserted = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "ce1_insert",
          rowCount,
        );
        const events: PointCommitPublicationEvent[] = [];
        const observation = new PointCommitPublicationObservation({ detail: true, record: event => events.push(event) });
        const measured = await withPostgresExecutionObservation(
          persistence.pool,
          async (markPhase) => {
            return runEffect(
              createPublisher(persistence, {
                ...intrinsic,
                publicationObservation: observation,
              }).publish(inserted.publicationCommand).pipe(
                Effect.provideService(ExecutionDiagnostics, installedPublicationDiagnostics(markPhase))),
            );
          },
        );
        expect(measured.value).toMatchObject({ kind: "published" });
        expect(measured.observation.familyQueries.fx_accept_app_publication).toBe(1);
        expect(measured.observation.familyQueries.fx_apply_app_publication).toBe(1);
        for (const owner of ["rowRevisions", "indexRevisions"] as const)
          expect(events.filter(event => (event.kind === "batch" || event.kind === "counts") && event.owner === owner)
            .reduce((count, event) => count + (event.kind === "batch" || event.kind === "counts" ? event.counts.rows ?? 0 : 0), 0)).toBe(rowCount);
        observation.assertHealthy();
        expect(
          (
            await intrinsicIndexState(
              persistence,
              inserted.command.sealIdentity.scopeUuid,
            )
          ).current,
        ).toHaveLength(rowCount);
        if (rowCount !== 33) continue;
        const changed = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "ce1_update",
          {
            kind: "bulkPatch",
            documentIds: inserted.command.rowIntents.map(
              (intent) => intent.documentId,
            ),
          },
        );
        const last = changed.command.rowIntents.at(-1);
        if (last === undefined) throw new Error("Missing last CE1 row.");
        const scopeUuid = inserted.command.sealIdentity.scopeUuid;
        // Damage only the final requested position, across the 32-key boundary.
        await persistence.query(
          "update fx_app_index_entry_rev set key_sha256=$3 where scope_uuid=$1 and row_id=$2",
          [scopeUuid, Buffer.from(last.rowId, "hex"), new Uint8Array(32)],
        );
        const before = await durableState(persistence, scopeUuid);
        await withMaterializationDmlTrigger(persistence, "intrinsic_precedes_rows", fxAppRowRevisions, "before insert",
          `if NEW."${fxAppRowRevisions.scopeUuid.name}"='${scopeUuid}'::uuid then
            raise exception 'Row DML reached before prior intrinsic corruption refusal'; end if;`, async () => {
            expect(await runFailure(createPublisher(persistence, intrinsic).publish(changed.publicationCommand)))
              .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
          });
        expect(await durableState(persistence, scopeUuid)).toEqual(before);
      }
    });
  }, 180_000);

  it("prepares CE1 intrinsic memberships across logical tables and permits no-index composition", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419100");
      for (const indexed of [false, true]) {
        const scope = await createScope(
          persistence,
          randomUuid,
          `ce1_tables_${indexed}`,
          false,
          ["users", "tasks"],
        );
        const options = indexed
          ? await enableIntrinsicIndexForPostgres(persistence, scope)
          : {};
        const buildState = () => persistence.drizzle.select({ indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
          lifecycle: fxSystemIndexBuildStates.lifecycle, coveredThroughCommitSeq: fxSystemIndexBuildStates.coveredThroughCommitSeq })
          .from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, scope.scopeId))
          .orderBy(fxSystemIndexBuildStates.indexDefinitionId);
        expect(await buildState()).toEqual(indexed ? [
          { indexDefinitionId: decodeCatalogIndexDefinitionId(1), lifecycle: "enabled", coveredThroughCommitSeq: 0n },
          { indexDefinitionId: decodeCatalogIndexDefinitionId(2), lifecycle: "declared", coveredThroughCommitSeq: null },
        ] : []);
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          `ce1_table_insert_${indexed}`,
          {
            kind: "insertTables",
            tables: ["users", "tasks", "users", "tasks"],
          },
        );
        const events: PointCommitPublicationEvent[] = [];
        const observation = new PointCommitPublicationObservation({ detail: true, record: event => events.push(event) });
        const measured = await withPostgresExecutionObservation(
          persistence.pool,
          async (markPhase) =>
            runEffect(
              createPublisher(persistence, {
                ...options,
                publicationObservation: observation,
              }).publish(attempt.publicationCommand).pipe(
                Effect.provideService(ExecutionDiagnostics, installedPublicationDiagnostics(markPhase))),
            ),
        );
        expect(measured.value).toMatchObject({ kind: "published" });
        expect(
          new Set(attempt.command.rowIntents.map((row) => row.tableId)).size,
        ).toBe(2);
        expect(
          (
            await durableState(
              persistence,
              attempt.command.sealIdentity.scopeUuid,
            )
          ).current_rows,
        ).toBe("4");
        const index = await intrinsicIndexState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        );
        expect(index.current.map((row) => row.tableId).sort()).toEqual(
          indexed ? ["1", "1", "2", "2"] : [],
        );
        expect(measured.observation.familyQueries.fx_accept_app_publication).toBe(1);
        expect(measured.observation.familyQueries.fx_apply_app_publication).toBe(1);
        for (const [owner, expected] of [["rowRevisions", 4], ["indexRevisions", indexed ? 4 : 0],
          ["indexCoverage", indexed ? 1 : 0]] as const)
          expect(events.filter(event => (event.kind === "batch" || event.kind === "counts") && event.owner === owner)
            .reduce((count, event) => count + (event.kind === "batch" || event.kind === "counts" ? event.counts.rows ?? 0 : 0), 0)).toBe(expected);
        observation.assertHealthy();
        expect(await buildState()).toEqual(indexed ? [
          { indexDefinitionId: decodeCatalogIndexDefinitionId(1), lifecycle: "enabled", coveredThroughCommitSeq: 1n },
          { indexDefinitionId: decodeCatalogIndexDefinitionId(2), lifecycle: "declared", coveredThroughCommitSeq: null },
        ] : []);
      }
    });
  }, 120_000);

  it("publishes mixed multi-row sidecars and rolls every row back on failure", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96410000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_multi_row",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_multi_row",
        "mixed",
      );
      expect(attempt.command.rowIntents).toHaveLength(2);
      const deletedIntent = attempt.command.rowIntents.find(
        (intent) => intent.kind === "deleted",
      );
      const liveIntent = attempt.command.rowIntents.find(
        (intent) => intent.kind === "live",
      );
      if (deletedIntent === undefined || liveIntent === undefined) {
        throw new Error("Expected PostgreSQL O09-A mixed row intents.");
      }
      const intrinsicOptions = await enableIntrinsicIndexForPostgres(
        persistence,
        scope,
      );
      const beforeSidecars = await intrinsicIndexState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      expect(beforeSidecars).toEqual({
        revisions: [
          {
            tableId: "1",
            rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
            commitSeq: "1",
            isTombstone: false,
          },
        ],
        current: [
          {
            tableId: "1",
            rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
            commitSeq: "1",
          },
        ],
      });
      await withMaterializationDmlCounter(persistence, attempt.command.sealIdentity.scopeUuid, "mixed_intrinsic_rollback", async countWrites => {
        const fault = new PointCommitCorruptionV1Error({ reason: "publicationInvariantInvalid" });
        const failure = await runFailure(createPublisher(persistence, {
          ...intrinsicOptions, afterTransactionStep: async event => { if (event.step === "commitHeaderWritten") throw fault; },
        }).publish(attempt.publicationCommand));
        expect(failure).toBe(fault);
        expect(await countWrites()).toBe(2);
      }, () => "", "after insert or delete", fxAppIndexEntryRevisions);
      expect(
        await intrinsicIndexState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeSidecars);
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "1",
      });

      await expect(
        runEffect(
          createPublisher(persistence, intrinsicOptions).publish(
            attempt.publicationCommand,
          ),
        ),
      ).resolves.toMatchObject({
        kind: "published",
        token: { commitSeq: 2n },
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "3",
        current_rows: "2",
        commit_headers: "1",
        commit_changes: "2",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "2",
      });
      expect(
        await intrinsicIndexState(
          persistence,
          attempt.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: [
          {
            tableId: "1",
            rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
            commitSeq: "1",
            isTombstone: false,
          },
          {
            tableId: "1",
            rowIdHex: deletedIntent.rowId.replaceAll("-", ""),
            commitSeq: "2",
            isTombstone: true,
          },
          {
            tableId: "1",
            rowIdHex: liveIntent.rowId.replaceAll("-", ""),
            commitSeq: "2",
            isTombstone: false,
          },
        ].sort(compareIntrinsicIndexRows),
        current: [
          {
            tableId: "1",
            rowIdHex: liveIntent.rowId.replaceAll("-", ""),
            commitSeq: "2",
          },
        ],
      });
      const changes = await persistence.query<{
        change_ordinal: number;
        row_id_hex: string;
      }>(
        `
          select change_ordinal, encode(row_id, 'hex') as row_id_hex
          from fx_system_commit_app_row_change
          where scope_uuid = $1
          order by change_ordinal
        `,
        [attempt.command.sealIdentity.scopeUuid],
      );
      expect(changes.rows).toEqual(
        attempt.command.rowIntents.map((intent, changeOrdinal) => ({
          change_ordinal: changeOrdinal,
          row_id_hex: intent.rowId.replaceAll("-", ""),
        })),
      );
    });
  }, 120_000);

  it("retains both index tuples on a body update and conflicts through the returned-row dependency", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418100");
      const scope = await createScope(
        persistence,
        randomUuid,
        "membership_body",
        true,
      );
      const options = {
        ...(await prepareDeveloperIndexForPostgres(persistence, scope)),
        ...(await enableIntrinsicIndexForPostgres(persistence, scope)),
      };
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "membership_insert",
      );
      await runEffect(
        createPublisher(persistence, options).publish(
          inserted.publicationCommand,
        ),
      );
      const intent = inserted.command.rowIntents[0];
      if (intent?.kind !== "live") throw new Error("Expected inserted row.");
      const reader = await createIndexedAttempt(
        persistence,
        randomUuid,
        scope,
        "membership_reader",
      );
      expect(reader.command.rowIntents).toEqual([]);
      expect(reader.command.dependencies).toHaveLength(1);
      expect(reader.command.dependencies[0]?.dependency.observed).toMatchObject(
        { kind: "present", revisionCommitSeq: 1n },
      );
      expect(reader.command.indexRangeDependencies).toHaveLength(1);
      const before = await readOrderedMembershipStorage(
        persistence.drizzle,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(before.current).toHaveLength(2);
      const changed = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "membership_body_change",
        {
          kind: "patch",
          documentId: intent.documentId,
          patch: { category: "updated-body" },
        },
      );
      const refuseIndexDml = (target: typeof fxAppIndexEntryRevisions | typeof fxAppIndexEntryCurrent) =>
        `if (TG_OP='DELETE' and OLD."${target.scopeUuid.name}"='${inserted.command.sealIdentity.scopeUuid}'::uuid) or
          (TG_OP<>'DELETE' and NEW."${target.scopeUuid.name}"='${inserted.command.sealIdentity.scopeUuid}'::uuid) then
          raise exception 'Body-only update attempted membership DML'; end if;`;
      await withMaterializationDmlTrigger(persistence, "body_only_no_index_revision", fxAppIndexEntryRevisions,
        "before insert or update or delete", refuseIndexDml(fxAppIndexEntryRevisions), () =>
        withMaterializationDmlTrigger(persistence, "body_only_no_index_current", fxAppIndexEntryCurrent,
          "before insert or update or delete", refuseIndexDml(fxAppIndexEntryCurrent), async () => {
          await runEffect(createPublisher(persistence, options).publish(changed.publicationCommand));
        }));
      expect(
        await readOrderedMembershipStorage(
          persistence.drizzle,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(before);
      const conflict = await runFailure(
        createPort(persistence, options).prove(reader.command),
      );
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      expect(conflict).toMatchObject({
        conflict: { kind: "appRowPoint", documentId: intent.documentId },
      });
      const fresh = await createIndexedAttempt(
        persistence,
        randomUuid,
        scope,
        "membership_fresh",
      );
      expect(fresh.command.dependencies[0]?.dependency.observed).toMatchObject({
        kind: "present",
        revisionCommitSeq: 2n,
      });
      expect(JSON.stringify(fresh.queryResult)).toContain("updated-body");
    });
  }, 120_000);

  it.each([
    "missingPointer",
    "tombstonePointer",
    "keyDigest",
    "physicalSpec",
    "priorDigest",
  ] as const)(
    "fails a body-only update closed on damaged membership: %s",
    async (damage) => {
      await withPostgresPersistence(async (persistence) => {
        const randomUuid = uuidFactory("96418200");
        const scope = await createScope(
          persistence,
          randomUuid,
          `membership_corrupt_${damage}`,
          true,
        );
        const options = {
          ...(await prepareDeveloperIndexForPostgres(persistence, scope)),
          ...(await enableIntrinsicIndexForPostgres(persistence, scope)),
        };
        const inserted = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "membership_corrupt_insert",
        );
        await runEffect(
          createPublisher(persistence, options).publish(
            inserted.publicationCommand,
          ),
        );
        const intent = inserted.command.rowIntents[0];
        if (intent?.kind !== "live") throw new Error("Expected inserted row.");
        const changed = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "membership_corrupt_update",
          {
            kind: "patch",
            documentId: intent.documentId,
            patch: { category: "change" },
          },
        );
        const scopeUuid = inserted.command.sealIdentity.scopeUuid;
        const before = await durableState(persistence, scopeUuid);
        if (damage === "priorDigest")
          await persistence.query("update fx_app_row_rev set value_sha256=$2 where scope_uuid=$1", [scopeUuid, new Uint8Array(32)]);
        if (damage === "missingPointer")
          await persistence.query(
            "delete from fx_app_index_entry_current where scope_uuid=$1",
            [scopeUuid],
          );
        if (damage === "tombstonePointer")
          await persistence.query(
            "update fx_app_index_entry_rev set is_tombstone=true where scope_uuid=$1",
            [scopeUuid],
          );
        if (damage === "keyDigest")
          await persistence.query(
            "update fx_app_index_entry_rev set key_sha256=$2 where scope_uuid=$1",
            [scopeUuid, new Uint8Array(32)],
          );
        if (damage === "physicalSpec")
          await persistence.query(
            "update fx_app_index_entry_rev set physical_spec_sha256=$2 where scope_uuid=$1",
            [scopeUuid, new Uint8Array(32)],
          );
        expect(
          await runFailure(
            createPublisher(persistence, options).publish(
              changed.publicationCommand,
            ),
          ),
        ).toMatchObject(damage === "priorDigest"
          ? { _tag: "PointCommitCorruptionV1Error", reason: "priorDocumentInvalid" }
          : { _tag: "AppIndexEntryStorageCorruptionError" });
        expect(await durableState(persistence, scopeUuid)).toEqual(before);
      });
    },
    120_000,
  );

  it("refuses missing unique bindings before publication and preserves durable replay", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96417100");
      const scope = await createScope(persistence, randomUuid, "exact_unique_selection");
      const options = await prepareUniqueConstraintForPostgres(persistence, scope);
      const publisher = createPublisher(persistence, options);
      const first = await createAttempt(persistence, randomUuid, scope, "exact_unique_first");
      const published = await runEffect(publisher.publish(first.publicationCommand));
      const next = await createAttempt(persistence, randomUuid, scope, "exact_unique_next");
      const scopeUuid = next.command.sealIdentity.scopeUuid;
      const before = await durableState(persistence, scopeUuid);
      const beforeUnique = await uniqueKeyState(persistence, scopeUuid);
      const identity = and(eq(fxControlSchemaVersionUniqueConstraintBindings.deploymentId, scope.deploymentId),
        eq(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId, scope.schemaVersionId));
      const [binding] = await persistence.drizzle.select().from(fxControlSchemaVersionUniqueConstraintBindings).where(identity);
      if (!binding) throw new Error("Missing unique binding before corruption");
      await persistence.drizzle.delete(fxControlSchemaVersionUniqueConstraintBindings).where(identity);
      try {
        expect(await runEffect(publisher.publish(first.publicationCommand))).toMatchObject({
          kind: "replayed", token: published.token,
        });
        expect(await runFailure(publisher.publish(next.publicationCommand))).toMatchObject({
          _tag: "AppUniqueConstraintSetClosureCorruptionV1Error",
        });
        expect(await durableState(persistence, scopeUuid)).toEqual(before);
        expect(await uniqueKeyState(persistence, scopeUuid)).toEqual(beforeUnique);
      } finally {
        await persistence.drizzle.insert(fxControlSchemaVersionUniqueConstraintBindings).values(binding);
      }
      expect(await runEffect(publisher.publish(next.publicationCommand))).toMatchObject({ kind: "published" });
    });
  }, 60_000);

  it("refuses missing developer bindings before publication and preserves durable replay", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96417000");
      const scope = await createScope(persistence, randomUuid, "exact_developer_selection", true);
      const options = await prepareDeveloperIndexForPostgres(persistence, scope);
      const publisher = createPublisher(persistence, options);
      const first = await createAttempt(persistence, randomUuid, scope, "exact_developer_first");
      const published = await runEffect(publisher.publish(first.publicationCommand));
      const next = await createAttempt(persistence, randomUuid, scope, "exact_developer_next");
      const scopeUuid = next.command.sealIdentity.scopeUuid;
      const before = await durableState(persistence, scopeUuid);
      const beforeIndexes = await developerIndexState(persistence, scopeUuid);
      const identity = and(eq(fxControlSchemaVersionIndexBindings.deploymentId, scope.deploymentId),
        eq(fxControlSchemaVersionIndexBindings.schemaVersionId, scope.schemaVersionId));
      const [binding] = await persistence.drizzle.select().from(fxControlSchemaVersionIndexBindings).where(identity);
      if (!binding) throw new Error("Missing developer binding before corruption");
      await persistence.drizzle.delete(fxControlSchemaVersionIndexBindings).where(and(identity,
        eq(fxControlSchemaVersionIndexBindings.logicalIndexId, binding.logicalIndexId)));
      try {
        expect(await runEffect(publisher.publish(first.publicationCommand))).toMatchObject({
          kind: "replayed", token: published.token,
        });
        expect(await runFailure(publisher.publish(next.publicationCommand))).toMatchObject({
          _tag: "IndexBuildReconciliationCatalogV1Error", reason: "publishedProjectionContradictory",
        });
        expect(await durableState(persistence, scopeUuid)).toEqual(before);
        expect(await developerIndexState(persistence, scopeUuid)).toEqual(beforeIndexes);
      } finally {
        await persistence.drizzle.insert(fxControlSchemaVersionIndexBindings).values(binding);
      }
      expect(await runEffect(publisher.publish(next.publicationCommand))).toMatchObject({ kind: "published" });
    });
  }, 60_000);

  it("publishes exact decimal index changes, preserves equivalent keys and rolls invalid writes back", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96419000");
      const scope = await createScope(persistence, randomUuid, "decimal_publication", true, ["users"], true);
      const options = await prepareDeveloperIndexForPostgres(persistence, scope);
      const publisher = createPublisher(persistence, options);
      const inserted = await createAttempt(persistence, randomUuid, scope, "decimal_insert", { kind: "insert", name: "100" });
      expect(await runEffect(publisher.publish(inserted.publicationCommand))).toMatchObject({ kind: "published" });
      const intent = inserted.command.rowIntents[0];
      if (intent?.kind !== "live") throw new Error("Missing decimal insert");
      const second = await createAttempt(persistence, randomUuid, scope, "decimal_second", { kind: "insert", name: "20" });
      await runEffect(publisher.publish(second.publicationCommand));
      const reader = await createIndexedAttempt(persistence, randomUuid, scope, "decimal_read");
      expect(reader.queryResult).toMatchObject({ outcome: { documents: [{ name: "20" }, { name: "100" }] } });
      const before = await developerIndexState(persistence, inserted.command.sealIdentity.scopeUuid);
      const equivalent = await createAttempt(persistence, randomUuid, scope, "decimal_equivalent", { kind: "patch", documentId: intent.documentId, name: "1e2" });
      await runEffect(publisher.publish(equivalent.publicationCommand));
      expect(await developerIndexState(persistence, inserted.command.sealIdentity.scopeUuid)).toEqual(before);
      const invalid = await createAttempt(persistence, randomUuid, scope, "decimal_invalid", { kind: "patch", documentId: intent.documentId, name: "NaN" });
      const durableBefore = await durableState(persistence, inserted.command.sealIdentity.scopeUuid);
      expect(await runFailure(publisher.publish(invalid.publicationCommand))).toMatchObject({ reason: "entryValueInvalid" });
      expect(await durableState(persistence, inserted.command.sealIdentity.scopeUuid)).toEqual(durableBefore);
      expect(await developerIndexState(persistence, inserted.command.sealIdentity.scopeUuid)).toEqual(before);
      const moved = await createAttempt(persistence, randomUuid, scope, "decimal_move", { kind: "patch", documentId: intent.documentId, name: "3" });
      await runEffect(publisher.publish(moved.publicationCommand));
      const after = await createIndexedAttempt(persistence, randomUuid, scope, "decimal_after");
      expect(after.queryResult).toMatchObject({ outcome: { documents: [{ name: "3" }, { name: "20" }] } });
      expect(await runEffect(publisher.publish(moved.publicationCommand))).toMatchObject({ kind: "replayed" });
    });
  }, 180_000);

  it("maintains developer-index key moves and rolls both entry changes back", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_move",
        true,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_insert",
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          inserted.publicationCommand,
        ),
      );
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected a developer-index insert intent.");
      }
      const documentId = insertIntent.documentId;
      const beforeMove = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeMove.revisions).toHaveLength(1);
      expect(beforeMove.current).toHaveLength(1);
      const developerIndexes = developerOptions.developerIndexes;
      if (developerIndexes === undefined) {
        throw new Error("Missing PostgreSQL C08-A definition locator.");
      }
      const definitions = await runEffect(
        developerIndexes.locate({
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: scope.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 256,
        }),
      );
      const definition = definitions?.[0];
      if (definition === undefined) {
        throw new Error("Missing PostgreSQL C08-A developer definition.");
      }
      expect(beforeMove.current[0]?.encodedKeyHex).toBe(
        encodeAppOrderedIndexKeyV1({
          spec: definition.physicalSpec,
          values: Object.freeze([
            orderedIndexValueFromFlarexValueV1("developer_index_insert_0"),
            ORDERED_INDEX_MISSING_V1,
            orderedIndexCreationTimeV1(insertIntent.creationTime),
          ]),
        }),
      );

      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_move",
        { kind: "patch", documentId, name: "moved_name" },
      );
      const beforeMoveDurable = await durableState(persistence, inserted.command.sealIdentity.scopeUuid);
      await withMaterializationDmlCounter(persistence, inserted.command.sealIdentity.scopeUuid, "developer_move_rollback", async countWrites => {
        const fault = new PointCommitCorruptionV1Error({ reason: "publicationInvariantInvalid" });
        const failure = await runFailure(createPublisher(persistence, {
          ...developerOptions, afterTransactionStep: async event => { if (event.step === "commitHeaderWritten") throw fault; },
        }).publish(moved.publicationCommand));
        expect(failure).toBe(fault);
        expect(await countWrites()).toBe(2);
      }, () => "", "after insert or delete", fxAppIndexEntryRevisions);
      expect(await durableState(persistence, inserted.command.sealIdentity.scopeUuid)).toEqual(beforeMoveDurable);
      expect(
        await developerIndexState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeMove);

      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          moved.publicationCommand,
        ),
      );
      const afterMove = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterMove.revisions).toHaveLength(3);
      expect(afterMove.revisions.filter((row) => row.isTombstone)).toHaveLength(
        1,
      );
      expect(afterMove.current).toHaveLength(1);
      expect(afterMove.current[0]?.commitSeq).toBe("2");
      expect(afterMove.current[0]?.encodedKeyHex).not.toBe(
        beforeMove.current[0]?.encodedKeyHex,
      );

      const sameKey = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_same_key",
        {
          kind: "patch",
          documentId,
          patch: { category: "non-indexed-change" },
        },
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          sameKey.publicationCommand,
        ),
      );
      const afterSameKey = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterSameKey).toEqual(afterMove);

      const deleted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_delete",
        { kind: "delete", documentId },
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          deleted.publicationCommand,
        ),
      );
      const afterDelete = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterDelete.revisions).toHaveLength(4);
      expect(
        afterDelete.revisions.filter((row) => row.isTombstone),
      ).toHaveLength(2);
      expect(afterDelete.current).toEqual([]);
    });
  }, 120_000);

  it("resets developer validation behind its cursor and completes exact revalidation", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418200");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_build_validation_reset",
        true,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_first",
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          first.publicationCommand,
        ),
      );
      const firstIntent = first.command.rowIntents[0];
      if (firstIntent?.kind !== "live") {
        throw new Error("Expected first developer validation-reset insert.");
      }
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_second",
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          second.publicationCommand,
        ),
      );

      const developerIndexes = developerOptions.developerIndexes;
      if (developerIndexes === undefined) {
        throw new Error("Missing PostgreSQL developer validation locator.");
      }
      const definitions = await runEffect(
        developerIndexes.locate({
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: scope.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 1,
        }),
      );
      const definition = definitions?.[0];
      if (definitions?.length !== 1 || definition === undefined) {
        throw new Error("Missing PostgreSQL developer validation definition.");
      }
      const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
        persistence,
        scope.physicalLocator,
      );
      const buildPorts = {
        controlDb: persistence.drizzle,
        authority: {
          scopeMetadata: {
            getScopeMetadataByDeploymentId: (deploymentId: string) =>
              persistence.getScopeMetadataByDeploymentId(deploymentId),
          },
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => null,
          },
          scopeClockTargets: { resolve: async () => target },
        },
      } as const;
      const buildInput = {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 1,
      } as const;
      let reachedCursor = false;
      for (let step = 0; step < 8; step += 1) {
        const result = await runEffect(
          buildAppDeveloperOrderedIndexV1Effect(buildPorts, buildInput),
        );
        if (result.lifecycle === "validating" && result.cursorRowId !== null) {
          reachedCursor = true;
          break;
        }
      }
      expect(reachedCursor).toBe(true);
      expect(
        await developerIndexBuildCursor(
          persistence,
          scope,
          definition.indexDefinitionId,
        ),
      ).not.toBeNull();

      const changed = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_build_validation_change",
        {
          kind: "patch",
          documentId: firstIntent.documentId,
          name: "changed-behind-validation-cursor",
        },
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          changed.publicationCommand,
        ),
      );
      expect(
        await developerIndexBuildCursor(
          persistence,
          scope,
          definition.indexDefinitionId,
        ),
      ).toBeNull();

      let enabled = false;
      for (let step = 0; step < 8; step += 1) {
        const result = await runEffect(
          buildAppDeveloperOrderedIndexV1Effect(buildPorts, buildInput),
        );
        if (result.lifecycle === "enabled") {
          enabled = true;
          break;
        }
      }
      expect(enabled).toBe(true);
      expect(
        (
          await developerIndexState(
            persistence,
            changed.command.sealIdentity.scopeUuid,
          )
        ).current,
      ).toHaveLength(2);
    });
  }, 120_000);

  it.each(["unchanged", "missing", "digest", "differentCanonicalKey"] as const)(
    "authenticates %s unique ownership before omitting a PostgreSQL write",
    async (mode) => {
      await withPostgresPersistence(async (persistence) => {
        const randomUuid = uuidFactory("96418e00");
        const scope = await createScope(
          persistence,
          randomUuid,
          `unique_noop_${mode}`,
        );
        const options = await prepareUniqueConstraintForPostgres(
          persistence,
          scope,
        );
        const inserted = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "unique_noop_insert",
        );
        await runEffect(
          createPublisher(persistence, options).publish(
            inserted.publicationCommand,
          ),
        );
        const row = inserted.command.rowIntents[0];
        if (row?.kind !== "live") throw new Error("Expected inserted row.");
        const next = await createAttempt(
          persistence,
          randomUuid,
          scope,
          "unique_noop_update",
          {
            kind: "patch",
            documentId: row.documentId,
            patch: { category: "non-key" },
          },
        );
        const scopeUuid = next.command.sealIdentity.scopeUuid;
        if (mode === "missing")
          await persistence.query(
            "delete from fx_app_unique_key where scope_uuid = $1",
            [scopeUuid],
          );
        else if (mode === "digest")
          await persistence.query(
            "update fx_app_unique_key set canonical_key_sha256 = decode(repeat('ff',32),'hex') where scope_uuid = $1",
            [scopeUuid],
          );
        else if (mode === "differentCanonicalKey") {
          const key = Result.getOrThrow(
            canonicalizeAppUniqueKeyV1Result({
              sparse: false,
              localeKey: null,
              values: [orderedIndexValueFromFlarexValueV1("foreign-key")],
            }),
          );
          if (key.kind !== "claim") throw new Error("Expected canonical key.");
          const digest = new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              Uint8Array.from(key.canonicalKeyBytes),
            ),
          );
          await persistence.query(
            "update fx_app_unique_key set encoded_key = $2, canonical_key_sha256 = $3 where scope_uuid = $1",
            [scopeUuid, key.canonicalKeyBytes, digest],
          );
        }
        const before = await durableState(persistence, scopeUuid);
        const claims = await persistence.query(
          "select *, xmin::text tuple_version from fx_app_unique_key where scope_uuid = $1",
          [scopeUuid],
        );
        const builds = await persistence.query(
          "select * from fx_system_unique_constraint_build where scope_id = $1",
          [scope.scopeId],
        );
        await withMaterializationDmlTrigger(persistence, "unchanged_unique_omits_dml", fxAppUniqueKeys, "before insert or delete",
          `if (TG_OP='DELETE' and OLD."${fxAppUniqueKeys.scopeUuid.name}"='${scopeUuid}'::uuid) or
            (TG_OP<>'DELETE' and NEW."${fxAppUniqueKeys.scopeUuid.name}"='${scopeUuid}'::uuid) then
            raise exception 'Unchanged unique ownership attempted native DML'; end if;`, async () => {
            const publisher = createPublisher(persistence, options);
            if (mode === "unchanged") await runEffect(publisher.publish(next.publicationCommand));
            else {
              expect(await runFailure(publisher.publish(next.publicationCommand))).toMatchObject({
                _tag: "PointCommitCorruptionV1Error", reason: "uniqueKeyTransitionInvalid",
              });
              expect(await durableState(persistence, scopeUuid)).toEqual(before);
              expect((await persistence.query("select * from fx_system_unique_constraint_build where scope_id = $1",
                [scope.scopeId])).rows).toEqual(builds.rows);
            }
          });
        expect(
          (
            await persistence.query(
              "select *, xmin::text tuple_version from fx_app_unique_key where scope_uuid = $1",
              [scopeUuid],
            )
          ).rows,
        ).toEqual(claims.rows);
      });
    },
    120_000,
  );

  it("enforces conditional handle deletion, reuse, restore and concurrent claims", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96518a00");
      const scope = await createScope(persistence, randomUuid, "conditional_handles");
      const options = await prepareUniqueConstraintForPostgres(persistence, scope, conditionalUniqueSpec);
      const publisher = createPublisher(persistence, options);
      const first = await createAttempt(persistence, randomUuid, scope, "conditional_a",
        { kind: "insert", name: "shirt", fields: { deleted_at: null } });
      await runEffect(publisher.publish(first.publicationCommand));
      const firstIntent = first.command.rowIntents[0];
      if (firstIntent?.kind !== "live") throw new Error("Expected first handle owner");
      const scopeUuid = first.command.sealIdentity.scopeUuid;
      const deleted = await createAttempt(persistence, randomUuid, scope, "conditional_delete_a",
        { kind: "patch", documentId: firstIntent.documentId, patch: { deleted_at: "2026-01-01" } });
      await runEffect(publisher.publish(deleted.publicationCommand));
      expect(await uniqueKeyState(persistence, scopeUuid)).toEqual([]);
      const replacement = await createAttempt(persistence, randomUuid, scope, "conditional_b",
        { kind: "insert", name: "shirt", fields: { deleted_at: null } });
      await runEffect(publisher.publish(replacement.publicationCommand));
      const restore = await createAttempt(persistence, randomUuid, scope, "conditional_restore_a",
        { kind: "patch", documentId: firstIntent.documentId, patch: { deleted_at: null } });
      const before = await durableState(persistence, scopeUuid);
      const claims = await uniqueKeyState(persistence, scopeUuid);
      expect(await runFailure(publisher.publish(restore.publicationCommand))).toBeInstanceOf(AppUniqueKeyConflictError);
      expect(await durableState(persistence, scopeUuid)).toEqual(before);
      expect(await uniqueKeyState(persistence, scopeUuid)).toEqual(claims);
      const restoredElsewhere = await createAttempt(persistence, randomUuid, scope, "conditional_restore_renamed",
        { kind: "patch", documentId: firstIntent.documentId, patch: { name: "other", deleted_at: null } });
      await runEffect(publisher.publish(restoredElsewhere.publicationCommand));
      expect(await uniqueKeyState(persistence, scopeUuid)).toHaveLength(2);
      const replayState = await durableState(persistence, scopeUuid);
      await runEffect(publisher.publish(restoredElsewhere.publicationCommand));
      expect(await durableState(persistence, scopeUuid)).toEqual(replayState);
      const left = await createAttempt(persistence, randomUuid, scope, "conditional_race_left",
        { kind: "insert", name: "race", fields: { deleted_at: null } });
      const right = await createAttempt(persistence, randomUuid, scope, "conditional_race_right",
        { kind: "insert", name: "race", fields: { deleted_at: null } });
      const raced = await runEffect(Effect.all(
        [publisher.publish(left.publicationCommand), publisher.publish(right.publicationCommand)]
          .map(effect => effect.pipe(Effect.result)),
        { concurrency: "unbounded" },
      ));
      expect(raced.filter(Result.isSuccess)).toHaveLength(1);
      expect(raced.filter(Result.isFailure)).toMatchObject([{ failure: { _tag: "AppUniqueKeyConflictError" } }]);
      expect(await uniqueKeyState(persistence, scopeUuid)).toHaveLength(3);
      const otherScope = await createScope(persistence, randomUuid, "conditional_other_scope");
      const otherOptions = await prepareUniqueConstraintForPostgres(persistence, otherScope, conditionalUniqueSpec);
      const other = await createAttempt(persistence, randomUuid, otherScope, "conditional_other_shirt",
        { kind: "insert", name: "shirt", fields: { deleted_at: null } });
      await runEffect(createPublisher(persistence, otherOptions).publish(other.publicationCommand));
      expect(await uniqueKeyState(persistence, other.command.sealIdentity.scopeUuid)).toHaveLength(1);
    });
  }, 120_000);

  it("maintains unique claims and atomically rejects PostgreSQL conflicts", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418800");
      const scope = await createScope(
        persistence,
        randomUuid,
        "unique_key_move",
      );
      const uniqueOptions = await prepareUniqueConstraintForPostgres(
        persistence,
        scope,
      );
      await setValidatingUniqueSetBuild(persistence, scope);
      await setValidatingUniqueSetBuild(persistence, scope, 1001);
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "unique_key_insert",
      );
      await runEffect(
        createPublisher(persistence, uniqueOptions).publish(
          inserted.publicationCommand,
        ),
      );
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        "ff".repeat(16),
        "ff".repeat(16),
      ]);
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected a PostgreSQL C08-B2 insert intent.");
      }
      const beforeMove = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeMove).toHaveLength(1);

      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "unique_key_move",
        {
          kind: "patch",
          documentId: insertIntent.documentId,
          name: "moved_unique_name",
        },
      );
      await setValidatingUniqueSetBuild(persistence, scope);
      await setValidatingUniqueSetBuild(persistence, scope, 1001);
      await withMaterializationDmlCounter(persistence, inserted.command.sealIdentity.scopeUuid, "unique_move_rollback", async countWrites => {
        const fault = new PointCommitCorruptionV1Error({ reason: "publicationInvariantInvalid" });
        const failure = await runFailure(createPublisher(persistence, {
          ...uniqueOptions, afterTransactionStep: async event => { if (event.step === "commitHeaderWritten") throw fault; },
        }).publish(moved.publicationCommand));
        expect(failure).toBe(fault);
        expect(await countWrites()).toBe(2);
      });
      expect(
        await uniqueKeyState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeMove);
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        "ff".repeat(16),
        "ff".repeat(16),
      ]);

      await runEffect(
        createPublisher(persistence, uniqueOptions).publish(
          moved.publicationCommand,
        ),
      );
      expect(await uniqueSetBuildCursors(persistence, scope)).toEqual([
        "ff".repeat(16),
        "ff".repeat(16),
      ]);
      const afterMove = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterMove).toHaveLength(1);
      expect(afterMove[0]?.encodedKeyHex).not.toBe(
        beforeMove[0]?.encodedKeyHex,
      );

      const conflictScope = await createScope(
        persistence,
        randomUuid,
        "unique_key_conflict",
      );
      const conflictOptions = await prepareUniqueConstraintForPostgres(
        persistence,
        conflictScope,
      );
      const conflict = await createAttempt(
        persistence,
        randomUuid,
        conflictScope,
        "unique_key_conflict",
        "duplicate",
      );
      expect(
        await runFailure(
          createPublisher(persistence, conflictOptions).publish(
            conflict.publicationCommand,
          ),
        ),
      ).toBeInstanceOf(AppUniqueKeyConflictError);
      expect(
        await uniqueKeyState(
          persistence,
          conflict.command.sealIdentity.scopeUuid,
        ),
      ).toEqual([]);
      expect(
        await durableState(
          persistence,
          conflict.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
      });
    });
  }, 120_000);

  it("orders shared index and unique sidecars and rolls them back together", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418c00");
      const scope = await createScope(
        persistence,
        randomUuid,
        "o09b_combined_rollback",
        true,
      );
      const proofOptions = Object.freeze({
        ...(await enableIntrinsicIndexForPostgres(persistence, scope)),
        ...(await prepareDeveloperIndexForPostgres(persistence, scope)),
        ...(await prepareUniqueConstraintForPostgres(persistence, scope)),
      });
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_combined_seed",
        { kind: "insert", name: "o09b-seeded" },
      );
      await runEffect(
        createPublisher(persistence, proofOptions).publish(
          inserted.publicationCommand,
        ),
      );
      const insertIntent = inserted.command.rowIntents[0];
      if (insertIntent?.kind !== "live") {
        throw new Error("Expected an O09-B inserted document.");
      }
      const beforeDeveloper = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeUnique = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeDurable = await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_combined_move",
        {
          kind: "patch",
          documentId: insertIntent.documentId,
          name: "o09b-moved",
        },
      );
      await withMaterializationDmlCounter(persistence, inserted.command.sealIdentity.scopeUuid, "combined_sidecar_rollback", async countWrites => {
        const fault = new PointCommitCorruptionV1Error({ reason: "publicationInvariantInvalid" });
        const failure = await runFailure(createPublisher(persistence, {
          ...proofOptions, afterTransactionStep: async event => { if (event.step === "commitHeaderWritten") throw fault; },
        }).publish(moved.publicationCommand));
        expect(failure).toBe(fault);
        expect(await countWrites()).toBe(2);
      }, schemaName => `if (select count(*) from ${new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppIndexEntryRevisions))}`).sql} where "${fxAppIndexEntryRevisions.scopeUuid.name}"='${inserted.command.sealIdentity.scopeUuid}'::uuid
        and "${fxAppIndexEntryRevisions.tableId.name}"=${insertIntent.tableId}
        and "${fxAppIndexEntryRevisions.rowId.name}"=decode('${insertIntent.rowId}','hex')
        and "${fxAppIndexEntryRevisions.indexDefinitionId.name}"<>1
        and "${fxAppIndexEntryRevisions.commitSeq.name}"=2)<>2 then
        raise exception 'Unique DML preceded both developer index key-move revisions'; end if;`);
      expect(
        await developerIndexState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeDeveloper);
      expect(
        await uniqueKeyState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeUnique);
      expect(
        await durableState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeDurable);

      await runEffect(
        createPublisher(persistence, proofOptions).publish(
          moved.publicationCommand,
        ),
      );
      const afterDeveloper = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const afterUnique = await uniqueKeyState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(afterDeveloper.revisions).toHaveLength(4);
      expect(afterDeveloper.revisions.filter(row => row.indexDefinitionId === "1")).toEqual(
        beforeDeveloper.revisions.filter(row => row.indexDefinitionId === "1"),
      );
      expect(afterDeveloper.current.filter(row => row.indexDefinitionId === "1")).toEqual(
        beforeDeveloper.current.filter(row => row.indexDefinitionId === "1"),
      );
      expect(afterDeveloper.current.filter(row => row.indexDefinitionId !== "1")).toMatchObject([{ commitSeq: "2" }]);
      expect(afterUnique).toHaveLength(1);
      expect(afterDeveloper.current.find(row => row.indexDefinitionId !== "1")?.encodedKeyHex).not.toBe(
        beforeDeveloper.current.find(row => row.indexDefinitionId !== "1")?.encodedKeyHex,
      );
      expect(afterUnique[0]?.encodedKeyHex).not.toBe(
        beforeUnique[0]?.encodedKeyHex,
      );
    });
  }, 120_000);

  it("linearizes competing unique claims and permits delete then reuse", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96418e00");
      const scope = await createScope(
        persistence,
        randomUuid,
        "o09b_unique_contention",
        true,
      );
      const proofOptions = Object.freeze({
        ...(await prepareDeveloperIndexForPostgres(persistence, scope)),
        ...(await prepareUniqueConstraintForPostgres(persistence, scope)),
      });
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_first",
        { kind: "insert", name: "o09b-shared" },
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_second",
        { kind: "insert", name: "o09b-shared" },
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const scopeUuid = first.command.sealIdentity.scopeUuid;
      await withMaterializationDmlCounter(persistence, scopeUuid, "contending_developer_writes", async countIndexWrites =>
      withMaterializationDmlCounter(persistence, scopeUuid, "contending_unique_claims", async countClaimWrites => {
      const firstPublisher = createPublisher(persistence, {
        ...proofOptions,
        afterTransactionStep: async (event) => {
          if (event.step === "clockLocked") {
            entered.resolve();
            await release.promise;
          }
        },
      });
      const secondPublisher = createPublisher(persistence, proofOptions);
      const firstPromise = runEffect(
        firstPublisher.publish(first.publicationCommand),
      );
      const entry = await Promise.race([
        entered.promise.then(() => ({ kind: "entered" }) as const),
        firstPromise.then(
          () => ({ kind: "settled", status: "fulfilled" }) as const,
          (cause: unknown) =>
            ({
              kind: "settled",
              status: "rejected",
              cause,
            }) as const,
        ),
      ]);
      if (entry.kind === "settled") {
        release.resolve();
        if (entry.status === "rejected") throw entry.cause;
        throw new Error(
          "The first O09-B publication completed before locking its scope clock.",
        );
      }
      const secondPromise = runEffect(
        secondPublisher.publish(second.publicationCommand),
      );
      let blockingFailure: unknown;
      try {
        await waitForBlockedPointCommit(persistence, 1);
      } catch (cause) {
        blockingFailure = cause;
      } finally {
        release.resolve();
      }
      const settlements = await Promise.allSettled([
        firstPromise,
        secondPromise,
      ]);
      if (blockingFailure !== undefined) throw blockingFailure;
      const fulfilled = settlements.filter(
        (settlement) => settlement.status === "fulfilled",
      );
      const rejected = settlements.filter(
        (settlement) => settlement.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(AppUniqueKeyConflictError);
      expect(await countIndexWrites()).toBe(2);
      expect(await countClaimWrites()).toBe(1);
      expect(settlements[0]?.status).toBe("fulfilled");
      expect(settlements[1]?.status).toBe("rejected");
      }, schemaName => `if not exists(select 1 from ${new PgDialect().sqlToQuery(sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(fxAppIndexEntryRevisions))}`).sql} i where
        i."${fxAppIndexEntryRevisions.scopeUuid.name}"=NEW."${fxAppUniqueKeys.scopeUuid.name}"
        and i."${fxAppIndexEntryRevisions.tableId.name}"=NEW."${fxAppUniqueKeys.tableId.name}"
        and i."${fxAppIndexEntryRevisions.rowId.name}"=NEW."${fxAppUniqueKeys.rowId.name}") then
        raise exception 'Unique claim attempted before its provisional developer index revision'; end if;`, "before insert"),
        () => "", "after insert or delete", fxAppIndexEntryRevisions);
      const winnerIntent = first.command.rowIntents[0];
      if (winnerIntent?.kind !== "live") {
        throw new Error("Missing the O09-B winning document.");
      }
      const winnerDeveloper = await developerIndexState(persistence, scopeUuid);
      const winnerUnique = await uniqueKeyState(persistence, scopeUuid);
      expect(winnerDeveloper).toMatchObject({
        revisions: [{ rowIdHex: pointRowIdHex(winnerIntent.documentId) }],
        current: [{ rowIdHex: pointRowIdHex(winnerIntent.documentId) }],
      });
      expect(winnerUnique).toMatchObject([
        {
          rowIdHex: pointRowIdHex(winnerIntent.documentId),
        },
      ]);
      const winnerDeveloperKey = winnerDeveloper.current[0]?.encodedKeyHex;
      const winnerUniqueKey = winnerUnique[0]?.encodedKeyHex;
      if (winnerDeveloperKey === undefined || winnerUniqueKey === undefined) {
        throw new Error("Missing O09-B winning sidecar keys.");
      }
      expect(await durableState(persistence, scopeUuid)).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });

      const publisher = createPublisher(persistence, proofOptions);
      const deleted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_delete",
        { kind: "delete", documentId: winnerIntent.documentId },
      );
      await runEffect(publisher.publish(deleted.publicationCommand));
      expect(await uniqueKeyState(persistence, scopeUuid)).toEqual([]);
      const afterDeleteDeveloper = await developerIndexState(
        persistence,
        scopeUuid,
      );
      expect(afterDeleteDeveloper.current).toEqual([]);
      expect(afterDeleteDeveloper.revisions).toMatchObject([
        {
          encodedKeyHex: winnerDeveloperKey,
          rowIdHex: pointRowIdHex(winnerIntent.documentId),
          commitSeq: "1",
          isTombstone: false,
        },
        {
          encodedKeyHex: winnerDeveloperKey,
          rowIdHex: pointRowIdHex(winnerIntent.documentId),
          commitSeq: "2",
          isTombstone: true,
        },
      ]);

      const reused = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "o09b_unique_reuse",
        { kind: "insert", name: "o09b-shared" },
      );
      await runEffect(publisher.publish(reused.publicationCommand));
      const reusedIntent = reused.command.rowIntents[0];
      if (reusedIntent?.kind !== "live") {
        throw new Error("Missing the O09-B reused document.");
      }
      expect(reusedIntent.documentId).not.toBe(winnerIntent.documentId);
      const afterReuseDeveloper = await developerIndexState(
        persistence,
        scopeUuid,
      );
      expect(afterReuseDeveloper.revisions).toHaveLength(3);
      expect(
        afterReuseDeveloper.revisions.map((row) => row.commitSeq).sort(),
      ).toEqual(["1", "2", "3"]);
      expect(
        afterReuseDeveloper.revisions.filter((row) => row.isTombstone),
      ).toHaveLength(1);
      expect(afterReuseDeveloper).toMatchObject({
        current: [
          {
            rowIdHex: pointRowIdHex(reusedIntent.documentId),
            commitSeq: "3",
          },
        ],
      });
      expect(afterReuseDeveloper.current[0]?.encodedKeyHex).not.toBe(
        winnerDeveloperKey,
      );
      expect(await uniqueKeyState(persistence, scopeUuid)).toMatchObject([
        {
          encodedKeyHex: winnerUniqueKey,
          rowIdHex: pointRowIdHex(reusedIntent.documentId),
        },
      ]);
      expect(await durableState(persistence, scopeUuid)).toEqual({
        revisions: "3",
        current_rows: "2",
        commit_headers: "3",
        commit_changes: "3",
        outcomes: "3",
        wakes: "3",
        last_commit_seq: "3",
      });
    });
  }, 120_000);

  it("rejects developer-index entry fan-out above the private commit ceiling", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_ceiling",
        3,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_ceiling",
        86,
      );
      const failure = await runFailure(
        createPublisher(persistence, developerOptions).publish(
          attempt.publicationCommand,
        ),
      );
      expect(failure).toBeInstanceOf(
        PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
      );
      expect(failure).toMatchObject({
        reason: "entryRevisionLimitExceeded",
        observed: 258,
        maximum: 256,
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
      });
    });
  }, 120_000);

  it("rolls back action-derived developer-index fan-out above the ceiling", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96419800");
      const scope = await createScope(
        persistence,
        randomUuid,
        "developer_index_action_ceiling",
        2,
      );
      const developerOptions = await prepareDeveloperIndexForPostgres(
        persistence,
        scope,
      );
      const inserted = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_action_seed",
        65,
      );
      await runEffect(
        createPublisher(persistence, developerOptions).publish(
          inserted.publicationCommand,
        ),
      );
      const documentIds = inserted.command.rowIntents.map(
        (intent) => intent.documentId,
      );
      const before = await durableState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      const beforeIndexes = await developerIndexState(
        persistence,
        inserted.command.sealIdentity.scopeUuid,
      );
      expect(beforeIndexes.revisions).toHaveLength(130);
      const moved = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "developer_index_action_move",
        { kind: "bulkPatch", documentIds },
      );
      const failure = await runFailure(
        createPublisher(persistence, developerOptions).publish(
          moved.publicationCommand,
        ),
      );
      expect(failure).toBeInstanceOf(
        PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
      );
      expect(failure).toMatchObject({
        reason: "entryRevisionLimitExceeded",
        observed: 260,
        maximum: 256,
      });
      expect(
        await durableState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(before);
      expect(
        await developerIndexState(
          persistence,
          inserted.command.sealIdentity.scopeUuid,
        ),
      ).toEqual(beforeIndexes);
    });
  }, 120_000);
});
