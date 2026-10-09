import { eq } from "drizzle-orm";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import { CommitSeqSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { expect, it, afterAll, beforeAll, describe, vi } from "vitest";
import {
  InvalidSessionJournalInputV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalStorageCorruptionV1Error,
  type SessionJournalIndexedQueryOperationV1,
} from "../../../src/execution/journal/api";
import { fxSystemTransactionJournalIndexRanges, fxSystemIndexBuildStates, fxSystemScopeClocks } from "../../../src/database/schema";
import { OrderedIndexCodecV1InputError, decodeOrderedIndexBoundHexV1 } from "flarex-protocol/ordered-index";
import {
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";
import {
  issueSetupSeededSyscallValidatorProofV1,
  SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
} from "../../application/revision/applicationRevisionSyscallValidatorTestSupport";
import {
  seedSnapshotDocument,
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";
import {
  SEEDED_ROW_ID,
  SEEDED_CREATION_TIME,
  SECOND_ROW_ID,
  syscallSequence,
  selectorFromAnchor,
  documentId,
  requireSeededDocumentId,
} from "./journalTestSupport";

import { captureAttemptStateResult } from "../../../src/execution/journal/inputCapture";
import { decodeStoredIndexRangeRowsEffect } from "../../../src/execution/journal/receiptEvidence";
import { Cause, Effect, Exit } from "effect";

describe("Journal indexed queries (PGlite)", () => {
  let fixture: SessionJournalStorePGliteFixture;
  let persistence: SessionJournalStorePGliteFixture["persistence"];
  let scenario: SessionJournalStorePGliteFixture["scenario"];
  let journalCounts: SessionJournalStorePGliteFixture["journalCounts"];
  let journalRoot: SessionJournalStorePGliteFixture["journalRoot"];

  beforeAll(async () => {
    fixture = await createSessionJournalStorePGliteFixture();
    ({ persistence, scenario, journalCounts, journalRoot } = fixture);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it("resolves developer index descriptors through the pinned schema artifact", async () => {
    await expect(scenario("o10b_index_descriptor", {
      developerIndex: true,
      developerIndexDescriptor: "by_name",
    })).resolves.toMatchObject({ developerIndex: {} });
    await expect(scenario("o10b_numeric_index_identity_rejected", {
      developerIndex: true,
      developerIndexDescriptor: 1,
    })).rejects.toMatchObject({
      _tag: "InvalidSessionJournalInputV1Error",
      reason: "invalidIndexDescriptor",
    });
    await expect(scenario("o10b_unknown_index_descriptor", {
      developerIndex: true,
      developerIndexDescriptor: "by_missing",
    })).rejects.toMatchObject({
      _tag: "SessionJournalDeveloperIndexUnavailableV1Error",
      reason: "definitionNotFound",
    });
    for (const indexedQueryComposition of [
      "missing",
      "foreignControl",
      "mismatchedAuthority",
    ] as const) {
      await expect(scenario(
        `o10b_${indexedQueryComposition}_query_authority`,
        { developerIndex: true, indexedQueryComposition },
      )).rejects.toMatchObject({
        _tag: "SessionJournalDeveloperIndexUnavailableV1Error",
        reason: "invalidComposition",
      });
    }
  });

  it("rejects uninitialized and future-readable indexes before journal evidence", async () => {
    const current = await scenario("index_coverage_admission", { seedFields: { name: "Ada" }, developerIndex: true });
    const index = current.developerIndex;
    if (index === null) throw new Error("Expected indexed handle.");
    const invoke = () => runEffect(current.store.runIndexedQueryEffect(index, {
      kind: "indexRange", syscallSequence: syscallSequence(1n), bounds: {}, limit: 1,
    }));
    const scopeId = current.anchor.snapshotToken.scopeId;
    const selected = eq(fxSystemIndexBuildStates.scopeId, scopeId);
    await persistence.drizzle.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: null, firstReadableCommitSeq: null }).where(selected);
    await expect(invoke()).rejects.toMatchObject({ reason: "buildNotEnabled" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({ indexed_query_syscalls: 0, index_range_dependency_count: 0 });
    await persistence.drizzle.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(2n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId));
    await persistence.drizzle.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(2n), firstReadableCommitSeq: CommitSeqSchema.make(2n) }).where(selected);
    await expect(invoke()).rejects.toMatchObject({ reason: "buildNotEnabled" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({ indexed_query_syscalls: 0, index_range_dependency_count: 0 });
    await persistence.drizzle.update(fxSystemIndexBuildStates).set({ firstReadableCommitSeq: CommitSeqSchema.make(1n) }).where(selected);
    await expect(invoke()).resolves.toMatchObject({ kind: "completed", delivery: "executed" });
  });

  it("orders exact decimals across snapshot and pending rows and refuses invalid staged values", async () => {
    const current = await scenario("decimal_pending", { developerIndex: true, decimalIndex: true,
      seedFields: { name: "100" }, additionalSeedFields: { name: "20" } });
    if (current.developerIndex === null) throw new Error("Missing decimal index");
    const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId, schemaManifest: current.schemaManifest });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch", syscallSequence: syscallSequence(1n), documentId: requireSeededDocumentId(current), patch: { name: "2e1" },
    }, validator));
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "insert", syscallSequence: syscallSequence(2n), fields: { name: "3" },
    }, validator));
    const operation = { kind: "indexRange" as const, syscallSequence: syscallSequence(3n), bounds: {}, limit: 3 };
    expect(await runEffect(current.store.runIndexedQueryEffect(current.developerIndex, operation))).toMatchObject({
      kind: "completed", delivery: "executed", outcome: { documents: [{ name: "3" }, { name: "2e1" }, { name: "20" }], isDone: true },
    });
    expect(await runEffect(current.store.runIndexedQueryEffect(current.developerIndex, operation))).toMatchObject({ delivery: "replayed" });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch", syscallSequence: syscallSequence(4n), documentId: requireSeededDocumentId(current), patch: { name: "invalid" },
    }, validator));
    expect(await runFailure(current.store.runIndexedQueryEffect(current.developerIndex, { ...operation, syscallSequence: syscallSequence(5n) })))
      .toMatchObject({ _tag: "ExactDecimalError", reason: "invalidInput" });
  });

  it("captures and replays one exact indexed snapshot page", async () => {
    const current = await scenario("o10a_indexed_snapshot", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    const executed = await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ));
    expect(executed).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Ada" }],
        isDone: true,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "indexRangePage", isDone: true },
    });

    const state = await persistence.query<Readonly<Record<string, unknown>>>(
      `select indexed_query_syscalls, index_range_dependency_count,
              index_range_dependency_evidence_bytes
         from fx_system_tx_journal where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(state.rows[0]).toMatchObject({
      indexed_query_syscalls: 1,
      index_range_dependency_count: 1,
    });
    const ranges = await persistence.query<Readonly<Record<string, unknown>>>(
      `select ordinal, lower_kind, upper_kind, evidence_bytes
         from fx_system_tx_journal_index_range
        where session_id = $1 order by ordinal`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toMatchObject([{
      ordinal: 0,
      lower_kind: "unbounded",
      upper_kind: "unbounded",
    }]);
    expect(state.rows[0]?.index_range_dependency_evidence_bytes).toBe(
      ranges.rows[0]?.evidence_bytes,
    );

    const prepared = await prepareSeal(current.store, current.attempt);
    expect(prepared.journal.readDependencies).toMatchObject([
      { kind: "appRowPoint", observed: { kind: "present" } },
      {
        kind: "appIndexRange",
        tableId: current.tableId,
        direction: "asc",
        lower: null,
        upper: null,
      },
    ]);
  });

  it("stops bounded page materialization when the semantic budget is exceeded", async () => {
    const seeds = Array.from({ length: 9 }, (_, index) => Object.freeze({
      fields: Object.freeze({ name: `batch-${index.toString().padStart(2, "0")}` }),
      rowId: decodeAppRowIdHexV1(
        `84000000000040008000${index.toString(16).padStart(12, "0")}`,
      ),
      creationTime: decodeAppCreationTimeV1(1_725_000_001_000.25 + index),
    }));
    const current = await scenario("o10a_bounded_materialization", {
      developerIndex: true,
      extraIndexedSeeds: seeds,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const unreadCorruptRow = seeds.at(-1)!;
    await persistence.query(
      `update fx_app_row_rev
          set value_sha256 = $4
        where scope_uuid = $1 and table_id = $2 and row_id = $3`,
      [
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
        current.tableId,
        appRowIdHexV1ToBytes(unreadCorruptRow.rowId),
        new Uint8Array(32),
      ],
    );
    await persistence.query(
      `update fx_system_tx_journal
          set read_semantic_bytes = $2
        where session_id = $1`,
      [current.anchor.sessionId, MAX_COMMIT_READ_SEMANTIC_BYTES_V1 - 1],
    );

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1,
      },
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "readSemanticBytes",
        maximum: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
      },
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      read_semantic_bytes: MAX_COMMIT_READ_SEMANTIC_BYTES_V1 - 1,
      point_dependency_count: 0,
      indexed_query_syscalls: 0,
      index_range_dependency_count: 0,
      failure_dimension: "readSemanticBytes",
    });
  });

  it("overlays a staged patch before recording indexed evidence", async () => {
    const current = await scenario("o10a_staged_overlay", {
      seedFields: { name: "before" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId: requireSeededDocumentId(current),
      patch: { name: "after" },
    }, validator));
    const result = await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(2n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(result).toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "after" }],
        isDone: true,
      },
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows[0]?.count).toBe(1);
  });

  it("orders staged inserts, patches, and deletes before applying the page limit", async () => {
    const current = await scenario("o10b_staged_overlay_order", {
      seedFields: { name: "Ada" },
      additionalSeedFields: { name: "Zoe" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-B developer index handle.");
    }
    const validator = issueSetupSeededSyscallValidatorProofV1({
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest,
    });
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId: appDocumentIdV1FromRowIdentity({
        tableId: current.tableId,
        rowId: SECOND_ROW_ID,
      }),
      patch: { name: "Aaron" },
    }, validator));
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "delete",
      syscallSequence: syscallSequence(2n),
      documentId: requireSeededDocumentId(current),
    }, validator));
    await runEffect(current.store.runPointOperationEffect(current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(3n),
      fields: { name: "Mia" },
    }, validator));

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(4n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Aaron" }],
        isDone: false,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(5n),
        bounds: Object.freeze({}),
        limit: 3,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        kind: "indexRangePage",
        documents: [{ name: "Aaron" }, { name: "Mia" }],
        isDone: true,
      },
    });
  });

  it("captures a composite frontier, then merges an exhausted replay range", async () => {
    const current = await scenario("o10a_frontier_merge", {
      seedFields: { name: "Ada" },
      additionalSeedFields: { name: "Zoe" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        documents: [{ name: "Ada" }],
        isDone: false,
      },
    });
    const frontier = await persistence.query<Readonly<Record<string, unknown>>>(
      `select upper_kind, upper_encoded_key, upper_row_id
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(frontier.rows).toMatchObject([{
      upper_kind: "position_inclusive",
    }]);
    expect(frontier.rows[0]?.upper_encoded_key).toBeInstanceOf(Uint8Array);
    expect(frontier.rows[0]?.upper_row_id).toBeInstanceOf(Uint8Array);

    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(2n),
        bounds: Object.freeze({}),
        limit: 2,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: {
        documents: [{ name: "Ada" }, { name: "Zoe" }],
        isDone: true,
      },
    });
    const merged = await persistence.query<Readonly<Record<string, unknown>>>(
      `select ordinal, lower_kind, upper_kind
         from fx_system_tx_journal_index_range
        where session_id = $1 order by ordinal`,
      [current.anchor.sessionId],
    );
    expect(merged.rows).toEqual([{
      ordinal: 0,
      lower_kind: "unbounded",
      upper_kind: "unbounded",
    }]);
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      indexed_query_syscalls: 2,
      index_range_dependency_count: 1,
      point_dependency_count: 2,
    });
  });

  it("records the complete requested interval for an empty indexed page", async () => {
    const current = await scenario("o10a_empty_range", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({
          startInclusive: decodeOrderedIndexBoundHexV1("ff"),
        }),
        limit: 1,
      },
    ))).resolves.toMatchObject({
      kind: "completed",
      outcome: { documents: [], isDone: true },
    });
    const ranges = await persistence.query<Readonly<Record<string, unknown>>>(
      `select lower_kind, lower_encoded_key, upper_kind
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toMatchObject([{
      lower_kind: "key_inclusive",
      upper_kind: "unbounded",
    }]);
    expect(ranges.rows[0]?.lower_encoded_key).toEqual(new Uint8Array([255]));
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      point_dependency_count: 0,
      read_documents: 0,
      indexed_query_syscalls: 1,
    });
  });

  it("fails the indexed-call ceiling before build or index data I/O and replays it", async () => {
    const current = await scenario("o10a_query_ceiling", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index handle.");
    }
    await persistence.query(
      `update fx_system_tx_journal
          set indexed_query_syscalls = $2
        where session_id = $1`,
      [current.anchor.sessionId, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1],
    );
    await persistence.query(
      `update fx_system_index_build_state
          set lifecycle = 'declared'
        where scope_id = $1`,
      [current.anchor.scopeId],
    );
    const request = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      request,
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "indexedQuerySyscalls",
        observed: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 + 1,
      },
    });
    await expect(runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      request,
    ))).resolves.toMatchObject({
      kind: "rejected",
      delivery: "replayed",
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      last_syscall_sequence: "1",
      failure_dimension: "indexedQuerySyscalls",
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toEqual([{ count: 0 }]);
  });

  it("rejects indexed replay and sticky receipts that disagree with the root", async () => {
    const replay = await scenario("o10a_replay_root_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (replay.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await runEffect(replay.store.runIndexedQueryEffect(
      replay.developerIndex,
      operation,
    ));
    await persistence.query(
      `update fx_system_tx_journal
          set state = 'failed', failure_dimension = 'indexedQuerySyscalls'
        where session_id = $1`,
      [replay.anchor.sessionId],
    );
    const replayFailure = await runFailure(
      replay.store.runIndexedQueryEffect(replay.developerIndex, operation),
    );
    expect(replayFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(replayFailure).toMatchObject({
      reason: "failedJournalReceiptInvalid",
    });

    const sticky = await scenario("o10a_sticky_root_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (sticky.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    await persistence.query(
      `update fx_system_tx_journal
          set indexed_query_syscalls = $2
        where session_id = $1`,
      [sticky.anchor.sessionId, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1],
    );
    await runEffect(sticky.store.runIndexedQueryEffect(
      sticky.developerIndex,
      operation,
    ));
    const wrongLimit = await canonicalizeFlarexValueV1({
      kind: "error",
      reason: "limitExceeded",
      dimension: "readDocuments",
      observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
    });
    await persistence.query(
      `update fx_system_tx_journal_receipt
          set outcome_bytes = $2, outcome_sha256 = $3
        where session_id = $1`,
      [
        sticky.anchor.sessionId,
        wrongLimit.canonicalBytes,
        wrongLimit.sha256,
      ],
    );
    const stickyFailure = await runFailure(
      sticky.store.runIndexedQueryEffect(sticky.developerIndex, {
        ...operation,
        syscallSequence: syscallSequence(2n),
      }),
    );
    expect(stickyFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(stickyFailure).toMatchObject({
      reason: "failedJournalReceiptInvalid",
    });
  });

  it("rejects indexed page receipts that violate the requested page shape", async () => {
    const current = await scenario("o10a_receipt_page_shape", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    await runEffect(current.store.runIndexedQueryEffect(
      current.developerIndex,
      operation,
    ));
    const malformedPages = [
      {
        kind: "indexRangePage",
        documentsValueJson: [{ name: "one" }, { name: "two" }],
        isDone: true,
      },
      {
        kind: "indexRangePage",
        documentsValueJson: [],
        isDone: false,
      },
    ] as const;
    for (const malformedPage of malformedPages) {
      const evidence = await canonicalizeFlarexValueV1(malformedPage);
      await persistence.query(
        `update fx_system_tx_journal_receipt
            set outcome_bytes = $2, outcome_sha256 = $3
          where session_id = $1`,
        [
          current.anchor.sessionId,
          evidence.canonicalBytes,
          evidence.sha256,
        ],
      );
      const failure = await runFailure(current.store.runIndexedQueryEffect(
        current.developerIndex,
        operation,
      ));
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure).toMatchObject({ reason: "latestReceiptEvidenceInvalid" });
    }
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
      indexed_query_syscalls: 1,
    });
  });

  it("rejects a snapshot document that no longer lowers to its stored index position", async () => {
    const current = await scenario("o10a_snapshot_position_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const mismatched = await canonicalizeAppDocumentV1({
      tableId: current.tableId,
      rowId: SEEDED_ROW_ID,
      creationTime: SEEDED_CREATION_TIME,
      fields: { name: "Zoe" },
    });
    await persistence.query(
      `update fx_app_row_rev
          set value_codec_version = $5,
              value_bytes = $6,
              value_sha256 = $7
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
          and table_id = $2
          and row_id = $3
          and commit_seq = $4`,
      [
        current.anchor.sessionId,
        current.tableId,
        appRowIdHexV1ToBytes(SEEDED_ROW_ID),
        1n,
        mismatched.codecVersion,
        mismatched.canonicalBytes,
        mismatched.sha256,
      ],
    );
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "indexedSnapshotPositionMismatch" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
    });
  });

  it("rejects an index entry whose stored table identity changed", async () => {
    const current = await scenario("o10a_index_table_mismatch", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (
      current.developerIndex === null ||
      current.developerIndexDefinition === null
    ) {
      throw new Error("Missing O10-A developer index authority.");
    }
    await seedSnapshotDocument(
      persistence,
      current.anchor.scopeId,
      current.otherTableId,
      current.schemaVersionId,
      { name: "Ada" },
    );
    await persistence.query(
      `update fx_app_index_entry_rev
          set table_id = $2
        where scope_uuid = (
          select scope_uuid from fx_system_tx_session where session_id = $1
        )
          and index_definition_id = $3`,
      [
        current.anchor.sessionId,
        current.otherTableId,
        current.developerIndexDefinition.indexDefinitionId,
      ],
    );
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "indexedSnapshotPositionMismatch" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      indexed_query_syscalls: 0,
    });
  });

  it("rolls back point and range evidence when the indexed query transaction fails", async () => {
    const current = await scenario("o10a_indexed_query_rollback", {
      seedFields: { name: "Ada" },
      developerIndex: true,
      journalFaultAfter: (point) => {
        if (point === "indexedQueryEvidenceWritten") {
          throw new Error("injected indexed-query evidence failure");
        }
      },
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const failure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(failure).toBeInstanceOf(SessionJournalPersistenceV1Error);
    expect(failure).toMatchObject({ operation: "runIndexedQuery" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      read_documents: 0,
      point_dependency_count: 0,
      indexed_query_syscalls: 0,
      index_range_dependency_count: 0,
      index_range_dependency_evidence_bytes: 0,
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 0,
      points: 0,
    });
    const ranges = await persistence.query<{ readonly count: number }>(
      `select count(*)::int as count
         from fx_system_tx_journal_index_range
        where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(ranges.rows).toEqual([{ count: 0 }]);
  });

  it("rejects root range counters that disagree with durable child evidence", async () => {
    const cases = [
      {
        label: "count",
        column: "index_range_dependency_count",
        reason: "indexRangeDependencyCountMismatch",
      },
      {
        label: "bytes",
        column: "index_range_dependency_evidence_bytes",
        reason: "indexRangeDependencyEvidenceBytesMismatch",
      },
    ] as const;
    for (const testCase of cases) {
      const current = await scenario(`o10a_range_root_${testCase.label}`, {
        seedFields: { name: "Ada" },
        developerIndex: true,
      });
      if (current.developerIndex === null) {
        throw new Error("Missing O10-A developer index authority.");
      }
      await persistence.query(
        `update fx_system_tx_journal
            set ${testCase.column} = 1
          where session_id = $1`,
        [current.anchor.sessionId],
      );
      const failure = await runFailure(current.store.runIndexedQueryEffect(
        current.developerIndex,
        {
          kind: "indexRange",
          syscallSequence: syscallSequence(1n),
          bounds: Object.freeze({}),
          limit: 1,
        },
      ));
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure).toMatchObject({ reason: testCase.reason });
      expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
        state: "open",
        last_syscall_sequence: "0",
        indexed_query_syscalls: 0,
        index_range_dependency_count: testCase.label === "count" ? 1 : 0,
        index_range_dependency_evidence_bytes:
          testCase.label === "bytes" ? 1 : 0,
      });
      expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
        receipts: 0,
        points: 0,
      });
    }
  });

  it("rejects durable range rows stored outside canonical ordinal order", async () => {
    const current = await scenario("o10a_range_order", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    for (const [offset, bounds] of [
      { startInclusive: "10", endExclusive: "20" },
      { startInclusive: "30", endExclusive: "40" },
    ].entries()) {
      await runEffect(current.store.runIndexedQueryEffect(
        current.developerIndex,
        {
          kind: "indexRange",
          syscallSequence: syscallSequence(BigInt(offset + 1)),
          bounds: Object.freeze({
            startInclusive: decodeOrderedIndexBoundHexV1(bounds.startInclusive),
            endExclusive: decodeOrderedIndexBoundHexV1(bounds.endExclusive),
          }),
          limit: 1,
        },
      ));
    }
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 31
        where session_id = $1 and ordinal = 0`,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 0
        where session_id = $1 and ordinal = 1`,
      [current.anchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_journal_index_range
          set ordinal = 1
        where session_id = $1 and ordinal = 31`,
      [current.anchor.sessionId],
    );
    const queryFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      {
        kind: "indexRange",
        syscallSequence: syscallSequence(3n),
        bounds: Object.freeze({}),
        limit: 1,
      },
    ));
    expect(queryFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(queryFailure).toMatchObject({ reason: "indexRangeDependencyInvalid" });
    const sealFailure = await runFailure(
      current.store.prepareSealEffect(current.attempt),
    );
    expect(sealFailure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
    expect(sealFailure).toMatchObject({ reason: "indexRangeDependencyInvalid" });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "2",
      index_range_dependency_count: 2,
    });
  });

  it("preserves range conversion failure order and the underlying row identity error", async () => {
    const current = await scenario("index_range_decoder_failure_order", {
      seedFields: { name: "Ada" },
      additionalSeedFields: { name: "Zoe" },
      developerIndex: true,
    });
    if (current.developerIndex === null)
      throw new Error("Missing developer index handle.");
    await runEffect(
      current.store.runIndexedQueryEffect(current.developerIndex, {
        kind: "indexRange",
        syscallSequence: syscallSequence(1n),
        bounds: {},
        limit: 1,
      }),
    );
    const rows = await persistence.drizzle
      .select()
      .from(fxSystemTransactionJournalIndexRanges)
      .where(
        eq(
          fxSystemTransactionJournalIndexRanges.sessionId,
          current.anchor.sessionId,
        ),
      );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.upperKind).toBe("position_inclusive");
    const state = await runEffect(
      Effect.fromResult(
        captureAttemptStateResult({
          selector: selectorFromAnchor(current.anchor),
          snapshotToken: current.anchor.snapshotToken,
          schemaVersionId: current.schemaVersionId,
          executionClaim: current.executionClaim,
        }),
      ),
    );
    await expect(
      runEffect(decodeStoredIndexRangeRowsEffect(state, rows)),
    ).resolves.toHaveLength(1);
    const counts = await journalCounts(current.anchor.sessionId);

    // The source decoder receives actual driver row snapshots. Corrupt their
    // transport projection here; no malformed state is persisted or protected CHECK bypassed.
    const fieldOrder = [
      "tableId",
      "indexDefinitionId",
      "keyCodecVersion",
      "physicalSpecSha256",
      "direction",
      "lowerKind",
      "lowerEncodedKey",
      "upperKind",
      "upperKind",
      "upperEncodedKey",
      "upperRowId",
    ] as const;
    const uniqueFields = [...new Set(fieldOrder)];
    for (const failedField of [...uniqueFields, "invalidRowId"] as const) {
      const visited: string[] = [];
      const sentinel = new Error("range transport " + failedField);
      const laterSentinel = new Error("later row identity transport failure");
      const transported = {
        ...row,
        lowerKind: "key_inclusive" as const,
        lowerEncodedKey: row.upperEncodedKey,
      };
      for (const field of uniqueFields) {
        Object.defineProperty(transported, field, {
          get: () => {
            visited.push(field);
            if (field === failedField) throw sentinel;
            // A competing later fault must never displace the first getter failure.
            if (field === "upperRowId" && failedField !== "invalidRowId") {
              throw laterSentinel;
            }
            if (field === "upperRowId") return new Uint8Array(15);
            if (field === "lowerKind") return "key_inclusive";
            if (field === "lowerEncodedKey") return row.upperEncodedKey;
            return row[field];
          },
        });
      }
      const failure = await runFailure(
        decodeStoredIndexRangeRowsEffect(state, [transported]),
      );
      expect(failure).toBeInstanceOf(SessionJournalStorageCorruptionV1Error);
      expect(failure.reason).toBe("indexRangeDependencyInvalid");
      expect(visited).toEqual(
        failedField === "invalidRowId"
          ? fieldOrder
          : fieldOrder.slice(0, fieldOrder.indexOf(failedField) + 1),
      );
      if (failedField === "invalidRowId") {
        expect(failure.cause).toBeInstanceOf(OrderedIndexCodecV1InputError);
        expect(failure.cause).toMatchObject({
          issue: {
            reason: "invalidValue",
            path: "$rowId",
            detail: "row identity must contain exactly 16 bytes",
          },
        });
      } else {
        expect(failure.cause).toBe(sentinel);
      }
      visited.length = 0;
      const countFailure = await runFailure(
        decodeStoredIndexRangeRowsEffect(
          state,
          Array.from(
            { length: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1 },
            () => transported,
          ),
        ),
      );
      expect(countFailure.reason).toBe("indexRangeDependencyCountMismatch");
      expect(visited).toEqual([]);
    }
    const ordinalSentinel = new Error(
      "physical conversion must follow ordinal admission",
    );
    const wrongOrdinal = { ...row, ordinal: 1 };
    Object.defineProperty(wrongOrdinal, "physicalSpecSha256", {
      get: () => {
        throw ordinalSentinel;
      },
    });
    const ordinalFailure = await runFailure(
      decodeStoredIndexRangeRowsEffect(state, [wrongOrdinal]),
    );
    expect(ordinalFailure.reason).toBe("indexRangeDependencyInvalid");
    expect(ordinalFailure.cause).toBeUndefined();
    expect(await journalCounts(current.anchor.sessionId)).toEqual(counts);
  });

  it("preserves a fresh pre-staging outcome hash defect before same-fence retry", async () => {
    const current = await scenario("fresh_outcome_pre_staging_defect");
    const request = Object.freeze({
      kind: "get" as const,
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 103),
    });
    const rootBefore = await journalRoot(current.anchor.sessionId);
    const countsBefore = await journalCounts(current.anchor.sessionId);
    const defect = new Error("fresh outcome hashing unavailable");
    const nativeDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementationOnce(nativeDigest)
      .mockRejectedValueOnce(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      );
      expect(digest).toHaveBeenCalledTimes(2);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason))
          expect(reason.defect).toBe(defect);
      }
      expect(await journalRoot(current.anchor.sessionId)).toEqual(rootBefore);
      expect(await journalCounts(current.anchor.sessionId)).toEqual(countsBefore);
    } finally {
      digest.mockRestore();
    }
    await expect(
      runEffect(
        current.store.runPointOperationEffect(
          current.table,
          request,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
      ),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing" },
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
      events: 0,
    });
  });

  it("preserves a post-staging receipt hash defect and rolls back before same-fence retry", async () => {
    const defect = new Error("post-staging receipt hashing unavailable");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    let staged = 0;
    let injectDefect = true;
    const current = await scenario("indexed_receipt_post_staging_defect", {
      seedFields: { name: "Ada" },
      developerIndex: true,
      journalFaultAfter: (point) => {
        if (point === "indexedQueryEvidenceWritten") {
          staged += 1;
          // The real transaction has written point/range rows before this hook.
          // Its next hash is the accepted receipt outcome canonicalization.
          if (injectDefect) {
            injectDefect = false;
            digest.mockRejectedValueOnce(defect);
          }
        }
      },
    });
    if (current.developerIndex === null)
      throw new Error("Missing developer index handle.");
    const operation = Object.freeze({
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      bounds: Object.freeze({}),
      limit: 1,
    });
    const rootBefore = await journalRoot(current.anchor.sessionId);
    const countsBefore = await journalCounts(current.anchor.sessionId);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.runIndexedQueryEffect(current.developerIndex, operation),
      );
      expect(staged).toBe(1);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason)) {
          expect(reason.defect).toBe(defect);
        }
      }
      expect(await journalRoot(current.anchor.sessionId)).toEqual(rootBefore);
      expect(await journalCounts(current.anchor.sessionId)).toEqual(countsBefore);
      const ranges = await persistence.drizzle
        .select()
        .from(fxSystemTransactionJournalIndexRanges)
        .where(
          eq(
            fxSystemTransactionJournalIndexRanges.sessionId,
            current.anchor.sessionId,
          ),
        );
      expect(ranges).toEqual([]);
    } finally {
      digest.mockRestore();
    }
    await expect(
      runEffect(
        current.store.runIndexedQueryEffect(current.developerIndex, operation),
      ),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { documents: [{ name: "Ada" }], isDone: true },
    });
    expect(staged).toBe(2);
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 1,
      points: 1,
      events: 0,
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "1",
      indexed_query_syscalls: 1,
      point_dependency_count: 1,
      index_range_dependency_count: 1,
    });
  });

  it("maps malformed or throwing indexed bounds to invalid input", async () => {
    const current = await scenario("o10a_invalid_bounds", {
      seedFields: { name: "Ada" },
      developerIndex: true,
    });
    if (current.developerIndex === null) {
      throw new Error("Missing O10-A developer index authority.");
    }
    const common = {
      kind: "indexRange" as const,
      syscallSequence: syscallSequence(1n),
      limit: 1,
    };
    const nullBounds = {
      ...common,
      bounds: null,
    } as unknown as SessionJournalIndexedQueryOperationV1;
    const nullFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      nullBounds,
    ));
    expect(nullFailure).toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(nullFailure).toMatchObject({
      operation: "indexRange",
      reason: "invalidOperation",
    });

    const getterFailure = new Error("injected bound getter failure");
    const throwingBounds = Object.defineProperty({}, "startInclusive", {
      enumerable: true,
      get: () => {
        throw getterFailure;
      },
    });
    const throwingOperation = {
      ...common,
      bounds: throwingBounds,
    } as unknown as SessionJournalIndexedQueryOperationV1;
    const thrownFailure = await runFailure(current.store.runIndexedQueryEffect(
      current.developerIndex,
      throwingOperation,
    ));
    expect(thrownFailure).toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(thrownFailure).toMatchObject({
      operation: "indexRange",
      reason: "invalidOperation",
      cause: getterFailure,
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "open",
      last_syscall_sequence: "0",
      indexed_query_syscalls: 0,
    });
  });


});
