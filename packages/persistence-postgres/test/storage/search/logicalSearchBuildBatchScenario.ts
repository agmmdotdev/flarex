import { Cause, Effect, Exit, Result, Schema } from "effect";
import { eq, fillPlaceholders } from "drizzle-orm";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogIndexId, decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../../../src";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../../../src/storage/documents/appRows";
import { makeLogicalSearchReadinessInspector, prepareLogicalSearchBuild } from "../../../src/storage/search/logicalSearchBuild";
import { readIndexCoverageContextInTransactionEffect, readIndexCoverageTableFrontiersInTransactionEffect, type IndexCoverageContext } from "../../../src/storage/indexes/indexBuildStates";
import { fxSystemScopeClocks, fxSystemSearchBuildStates } from "../../../src/database/schema";
import { getScopeClock } from "../../../src/scope/scopeClock";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import type { TrustedScopeAuthority } from "../../../src/scope/scopeAuthorityResolution";

// The control-catalog preparation is isolated here so this scenario exercises
// the target-local SQL with arbitrary selected definitions, independent of a
// framework's source names. Connected compiled-source proofs run separately.
const selected = vi.hoisted(() => [
  { tableId: 11, logicalIndexId: 101, kind: "jsonContainment", sourceSha256: "a".repeat(64) },
  { tableId: 11, logicalIndexId: 102, kind: "text", sourceSha256: "a".repeat(64) },
  { tableId: 12, logicalIndexId: 103, kind: "text", sourceSha256: "b".repeat(64) },
  { tableId: 13, logicalIndexId: 104, kind: "jsonContainment", sourceSha256: "c".repeat(64) },
  ...Array.from({ length: 66 }, (_, index) => ({
    tableId: 11 + index % 3,
    logicalIndexId: 105 + index,
    kind: index % 2 === 0 ? "text" : "jsonContainment",
    sourceSha256: ["a", "b", "c"][index % 3]!.repeat(64),
  })),
]);

vi.mock("../../../src/storage/catalog/logicalStorageDefinitions", async importOriginal => {
  const { Effect } = await import("effect");
  const original = await importOriginal<typeof import("../../../src/storage/catalog/logicalStorageDefinitions")>();
  return { ...original, readLogicalStorageRequirements: () => Effect.succeed({ search: selected.map(definition => ({
    ...definition, descriptor: { id: definition.logicalIndexId },
  })) }) };
});
vi.mock("../../../src/storage/catalog/stableLogicalIndexCatalog", async importOriginal => {
  const { Effect } = await import("effect");
  const original = await importOriginal<typeof import("../../../src/storage/catalog/stableLogicalIndexCatalog")>();
  return { ...original, getStableLogicalIndexIdentityByNameEffect: (_db: unknown, input: { descriptor: { id: number } }) =>
    Effect.succeed({ logicalIndexId: input.descriptor.id }) };
});

const scopeId = ScopeIdSchema.make("scope_66100000-0000-0000-0000-000000000001");
const epoch = ScopeEpochSchema.make("epoch_66100000-0000-0000-0000-000000000002");
const schemaVersionId = decodeCatalogSchemaVersionId("search_batch_neutral");

interface InspectCounts { states: number; physical: number; frontiers: number; acceptance: number }
interface NativeCaptureObservation { statement: string; parameters: unknown[]; capture: string }
const decodeFrontierDriverResponse = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));
const decodeNativeCaptureRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ capture: Schema.String })));
const decodeCapturedStateMap = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));
const decodeExplainResponse = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ Plan: Schema.Unknown })));
const decodeExplainNode = Schema.decodeUnknownSync(Schema.Struct({
  "Node Type": Schema.String,
  "Relation Name": Schema.optional(Schema.String),
  "Index Name": Schema.optional(Schema.String),
  "Index Cond": Schema.optional(Schema.String),
  "Actual Rows": Schema.Number,
  "Actual Loops": Schema.Number,
  "Rows Removed by Filter": Schema.optional(Schema.Number),
  Plans: Schema.optional(Schema.Array(Schema.Unknown)),
}));

