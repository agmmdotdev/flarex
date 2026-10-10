import {
  PointCommitPublicationObservation,
  type PointCommitPublicationEvent,
} from "../../../src/commit/point/observation";
import * as publicationObservationOwner from "../../../src/commit/point/observation";
import {
  captureSessionStorage,
  expectSessionPayloadScrubbed,
} from "../../execution/session/support/terminalStorageScenario";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Result, Schema, Tracer } from "effect";
import { publicationCoveragePhaseTrace } from "../../performance/publicationCoveragePhaseTrace";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSyscallSequenceV1Schema,
  AdmittedParticipantOperationSchema,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import { decodeOrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { expect, it, vi } from "vitest";
import {
  createAppSchemaCandidateValidationPortForPointCommitAuthority,
  createAppSchemaCandidateWriteGuardPort,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { validateLogicalParticipantDependencyEvidence } from "../../../src/storage/documents/logicalDocuments/commitEvidence";
import { createPointCommitPublisherPortV1 } from "../../../src/commit/point/construction";
import {
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  type PointCommitSqlOperationV1,
} from "../../../src/commit/point/errors";
import { fxSystemCommitAppRowChanges } from "../../../src/database/schema";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";
import {
  withPostgresPersistence,
  uuidFactory,
  createScope,
  createAttempt,
  enableIntrinsicIndexForPostgres,
  createPublisher,
  durableState,
  createPort,
  createIndexedAttempt,
  commitCompetingIndexedUser,
  prepareDeveloperIndexForPostgres,
  terminalPublicationState,
  compareIntrinsicIndexRows,
  intrinsicIndexState,
  emptyDurableState,
  describePostgres,
} from "./support/postgresFixture";
import {
  deferredSignal,
  installCommitSqlStateTrigger,
  dropCommitTrigger,
} from "./support/postgresFaults";
import {
  requireObservedQuery,
  explainObserved,
  expectSequentialScansEnabled,
  explainIndexRangeOccLookup,
} from "./support/postgresDiagnostics";

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("keeps OCC, lowering and clock advancement inline when publication observation is absent", async () => {
    const original = publicationObservationOwner.observePointCommitPublicationPromise;
    const grouped = new Set(["occProof", "lowering", "clockAdvance"]);
    const intercepted = vi.spyOn(publicationObservationOwner, "observePointCommitPublicationPromise")
      .mockImplementation((observation, phase, work) => {
        if (grouped.has(phase)) throw new Error("Inline publication work entered a diagnostic Promise wrapper");
        return original(observation, phase, work);
      });
    try {
      await withPostgresPersistence(async persistence => {
        const randomUuid = uuidFactory("96780000");
        const scope = await createScope(persistence, randomUuid, "inline_publication");
        const attempt = await createAttempt(persistence, randomUuid, scope, "inline_publication", 33);
        const intrinsic = await enableIntrinsicIndexForPostgres(persistence, scope);
        expect(await runEffect(createPublisher(persistence, intrinsic).publish(attempt.publicationCommand)))
          .toMatchObject({ kind: "published", token: { commitSeq: 1n } });
        expect(await durableState(persistence, attempt.command.sealIdentity.scopeUuid)).toEqual({
          revisions: "33", current_rows: "33", commit_headers: "1", commit_changes: "33",
          outcomes: "1", wakes: "1", last_commit_seq: "1",
        });
        // Other existing passive frontiers exercise the spy; these three real
        // call sites must finish publication without entering it at all.
        expect(intercepted).toHaveBeenCalled();
        expect(intercepted.mock.calls.some(([, phase]) => grouped.has(phase))).toBe(false);
      });
    } finally {
      intercepted.mockRestore();
    }
  }, 120_000);

  it("preserves real COMMIT and publication refusal with a failing passive observer", async () => {
    await withPostgresPersistence(async persistence => {
      const randomUuid = uuidFactory("96770000");
      const scope = await createScope(persistence, randomUuid, "passive_publication");
      const attempt = await createAttempt(persistence, randomUuid, scope, "passive_publication", 33);
      const intrinsic = await enableIntrinsicIndexForPostgres(persistence, scope);
      const events: PointCommitPublicationEvent[] = [];
      const observation = new PointCommitPublicationObservation({ detail: true, record: event => {
        events.push(event);
        throw new Error("publication collector unavailable");
      } });
      const publisher = createPublisher(persistence, { ...intrinsic, publicationObservation: observation });
      expect(await runEffect(publisher.publish(attempt.publicationCommand))).toMatchObject({ kind: "published", token: { commitSeq: 1n } });
      expect(await durableState(persistence, attempt.command.sealIdentity.scopeUuid)).toEqual({
        revisions: "33", current_rows: "33", commit_headers: "1", commit_changes: "33",
        outcomes: "1", wakes: "1", last_commit_seq: "1",
      });
      const rowBatches = events.filter(event => event.kind === "batch" && event.owner === "rowRevisions");
      expect(rowBatches).toEqual([
        { kind: "batch", owner: "rowRevisions", counts: { rows: 32, canonicalBytes: expect.any(Number) } },
        { kind: "batch", owner: "rowRevisions", counts: { rows: 1, canonicalBytes: expect.any(Number) } },
      ]);
      for (const owner of ["commitHeaders", "outcomes", "wakes", "journalDeletes", "leaseDeletes", "sessionCommits"])
        expect(events).toContainEqual({ kind: "batch", owner, counts: expect.objectContaining({ rows: 1 }) });
      expect(events).toContainEqual({ kind: "phase", phase: "transaction", edge: "end" });
      expect(() => observation.assertHealthy()).toThrow("publication observation failed");
      const beforeReplay = events.length;
      expect(await runEffect(publisher.publish(attempt.publicationCommand))).toMatchObject({ kind: "replayed" });
      expect(events.slice(beforeReplay).some(event => event.kind === "phase" && event.phase === "transaction")).toBe(false);

      const failingScope = await createScope(persistence, randomUuid, "passive_refusal");
      const failingAttempt = await createAttempt(persistence, randomUuid, failingScope, "passive_refusal", true);
      const failingIntrinsic = await enableIntrinsicIndexForPostgres(persistence, failingScope);
      const injected = new PointCommitCorruptionV1Error({ reason: "publicationInvariantInvalid" });
      const refusal = await runFailure(createPublisher(persistence, { ...failingIntrinsic,
        publicationObservation: observation, afterTransactionStep: event => {
          if (event.step === "commitChangeWritten") throw injected;
          return Promise.resolve();
        },
      }).publish(failingAttempt.publicationCommand));
      expect(refusal).toBe(injected);
      expect(await durableState(persistence, failingAttempt.command.sealIdentity.scopeUuid)).toEqual({
        revisions: "0", current_rows: "0", commit_headers: "0", commit_changes: "0",
        outcomes: "0", wakes: "0", last_commit_seq: "0",
      });
    });
  }, 120_000);

  it("masks interruption until forced rollback settles and exposes no tentative state", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96000000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "rollback_settlement",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "rollback_settlement",
      );
      const before = await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const fiber = Effect.runFork(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "beforeRollback") return;
            entered.resolve();
            await release.promise;
          },
        }).prove(attempt.command),
      );
      await entered.promise;

      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toEqual(before);
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toEqual(before);

      const steps: string[] = [];
      const queries = new Map<
        PointCommitSqlOperationV1,
        Readonly<{
          readonly sql: string;
          readonly params: ReadonlyArray<unknown>;
        }>
      >();
      const result = await runEffect(
        createPort(persistence, {
          afterTransactionStep: (event) => {
            steps.push(event.step);
            return Promise.resolve();
          },
          observeQuery: (query) => {
            queries.set(query.name, query);
          },
        }).prove(attempt.command),
      );
      expect(result).toEqual({ kind: "wouldCommit" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(steps).toEqual([
        "lifecycleProtected",
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "beforeRollback",
      ]);
      expect([...queries.keys()]).toEqual([
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "readDatabaseTime",
        "loadRowHeads",
        "acceptPublication",
        "applyPublication",
      ]);
      expect(requireObservedQuery(queries, "acceptPublication").sql).toContain("fx_accept_app_publication");
      expect(requireObservedQuery(queries, "applyPublication").sql).toContain("fx_apply_app_publication");
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
      ] as const) {
        expect(
          await explainObserved(
            persistence,
            requireObservedQuery(queries, name),
          ),
        ).toContain("Index Scan");
      }
      await expectSequentialScansEnabled(persistence);
    });
  }, 120_000);

  it("detects an indexed phantom through the commit-range index", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96310000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "indexed_occ",
        true,
      );
      const attempt = await createIndexedAttempt(
        persistence,
        randomUuid,
        scope,
        "indexed_occ",
      );
      const inserted = await commitCompetingIndexedUser(
        persistence,
        scope,
        attempt,
        "22".repeat(16),
      );
      const failure = await runFailure(
        createPort(
          persistence,
          await prepareDeveloperIndexForPostgres(persistence, scope),
        ).prove(attempt.command),
      );
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      expect(failure).toMatchObject({
        conflict: {
          kind: "appIndexRange",
          reason: "overlap",
          dependencyOrdinal: 0,
          tableId: decodeCatalogTableId(1),
          indexDefinitionId: attempt.definition.indexDefinitionId,
          encodedKey: inserted.encodedKey,
          rowId: decodeOrderedIndexRowIdHexV1(inserted.rowId),
        },
        snapshotCommitSeq: CommitSeqSchema.make(0n),
        currentCommitSeq: CommitSeqSchema.make(1n),
      });
      const plan = await explainIndexRangeOccLookup(
        persistence,
        attempt.command,
      );
      expect(plan).toContain("fx_app_index_entry_rev_commit_range_idx");
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        last_commit_seq: "1",
      });
    });
  }, 120_000);

  it("classifies multiple new members of a borrowed empty index range as a conflict", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96310001");
      const scope = await createScope(persistence, randomUuid, "borrowed_range_growth", true);
      const attempt = await createIndexedAttempt(persistence, randomUuid, scope, "borrowed_range_growth");
      expect(attempt.queryResult).toMatchObject({ outcome: { documents: [] } });
      await commitCompetingIndexedUser(persistence, scope, attempt, "23".repeat(16));
      await commitCompetingIndexedUser(persistence, scope, attempt, "24".repeat(16));
      const digest = "0".repeat(64);
      const operation = Result.getOrThrow(Schema.decodeUnknownResult(
        Schema.toType(AdmittedParticipantOperationSchema))({
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          participant: "fixture.borrowed", method: "readIndex", profileRevision: digest,
          admissionBundleSha256Hex: digest, requestSha256Hex: digest, resultSha256Hex: digest,
          sourceContributions: [{ sourceKey: "fixture.source", sourceSha256Hex: digest,
            bindingHead: { sequence: "1", sha256: digest }, sourceBindingSha256Hex: digest,
            methods: ["readIndex"], effects: [],
            dependencyEvidence: { format: "flarex.logical-participant-evidence", version: 1,
              indexRanges: [{ indexDefinitionId: attempt.definition.indexDefinitionId,
                bounds: {}, entries: [] }], indexPages: [], uniqueReads: [] } }],
          eventIntents: [],
        }));
      const sourceContribution = operation.sourceContributions[0];
      if (sourceContribution === undefined) throw new Error("Missing tested source contribution");
      const failure = await persistence.drizzle.transaction(tx => runFailure(
        validateLogicalParticipantDependencyEvidence(tx, scope.scopeId, operation, sourceContribution, {
          tableIds: new Set([decodeCatalogTableId(1)]), indexes: [attempt.definition], unique: [],
        })));
      expect(failure).toMatchObject({ reason: "writeConflict" });
    });
  }, 120_000);

  it.each([0, 1, 128])(
    "publishes %i admitted native row facts in one batch",
    async (count) => {
      await withPostgresPersistence(async (persistence) => {
        const randomUuid = uuidFactory((0x96b00000 + count).toString(16));
        const label = `publish_batch_${count}`;
        const scope = await createScope(persistence, randomUuid, label);
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          label,
          count,
        );
        const parameters: number[] = [];
        const packetRows: number[] = [];
        let steps = 0;
        const publisher = createPublisher(persistence, {
          observeQuery: (query) => {
            if (query.name === "writeCommitChange") {
              parameters.push(query.params.length);
              expect(query.sql).toContain('"fx_write_scope_publication_rows"(');
              const packet = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
                scope_uuid: Schema.String, epoch_uuid: Schema.String, commit_seq: Schema.String,
                change_ordinal: Schema.Int, table_id: Schema.Int, row_id: Schema.String,
              })), { onExcessProperty: "error" })(JSON.parse(String(query.params[0])));
              packetRows.push(packet.length);
            }
          },
          afterTransactionStep: async (event) => {
            if (event.step === "commitChangeWritten") steps += 1;
          },
        });
        await expect(
          runEffect(publisher.publish(attempt.publicationCommand)),
        ).resolves.toMatchObject({ kind: "published" });
        const expectedBatches =
          count === 0
            ? []
            : Array.from(
                { length: Math.ceil(count / 500) },
                (_, index) => Math.min(500, count - index * 500),
              );
        expect(packetRows).toEqual(expectedBatches);
        expect(parameters).toEqual(expectedBatches.map(() => 2));
        expect(steps).toBe(expectedBatches.length);
        const facts = await persistence.drizzle
          .select()
          .from(fxSystemCommitAppRowChanges)
          .where(
            eq(
              fxSystemCommitAppRowChanges.scopeUuid,
              attempt.command.sealIdentity.scopeUuid,
            ),
          )
          .orderBy(fxSystemCommitAppRowChanges.changeOrdinal);
        expect(facts.map((fact) => fact.changeOrdinal)).toEqual(
          Array.from({ length: count }, (_, ordinal) => ordinal),
        );
        expect(
          new Set(facts.map((fact) => Buffer.from(fact.rowId).toString("hex")))
            .size,
        ).toBe(count);
        expect(
          await durableState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
          ),
        ).toMatchObject({
          revisions: String(count),
          commit_changes: String(count),
          commit_headers: "1",
          outcomes: "1",
          wakes: "1",
        });
        await expect(
          runEffect(publisher.publish(attempt.publicationCommand)),
        ).resolves.toMatchObject({ kind: "replayed" });
        expect(packetRows).toEqual(expectedBatches);
        expect(parameters).toEqual(expectedBatches.map(() => 2));
      });
    },
    120_000,
  );

  it("publishes material and zero-row successes with complete atomic evidence", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96400000");
      const materialScope = await createScope(
        persistence,
        randomUuid,
        "publish_material",
      );
      const material = await createAttempt(
        persistence,
        randomUuid,
        materialScope,
        "publish_material",
      );
      const payloadBefore = await captureSessionStorage(
        persistence,
        material.anchor,
      );
      const published = await runEffect(
        createPublisher(persistence).publish(material.publicationCommand),
      );
      expectSessionPayloadScrubbed(
        payloadBefore,
        await captureSessionStorage(persistence, material.anchor),
      );
      expect(published).toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
        successfulResult: { valueJson: { ok: true } },
      });
      expect(
        await durableState(
          persistence,
          material.command.sealIdentity.scopeUuid,
        ),
      ).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });
      expect(
        await terminalPublicationState(
          persistence,
          material.command.sealIdentity.scopeUuid,
          material.anchor.sessionId,
        ),
      ).toEqual({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
        change_count: 1,
        delivery_state: "pending",
        same_initial_time: true,
      });

      const zeroScope = await createScope(
        persistence,
        randomUuid,
        "publish_zero",
      );
      const zero = await createAttempt(
        persistence,
        randomUuid,
        zeroScope,
        "publish_zero",
        false,
      );
      await runEffect(
        createPublisher(persistence).publish(zero.publicationCommand),
      );
      expect(
        await durableState(persistence, zero.command.sealIdentity.scopeUuid),
      ).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "1",
        commit_changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
      });
      expect(
        await terminalPublicationState(
          persistence,
          zero.command.sealIdentity.scopeUuid,
          zero.anchor.sessionId,
        ),
      ).toMatchObject({ change_count: 0, lifecycle: "committed" });
    });
  }, 120_000);

  it("keeps the exact material-row ceiling operable and rejects plus one", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96420000");
      for (const rowCount of [1, 8, 32, 64, 127, 128] as const) {
        const label = `material_profile_${rowCount}`;
        const scope = await createScope(persistence, randomUuid, label);
        const attempt = await createAttempt(
          persistence,
          randomUuid,
          scope,
          label,
          rowCount,
        );
        const intrinsicOptions = await enableIntrinsicIndexForPostgres(
          persistence,
          scope,
        );
        let clockLockedAt: number | undefined;
        let beforeCommitAt: number | undefined;
        const published = await runEffect(
          createPublisher(persistence, {
            ...intrinsicOptions,
            afterTransactionStep: (event) => {
              if (event.step === "clockLocked") {
                clockLockedAt = performance.now();
              } else if (event.step === "beforeCommit") {
                beforeCommitAt = performance.now();
              }
              return Promise.resolve();
            },
          }).publish(attempt.publicationCommand),
        );
        const publicationSettledAt = performance.now();
        if (clockLockedAt === undefined || beforeCommitAt === undefined) {
          throw new Error("Missing O09-A PostgreSQL lock-window evidence.");
        }
        const settlementInclusiveMilliseconds =
          publicationSettledAt - clockLockedAt;
        expect(published).toMatchObject({
          kind: "published",
          token: { commitSeq: 1n },
        });
        expect(settlementInclusiveMilliseconds).toBeLessThan(30_000);
        expect(
          await durableState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
          ),
        ).toEqual({
          revisions: rowCount.toString(),
          current_rows: rowCount.toString(),
          commit_headers: "1",
          commit_changes: rowCount.toString(),
          outcomes: "1",
          wakes: "1",
          last_commit_seq: "1",
        });
        const expectedSidecars = attempt.command.rowIntents
          .map((intent) => ({
            tableId: intent.tableId.toString(),
            rowIdHex: intent.rowId.replaceAll("-", ""),
            commitSeq: "1",
            isTombstone: false,
          }))
          .sort(compareIntrinsicIndexRows);
        expect(
          await intrinsicIndexState(
            persistence,
            attempt.command.sealIdentity.scopeUuid,
          ),
        ).toEqual({
          revisions: expectedSidecars,
          current: expectedSidecars.map(({ isTombstone: _, ...row }) => row),
        });
      }

      const rejectedScope = await createScope(
        persistence,
        randomUuid,
        "material_profile_rejected",
      );
      const atLimit = await createAttempt(
        persistence,
        randomUuid,
        rejectedScope,
        "material_profile_rejected",
        MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
      );
      const firstIntent = atLimit.publicationCommand.rowIntents[0];
      if (firstIntent === undefined) {
        throw new Error("Missing O09-A at-limit row intent.");
      }
      const oversized = Object.freeze({
        ...atLimit.publicationCommand,
        rowIntents: Object.freeze([
          ...atLimit.publicationCommand.rowIntents,
          firstIntent,
        ]),
      });
      await expect(
        runFailure(createPublisher(persistence).publish(oversized)),
      ).resolves.toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });
      expect(
        await durableState(persistence, atLimit.command.sealIdentity.scopeUuid),
      ).toEqual(emptyDurableState());

    });
  }, 480_000);

  it("rolls back late O07-B failures without a sequence or receipt gap", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_rollback",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_rollback",
      );
      const payloadBefore = await captureSessionStorage(
        persistence,
        attempt.anchor,
      );
      const failure = await runFailure(
        createPublisher(persistence, {
          afterTransactionStep: (event) => {
            if (event.step === "clockAdvanced") {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
            return Promise.resolve();
          },
        }).publish(attempt.publicationCommand),
      );
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(await captureSessionStorage(persistence, attempt.anchor)).toEqual(
        payloadBefore,
      );
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

  it("atomically records candidate failure on genuine PostgreSQL", async () => {
    await withPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96800000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "candidate_guard",
      );
      const candidateSchemaVersionId = CatalogSchemaVersionIdSchema.make(
        "schema_o06_postgres_candidate_guard_empty",
      );
      await persistence.publishAppSchemaV1({
        deploymentId: scope.deploymentId,
        schemaVersionId: candidateSchemaVersionId,
        version: CatalogSchemaVersionSchema.make(2),
        tables: [],
        indexes: [],
      });
      const candidateValidation =
        createAppSchemaCandidateValidationPortForPointCommitAuthority(
          persistence.drizzle,
          scope.ports,
        );
      await runEffect(
        installAppSchemaCandidateValidationEffect(candidateValidation, {
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: candidateSchemaVersionId,
        }),
      );
      const guard = createAppSchemaCandidateWriteGuardPort({
        candidateValidation,
        pointCommitAuthority: scope.ports,
      });
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "candidate_guard",
      );
      let candidateFailureSteps = 0;
      const coverageTrace=publicationCoveragePhaseTrace();
      const publisher = createPointCommitPublisherPortV1(scope.ports, {
        candidateSchemaWriteGuard: guard,
        afterTransactionStep: (event) => {
          if (event.step === "candidateSchemaValidationFailed") {
            candidateFailureSteps += 1;
            coverageTrace.candidateFailed();
          }
          return Promise.resolve();
        },
      });
      await expect(
        runEffect(publisher.prove(attempt.command).pipe(Effect.provideService(Tracer.Tracer,coverageTrace.tracer))),
      ).resolves.toEqual({ kind: "wouldCommit" });
      coverageTrace.assertFullProof(0);
      await expect(
        runEffect(
          loadAppSchemaCandidateValidationEffect(candidateValidation, {
            deploymentId: scope.deploymentId,
            scopeId: scope.scopeId,
            schemaVersionId: candidateSchemaVersionId,
          }),
        ),
      ).resolves.toMatchObject({
        head: {
          frame: {
            kind: "app_schema_candidate_validation_progress",
          },
        },
      });
      expect(candidateFailureSteps).toBe(1);
      const trigger = await installCommitSqlStateTrigger(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
        "40001",
        "m03_b_candidate_guard_40001",
      );
      try {
        coverageTrace.reset();
        await expect(
          runFailure(publisher.publish(attempt.publicationCommand).pipe(Effect.provideService(Tracer.Tracer,coverageTrace.tracer))),
        ).resolves.toMatchObject({
          _tag: "PointCommitConfirmedPreDecisionRollbackV1Error",
          operation: "writeCommitHeader",
          sqlState: "40001",
        });
        coverageTrace.assertFullProof(0);
      } finally {
        await dropCommitTrigger(persistence, trigger);
      }
      await expect(
        runEffect(
          loadAppSchemaCandidateValidationEffect(candidateValidation, {
            deploymentId: scope.deploymentId,
            scopeId: scope.scopeId,
            schemaVersionId: candidateSchemaVersionId,
          }),
        ),
      ).resolves.toMatchObject({
        head: {
          frame: {
            kind: "app_schema_candidate_validation_progress",
          },
        },
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        last_commit_seq: "0",
      });
      coverageTrace.reset();
      await expect(
        runEffect(publisher.publish(attempt.publicationCommand).pipe(Effect.provideService(Tracer.Tracer,coverageTrace.tracer))),
      ).resolves.toMatchObject({ kind: "published", token: { commitSeq: 1n } });
      coverageTrace.assertFullProof(0);
      const failed = await runEffect(
        loadAppSchemaCandidateValidationEffect(candidateValidation, {
          deploymentId: scope.deploymentId,
          scopeId: scope.scopeId,
          schemaVersionId: candidateSchemaVersionId,
        }),
      );
      expect(failed).toMatchObject({
        head: {
          frame: {
            kind: "app_schema_candidate_validation_failure_evidence",
            observedFailureCount: 1n,
            entries: [
              {
                source: "pointCommit",
                reason: "candidateTableRemoved",
                observedCommitSeq: 1n,
              },
            ],
          },
        },
      });
      if (failed.status !== "present") {
        throw new Error("Missing failed PostgreSQL candidate head.");
      }
      await expect(
        runEffect(publisher.publish(attempt.publicationCommand)),
      ).resolves.toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });
      await expect(
        runEffect(
          loadAppSchemaCandidateValidationEffect(candidateValidation, {
            deploymentId: scope.deploymentId,
            scopeId: scope.scopeId,
            schemaVersionId: candidateSchemaVersionId,
          }),
        ),
      ).resolves.toMatchObject({
        head: { frameSha256Hex: failed.head.frameSha256Hex },
      });
      expect(
        await durableState(persistence, attempt.command.sealIdentity.scopeUuid),
      ).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        last_commit_seq: "1",
      });
    });
  }, 120_000);
});