/** Observe actual native capture and count any obsolete pure dispatch. */
function observeTransaction(tx: FlarexMetadataTransaction, counts: InspectCounts,
  failFrontiers = false, corruptFrontierOrdinal?: number,
  captures?: NativeCaptureObservation[], changeCapture?: (capture: string) => string,
  physicalFault?: (row: object) => void): FlarexMetadataTransaction {
  const session = tx._.session;
  const observedSession = new Proxy(session, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (property !== "prepareQuery" || typeof member !== "function")
        return typeof member === "function" ? member.bind(target) : member;
      return (...args: Parameters<typeof session.prepareQuery>) => {
        const statement = args[0].sql;
        const stage = statement.includes("jsonb_object_agg") && statement.includes("fx_system_search_build_state") ? "capture" : undefined;
        if (stage === "capture") counts.states++;
        if (statement.includes("fx_accept_ordinary_")) counts.acceptance++;
        const isPhysical=statement.includes("search_index_probe");
        if (isPhysical) counts.physical++;
        const prepared = target.prepareQuery(...args);
        if ((stage === undefined || (captures === undefined && changeCapture === undefined)) && (!isPhysical || physicalFault === undefined)) return prepared;
        // Plain PgSelect._prepare calls setToken(), which returns the native
        // prepared object. A Proxy that binds setToken to that object loses its
        // execute interception. Fault the ephemeral native method itself so the
        // genuine plain physical probe and fixed capture both retain the hook.
        const execute=prepared.execute.bind(prepared);
        Object.defineProperty(prepared,"execute",{configurable:true,
          value:async (...bindings:Parameters<typeof prepared.execute>)=> {
            const rows=await execute(...bindings);
            if (isPhysical && physicalFault!==undefined) {
              if (!Array.isArray(rows) || typeof rows[0]!=="object" || rows[0]===null)
                throw new Error("Missing actual physical search result");
              physicalFault(rows[0]);
            }
            if (stage==="capture" && changeCapture!==undefined) {
              const [captured]=decodeNativeCaptureRows(rows);
              if (captured===undefined || !Array.isArray(rows) || typeof rows[0]!=="object" || rows[0]===null)
                throw new Error("Missing actual captured search progress");
              Object.defineProperty(rows[0],"capture",{value:changeCapture(captured.capture)});
            }
            if (stage==="capture" && captures!==undefined) {
              const capturedRows=decodeNativeCaptureRows(rows);
              expect(capturedRows).toHaveLength(1);
              const captured=capturedRows[0];
              if (captured===undefined) throw new Error("Missing actual native search capture");
              captures.push({statement,parameters:fillPlaceholders(args[0].params,bindings[0]??{}),capture:captured.capture});
            }
            return rows;
          },
        });
        return prepared;
      };
    },
  });
  const metadata = new Proxy(tx._, {
    get(target, property, receiver) {
      return property === "session" ? observedSession : Reflect.get(target, property, receiver);
    },
  });
  return new Proxy(tx, {
    get(target, property, receiver) {
      if (property === "_") return metadata;
      // Native selects use this.session; code-defined captures use _.session.
      if (property === "session") return observedSession;
      if (property === "execute") return (statement: Parameters<typeof target.execute>[0]) => {
        counts.frontiers++;
        if (failFrontiers) return Promise.reject(new Error("Later frontier query must not run"));
        const query = target.execute(statement);
        if (corruptFrontierOrdinal === undefined) return query;
        // Corrupt only one actual driver field. The real frontier decoder and
        // issuer retain the per-table failure; no readiness verdict is mocked.
        return query.then(result => {
          const response = decodeFrontierDriverResponse(result);
          return { ...response, rows: response.rows.map((row, ordinal) => ordinal === corruptFrontierOrdinal
            ? { ordinal, commitSeqText: "not-an-integer" } : row) };
        });
      };
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Same multi-table, multi-descriptor serving/refusal witness on both drivers. */
export async function verifyLogicalSearchBuildBatch(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  lookupPlanReader?: Pick<FlarexPersistence, "query">,
) {
  await persistence.query(
    `with created as (
       insert into fx_system_scope_clock (scope_id) values ($1) returning scope_id
     ) insert into fx_system_scope_execution_authority (scope_id, storage_generation, epoch)
       select scope_id, 'flarexdb_v1', $2 from created`,
    [scopeId, epoch],
  );
  const clock = await getScopeClock(db, scopeId);
  if (clock === null) throw new Error("Missing search fixture clock");
  const authority: TrustedScopeAuthority = {
    deploymentId: "neutral_search_deployment", scopeId,
    physicalLocator: { kind: "shared_database", databaseKey: "search-batch", schemaName: "public" },
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch, lastCommitSeq: clock.lastCommitSeq,
  };
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  await db.insert(fxSystemSearchBuildStates).values(selected.map(definition => ({
    scopeUuid, tableId: decodeCatalogTableId(definition.tableId),
    logicalIndexId: decodeCatalogIndexId(definition.logicalIndexId),
    sourceSha256: definition.sourceSha256, lifecycle: "ready" as const,
    coveredThroughCommitSeq: CommitSeqSchema.make(0n),
  })));
  // Crossed pairs would be included by independent table/index IN predicates,
  // despite neither pair belonging to the selected topology.
  await db.insert(fxSystemSearchBuildStates).values([
    { tableId: decodeCatalogTableId(12), logicalIndexId: decodeCatalogIndexId(101) },
    { tableId: decodeCatalogTableId(11), logicalIndexId: decodeCatalogIndexId(103) },
  ].map(pair => ({ ...pair, scopeUuid, sourceSha256: "e".repeat(64), lifecycle: "ready" as const,
    coveredThroughCommitSeq: CommitSeqSchema.make(0n) })));
  if (lookupPlanReader !== undefined) {
    // Retained-state scale is intentional fixture SQL. ANALYZE supplies real
    // statistics; no planner settings force the expected access path.
    await persistence.query(`insert into fx_system_search_build_state
      (scope_uuid,table_id,logical_index_id,source_sha256,lifecycle,covered_through_commit_seq)
      select $1::uuid,11+(position%3),10000+position,repeat('e',64),'ready',0
      from generate_series(1,32768) as retained(position)`, [scopeUuid]);
    await persistence.query("analyze fx_system_search_build_state");
  }
  const build = await Effect.runPromise(prepareLogicalSearchBuild(db, authority.deploymentId, schemaVersionId, { kind: "fresh" }));
  expect(build.definitionCount).toBe(70);
  const inspect = (atClock = clock, failFrontiers = false, coverage?: IndexCoverageContext,
    captureObservation?: NativeCaptureObservation[]) => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0, acceptance: 0 };
    return db.transaction(async tx => ({
      verdict: await Effect.runPromise(build.inspect(observeTransaction(tx, counts, failFrontiers, undefined, captureObservation), authority, atClock, coverage)),
      counts,
    }));
  };
  const initialCaptures: NativeCaptureObservation[] = [];
  const initial = await inspect(clock, false, undefined, initialCaptures);
  expect(initial.verdict).toEqual({ status: "ready", definitionCount: 70 });
  expect(initial.counts).toEqual({ states: 2, physical: 1, frontiers: 1, acceptance: 0 });
  expect(initialCaptures).toHaveLength(2);
  const inspectCompact = (changeCapture: (capture: string) => string) => db.transaction(async tx => {
    const counts: InspectCounts={states:0,physical:0,frontiers:0,acceptance:0};
    const verdict=await Effect.runPromise(Effect.result(build.inspect(
      observeTransaction(tx,counts,false,undefined,undefined,changeCapture),authority,clock)));
    return {verdict,counts};
  });
  const malformedFirst=await inspectCompact(capture=>JSON.stringify({...decodeCapturedStateMap(capture),"11/101":"malformed"}));
  expect(malformedFirst.verdict).toMatchObject({_tag:"Failure",failure:{reason:"statementFailure"}});
  expect(malformedFirst.counts).toEqual({states:1,physical:0,frontiers:0,acceptance:0});
  const missBeforeMalformed=await inspectCompact(capture=>JSON.stringify({...decodeCapturedStateMap(capture),
    "11/101":["declared","a".repeat(64),"0"],"11/102":"malformed"}));
  expect(missBeforeMalformed.verdict).toMatchObject({_tag:"Success",success:{status:"not_ready",reason:"uncovered"}});
  expect(missBeforeMalformed.counts).toEqual({states:1,physical:0,frontiers:0,acceptance:0});
  const physicalGetterMarker=new Error("original text physical getter before JSON");
  let physicalFaultApplications=0;
  const physicalGetter=await db.transaction(async tx=> {
    const counts:InspectCounts={states:0,physical:0,frontiers:0,acceptance:0};
    const exit=await Effect.runPromise(Effect.exit(build.inspect(observeTransaction(tx,counts,false,undefined,undefined,undefined,row=> {
      physicalFaultApplications++;
      Object.defineProperty(row,"textReady",{get(){throw physicalGetterMarker;}});
      Object.defineProperty(row,"jsonReady",{get(){throw new Error("Later physical JSON getter must remain unvisited");}});
    }),authority,clock)));
    return {exit,counts};
  });
  expect(physicalFaultApplications).toBe(1);
  if (!Exit.isFailure(physicalGetter.exit)) throw new Error("Physical getter defect accepted");
  expect(Cause.hasFails(physicalGetter.exit.cause)).toBe(false);
  expect(Result.getOrThrow(Cause.findDefect(physicalGetter.exit.cause))).toBe(physicalGetterMarker);
  expect(physicalGetter.counts).toEqual({states:1,physical:1,frontiers:0,acceptance:0});
  for (const [ordinal, captured] of initialCaptures.entries()) {
    const batch = selected.slice(ordinal * 64, (ordinal + 1) * 64);
    expect(Object.keys(decodeCapturedStateMap(captured.capture)).sort())
      .toEqual(batch.map(definition => `${definition.tableId}/${definition.logicalIndexId}`).sort());
    if (lookupPlanReader === undefined) continue;
    // Explain the exact statement and bindings issued by the real capture,
    // through the serving login (including the restricted nonowner lane).
    const explained = await lookupPlanReader.query<{ "QUERY PLAN": unknown }>(
      `explain (analyze, buffers, format json) ${captured.statement}`, captured.parameters);
    const pending = decodeExplainResponse(explained.rows[0]?.["QUERY PLAN"]).map(root => root.Plan);
    const nodes: ReturnType<typeof decodeExplainNode>[] = [];
    while (pending.length !== 0) {
      const node = decodeExplainNode(pending.pop());
      nodes.push(node);
      pending.push(...(node.Plans ?? []));
    }
    const stateScans = nodes.filter(node => node["Relation Name"] === "fx_system_search_build_state");
    const diagnostic = JSON.stringify(nodes);
    expect(stateScans, diagnostic).toHaveLength(1);
    for (const scan of stateScans) {
      expect(scan["Node Type"], diagnostic).toMatch(/^Index( Only)? Scan$/);
      expect(scan["Index Name"], diagnostic).toBe("fx_system_search_build_state_pk");
      for (const column of ["scope_uuid", "table_id", "logical_index_id"])
        expect(scan["Index Cond"], diagnostic).toContain(column);
      expect(scan["Actual Rows"], diagnostic).toBeLessThanOrEqual(1);
      expect(scan["Actual Loops"], diagnostic).toBeLessThanOrEqual(batch.length);
      expect(scan["Actual Rows"] * scan["Actual Loops"], diagnostic).toBeLessThanOrEqual(batch.length);
      expect(scan["Rows Removed by Filter"] ?? 0, diagnostic).toBe(0);
    }
  }
  // Tuple membership captures one native row for a repeated pair, while the
  // ordered acceptance fold still consumes both definition occurrences.
  const repeated = build.selectedDefinition(decodeCatalogIndexId(101));
  if (repeated === undefined) throw new Error("Missing repeated search definition fixture");
  const repeatedCaptures: NativeCaptureObservation[] = [];
  const repeatedCounts: InspectCounts = { states: 0, physical: 0, frontiers: 0, acceptance: 0 };
  const inspectRepeated = makeLogicalSearchReadinessInspector(authority.deploymentId);
  expect(await db.transaction(tx => Effect.runPromise(inspectRepeated([repeated, repeated],
    observeTransaction(tx, repeatedCounts, false, undefined, repeatedCaptures), authority, clock))))
    .toEqual({ status: "ready", definitionCount: 2 });
  expect(repeatedCounts).toEqual({ states: 1, physical: 1, frontiers: 1, acceptance: 0 });
  expect(repeatedCaptures).toHaveLength(1);
  for (const captured of repeatedCaptures)
    expect(Object.keys(decodeCapturedStateMap(captured.capture))).toEqual([`${repeated.tableId}/${repeated.logicalIndexId}`]);
  let foreignCoverage: IndexCoverageContext | undefined;
  await db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0, acceptance: 0 };
    const observed = observeTransaction(tx, counts);
    const coverage = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    foreignCoverage = coverage;
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, coverage,
      [11, 12, 13].map(value => decodeCatalogTableId(value))));
    const beforeSearch = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority, clock, coverage)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforeSearch);
    const beforeChangedClock = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority,
      { ...clock, updatedAt: new Date(clock.updatedAt.getTime() + 1) }, coverage)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforeChangedClock + 1);
    // A legitimate proof lacking one selected table cannot lend a partial map.
    const partial = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, partial,
      [decodeCatalogTableId(11)]));
    const beforePartial = counts.frontiers;
    expect(await Effect.runPromise(build.inspect(observed, authority, clock, partial)))
      .toEqual({ status: "ready", definitionCount: 70 });
    expect(counts.frontiers).toBe(beforePartial + 1);
  });
  await db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0, acceptance: 0 };
    const verdict = await Effect.runPromise(Effect.result(build.inspect(observeTransaction(tx, counts), authority, clock, foreignCoverage)));
    expect(verdict).toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
    expect(counts).toEqual({ states: 1, physical: 1, frontiers: 0, acceptance: 0 });
  });
  const inspectPrefetchedCorruptFrontier = (tableIds = [11, 12, 13]) => db.transaction(async tx => {
    const counts: InspectCounts = { states: 0, physical: 0, frontiers: 0, acceptance: 0 };
    const observed = observeTransaction(tx, counts, false, 2);
    const coverage = await Effect.runPromise(readIndexCoverageContextInTransactionEffect(observed, clock));
    await Effect.runPromise(readIndexCoverageTableFrontiersInTransactionEffect(observed, coverage,
      [11, 12, 13].map(value => decodeCatalogTableId(value))));
    expect(counts.frontiers).toBe(1);
    const beforeSearch = { ...counts };
    const verdict = await Effect.runPromise(Effect.result(build.selectTables(tableIds.map(value => decodeCatalogTableId(value)))
      .inspectSelected(observed, authority, clock, coverage)));
    return { verdict, counts: { states: counts.states - beforeSearch.states,
      physical: counts.physical - beforeSearch.physical, frontiers: counts.frontiers - beforeSearch.frontiers,
      acceptance: counts.acceptance - beforeSearch.acceptance } };
  });
  const corruptLater = await inspectPrefetchedCorruptFrontier();
  expect(corruptLater.verdict).toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
  expect(corruptLater.counts).toEqual({ states: 1, physical: 1, frontiers: 0, acceptance: 0 });
  // The same prefetched corrupt table does not contaminate another selection.
  expect((await inspectPrefetchedCorruptFrontier([11])).verdict)
    .toMatchObject({ _tag: "Success", success: { status: "ready", definitionCount: 24 } });
  const selectedTable = build.selectTables([decodeCatalogTableId(11)]);
  const inspectSelected = () => db.transaction(tx => Effect.runPromise(selectedTable.inspectSelected(tx, authority, clock)));
  expect(await inspectSelected()).toEqual({ status: "ready", definitionCount: 24 });
  // A selected mutable miss is distinct from unrelated mutable state. Both
  // selections still authenticate their actual live physical GIN facts.
  const unrelated = await db.select().from(fxSystemSearchBuildStates)
    .where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(103)));
  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(103)));
  expect(await inspectSelected()).toEqual({ status: "ready", definitionCount: 24 });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.insert(fxSystemSearchBuildStates).values(unrelated);

  // A later transaction must reject a changed physical identity even when the
  // same prepared source selection and coverage rows are reused.
  await persistence.query("alter index fx_app_search_entry_current_lookup_gin rename to fx_test_changed_search_gin");
  try {
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
    const physicalBeforeCorruption = await inspectPrefetchedCorruptFrontier();
    expect(physicalBeforeCorruption.verdict).toMatchObject({ _tag: "Success", success: { status: "not_ready", reason: "uncovered" } });
    // The first JSON member passes its physical probe, then demands its own
    // frontier before the second member can refuse the changed text index.
    // The borrowed table-11 frontier is sound; later table-13 corruption must
    // remain behind the text refusal. Local acceptance consumes the original capture.
    expect(physicalBeforeCorruption.counts).toEqual({ states: 1, physical: 1, frontiers: 0, acceptance: 0 });
    const physicalBeforeMalformed=await inspectCompact(capture=>JSON.stringify({...decodeCapturedStateMap(capture),"12/103":"malformed"}));
    expect(physicalBeforeMalformed.verdict).toMatchObject({_tag:"Success",success:{status:"not_ready",reason:"uncovered"}});
    expect(physicalBeforeMalformed.counts).toEqual({states:1,physical:1,frontiers:1,acceptance:0});
    const coverageBeforePhysicalMiss=await inspectCompact(capture=>JSON.stringify({...decodeCapturedStateMap(capture),
      "11/101":["ready","a".repeat(64),"malformed"]}));
    expect(coverageBeforePhysicalMiss.verdict).toMatchObject({_tag:"Failure",failure:{reason:"statementFailure"}});
    expect(coverageBeforePhysicalMiss.counts).toEqual({states:1,physical:1,frontiers:1,acceptance:0});
    await persistence.query(`create index fx_app_search_entry_current_lookup_gin
      on fx_app_search_entry_current using gin
        (scope_uuid public.uuid_ops, logical_index_id public.int4_ops, field_id public.gin_trgm_ops)`);
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  } finally {
    await persistence.query("drop index if exists fx_app_search_entry_current_lookup_gin");
    await persistence.query("alter index fx_test_changed_search_gin rename to fx_app_search_entry_current_lookup_gin");
  }
  expect((await inspect()).verdict).toEqual({ status: "ready", definitionCount: 70 });

  // A same-name JSON index with a different operator class is not the
  // declared containment path, even though it remains a valid GIN index.
  await persistence.query("alter index fx_app_json_entry_current_lookup_gin rename to fx_test_changed_json_gin");
  try {
    await persistence.query(`create index fx_app_json_entry_current_lookup_gin
      on fx_app_json_entry_current using gin
        (scope_uuid public.uuid_ops, logical_index_id public.int4_ops, value_json jsonb_ops)`);
    expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
    expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  } finally {
    await persistence.query("drop index if exists fx_app_json_entry_current_lookup_gin");
    await persistence.query("alter index fx_test_changed_json_gin rename to fx_app_json_entry_current_lookup_gin");
  }
  expect((await inspect()).verdict).toEqual({ status: "ready", definitionCount: 70 });

  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(102)));
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  expect(await inspectSelected()).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.insert(fxSystemSearchBuildStates).values({
    scopeUuid, tableId: decodeCatalogTableId(11), logicalIndexId: decodeCatalogIndexId(102),
    sourceSha256: "d".repeat(64), lifecycle: "ready",
    coveredThroughCommitSeq: CommitSeqSchema.make(0n),
  });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.update(fxSystemSearchBuildStates).set({ sourceSha256: "a".repeat(64) })
    .where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(102)));

  const tableId = decodeCatalogTableId(13);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { title: "later" } });
  await db.transaction(async tx => {
    await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
    try {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live", scopeId, tableId, rowId, writeEpoch: epoch,
        commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, schemaVersionId,
        creationTime, value: { codecVersion: document.codecVersion, valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes, sha256: document.sha256 },
      });
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
        .where(eq(fxSystemScopeClocks.scopeId, scopeId));
    } finally { closeInstallationAdmission(tx); }
  });
  expect((await inspect()).verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  await db.update(fxSystemSearchBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(1n) })
    .where(eq(fxSystemSearchBuildStates.tableId, decodeCatalogTableId(13)));
  expect((await inspect(await getScopeClock(db, scopeId) ?? clock)).verdict)
    .toEqual({ status: "ready", definitionCount: 70 });

  // A known first-member refusal must finish before the later physical and
  // frontier statements, even when those statements would fail if reached.
  await db.delete(fxSystemSearchBuildStates).where(eq(fxSystemSearchBuildStates.logicalIndexId, decodeCatalogIndexId(101)));
  const missingFirst = await inspect(await getScopeClock(db, scopeId) ?? clock, true, foreignCoverage);
  expect(missingFirst.verdict).toEqual({ status: "not_ready", reason: "uncovered" });
  expect(missingFirst.counts).toEqual({ states: 1, physical: 0, frontiers: 0, acceptance: 0 });
  // An already-gathered later failure must not precede missing first state.
  const missingBeforeCorruption = await inspectPrefetchedCorruptFrontier();
  expect(missingBeforeCorruption.verdict).toMatchObject({ _tag: "Success", success: { status: "not_ready", reason: "uncovered" } });
  expect(missingBeforeCorruption.counts).toEqual({ states: 1, physical: 0, frontiers: 0, acceptance: 0 });
}
