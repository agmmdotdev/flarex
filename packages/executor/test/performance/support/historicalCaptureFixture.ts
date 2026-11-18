import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Effect, Schema } from "effect";
import type { Pool } from "pg";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import {
  encodeAdmittedFrameworkOperationV1Result,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import { makeBorrowedLogicalAttempt } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import {
  LogicalParticipantInvocationError,
} from "@flarex/persistence-postgres/internal/logical-participant-errors";
import type { FiniteStorageCaptureEnvelopes, FiniteStorageCaptureError,
  FiniteStorageCaptureOperation } from "../../../../persistence-postgres/src/execution/finiteStorageCapture";
import type {
  LogicalFiniteStorageCapture,
  LogicalStorageReadDemand,
} from "../../../../persistence-postgres/src/storage/documents/logicalDocuments/model";
import type {
  FiniteSessionJournalParticipantSelection,
} from "../../../../persistence-postgres/src/execution/journal/api";
import type {
  PostgresFixtureEndpoints,
} from "../../../../persistence-postgres/test/support/postgresHelpers";
import { inspectLogicalParticipantAttemptAdmission,
  projectFiniteStorageCaptureFailure } from "../../../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import {
  projectCommerceRequestFailure,
} from "../../../../persistence-postgres/src/frameworks/commerceTransaction/request";
import { findProducts } from "../../../../medusa-adapter/src/modules/product/query";
import type { ProductRuntimeMetadata } from "../../../../medusa-adapter/src/modules/product/runtime-metadata";
import { createMixedMutationProductFixture } from "./mixedMutationProductFixture";

type HistoricalOperation = Extract<FiniteStorageCaptureOperation, { kind: "indexPage" | "rows" }>;
type HistoricalEnvelope = FiniteStorageCaptureEnvelopes["indexPage" | "rows"];
/** Each of the nine source demands accepts membership, then captures its rows. */
export const HISTORICAL_CAPTURE_INPUTS_PER_PASS = 9 * 2;
const SelectedProductSeedSchema = Schema.Struct({ id: Schema.String,
  options: Schema.Array(Schema.Struct({ id: Schema.String,
    values: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })) })),
  tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
});
const decodeSelectedProductSeed = Schema.decodeUnknownEffect(SelectedProductSeedSchema);

export interface HistoricalCaptureCase {
  readonly ordinal: number;
  readonly id: string;
  readonly owner: string;
  readonly ancestry: readonly string[];
  readonly tableName: string;
  readonly operation: HistoricalOperation;
  readonly demand: LogicalStorageReadDemand;
  readonly expectedRows: number;
  readonly expectedBound: number;
}

/** The observer encloses exactly one original capture. The SDK retains its own
 * diagnostic faults and interrupts this isolated program under its stop policy. */
export type HistoricalCaptureObserver = <A>(captureCase: HistoricalCaptureCase,
  pass: 1 | 2, runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) =>
  Effect.Effect<A, FiniteStorageCaptureError>;

export interface HistoricalCapturePasses {
  readonly captureCount: number;
  readonly passCaptureCounts: readonly [number, number];
  readonly rootOutcome: "aborted";
  readonly workBytes: number;
  readonly workCalls: number;
  readonly changes: number;
  readonly events: number;
}

export interface HistoricalCaptureFixture {
  readonly pools: Readonly<{ target: Pool; setupControl: Pool; managedReadControl: Pool }>;
  readonly setup: Readonly<{ fixtureMilliseconds: number; provisioningMilliseconds: number;
    preparedModuleMilliseconds: number; initialSeedingMilliseconds: number }>;
  readonly runPasses: (observeCapture: HistoricalCaptureObserver) => Promise<HistoricalCapturePasses>;
  readonly close: () => Promise<void>;
}

type SourceCase = Readonly<{ id: string; tableName: string; owner: string;
  ancestry: readonly string[]; rows: number; unique: boolean }>;
type HistoricalCaptureBorrowLifecycle<Closed> =
  Pick<Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>, "withinDeadline" | "checkAfterNative"> &
    Readonly<{ close: Effect.Effect<Closed, CommerceTransactionError> }>;

/** Finish the deadline-owned read work before sealing its borrowed lifetime.
 * The outer admitted operation retains abort and root-discard ownership. */
export const runHistoricalCaptureInvocation: <ReadResult, Closed>(
  borrowed: HistoricalCaptureBorrowLifecycle<Closed>, readPasses: Effect.Effect<ReadResult, CommerceTransactionError>,
) => Effect.Effect<{ result: ReadResult; closed: Closed }, CommerceTransactionError> =
  Effect.fn("HistoricalCapture.invoke")(function* <ReadResult, Closed>(
  borrowed: HistoricalCaptureBorrowLifecycle<Closed>,
  readPasses: Effect.Effect<ReadResult, CommerceTransactionError>,
) {
  const result = yield* borrowed.withinDeadline(readPasses);
  yield* borrowed.checkAfterNative;
  const closed = yield* borrowed.close;
  return { result, closed };
});

/** Nine newly seeded source-equivalent demands. Literal parameters are derived
 * by the existing query/compiler owners, rather than recovered from an older
 * trace that did not retain them. Construction and native seed calls are setup. */
export async function createHistoricalCaptureFixture(input: Readonly<{
  postgresEndpoints: PostgresFixtureEndpoints; suffix: string;
  /** SDK setup runs after native preparation and before finite initial admission.
   * A rejection is drained by the existing prepared-context owner. */
  onPrepared?: (pools: HistoricalCaptureFixture["pools"]) => Promise<void>;
}>): Promise<HistoricalCaptureFixture> {
  let participant: FiniteSessionJournalParticipantSelection | undefined;
  let pools: HistoricalCaptureFixture["pools"] | undefined;
  const started = globalThis.performance.now();
  const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: input.suffix,
    postgresEndpoints: input.postgresEndpoints, hooks: {
      onPreparedContext: async currency => {
        const resource = currency.resource, managedRead = currency.managedRead;
        if (resource.kind !== "postgres" || managedRead === undefined)
          throw new Error("Historical capture requires the genuine installed PostgreSQL fixture");
        if (resource.target.pool === resource.control.pool || resource.target.pool === managedRead.control.pool ||
          resource.control.pool === managedRead.control.pool)
          throw new Error("Historical capture target, setup control and managed-read control pools must be distinct");
        pools = { target: resource.target.pool, setupControl: resource.control.pool, managedReadControl: managedRead.control.pool };
        await input.onPrepared?.(pools);
        return undefined;
      },
      transformFiniteEntrySources: participants => {
        participant = participants[0];
        return participants;
      },
    } });
  const fixtureMilliseconds = globalThis.performance.now() - started;
  try {
    if (pools === undefined || participant === undefined)
      throw new Error("Historical capture requires the genuine installed PostgreSQL fixture and original participant");
    const admittedParticipant = participant;
    const productSource = fixture.logicalSourceCatalog.source("medusa.product");
    const sourceTables = fixture.logicalSourceCatalog.sourceDefinitionTables("medusa.product");
    if (productSource === undefined || productSource.owner !== "medusa" || productSource.definition.kind !== "relational" ||
      sourceTables === undefined) throw new Error("Retained native Product source table identities are unavailable");
    const { catalog, seed } = fixture.seedGraph;
    const categoryRelation = catalog.queryRelations.get(catalog.product.table.name)?.get("categories");
    if (categoryRelation?.join.type !== "manyToMany")
      throw new Error("Native Product category pivot is unavailable");
    const categoryJoin = categoryRelation.join;
    const categoryPivot = catalog.tables.find(table => table.name === categoryJoin.pivotTable);
    const categorySourceColumn = categoryJoin.sourceColumns[0];
    const categoryTargetColumn = categoryJoin.targetColumns[0];
    const categoryPrimaryColumn = categoryRelation.targetPrimaryKeys[0];
    if (categoryPivot === undefined || categoryJoin.sourceColumns.length !== 1 ||
      categoryJoin.targetColumns.length !== 1 || categoryRelation.targetPrimaryKeys.length !== 1 ||
      categorySourceColumn === undefined || categoryTargetColumn === undefined || categoryPrimaryColumn === undefined)
      throw new Error("Native Product category loader requires one-column join metadata");
    const tagsRelation = catalog.queryRelations.get(catalog.product.table.name)?.get("tags");
    if (tagsRelation?.join.type !== "manyToMany") throw new Error("Native Product tag pivot is unavailable");
    const sources: readonly SourceCase[] = [
      { id: "product", tableName: catalog.product.table.name, rows: 1, unique: true,
        owner: "ProductAdapter.find", ancestry: ["findProducts", "executeRead", "store.find"] },
      { id: "product-option", tableName: catalog.option.table.name, rows: 1, unique: false,
        owner: "MedusaAdapter.populateRelations", ancestry: ["findProducts", "options", "readCommerceRelationRows"] },
      { id: "product-option-value", tableName: catalog.value.table.name, rows: 2, unique: false,
        owner: "MedusaAdapter.populateRelations", ancestry: ["findProducts", "options.values", "readCommerceRelationRows"] },
      { id: "product-tags", tableName: tagsRelation.join.pivotTable, rows: 1, unique: false,
        owner: "MedusaAdapter.populateRelations", ancestry: ["findProducts", "tags", "pivot", "readCommerceRelationRows"] },
      { id: "product-tag", tableName: catalog.tag.table.name, rows: 1, unique: true,
        owner: "MedusaAdapter.populateRelations", ancestry: ["findProducts", "tags", "target", "readCommerceRelationRows"] },
      { id: "product-variant", tableName: catalog.variant.table.name, rows: 1, unique: false,
        owner: "MedusaGraph.load", ancestry: ["replaceGraphRows", "load", "ProductVariant", "store.find"] },
      { id: "image", tableName: catalog.image.table.name, rows: 1, unique: false,
        owner: "MedusaGraph.load", ancestry: ["replaceGraphRows", "load", "ProductImage", "store.find"] },
      { id: "product-category-product", tableName: categoryPivot.name, rows: 1, unique: false,
        owner: "MedusaGraph.load", ancestry: ["replaceGraphRows", "load", "categories pivot", "store.find"] },
      { id: "product-category", tableName: categoryRelation.targetTable, rows: 1, unique: true,
        owner: "MedusaGraph.load", ancestry: ["replaceGraphRows", "load", "ProductCategory", "store.find"] },
    ];
    let used = false;
    const runPasses = async (observeCapture: HistoricalCaptureObserver): Promise<HistoricalCapturePasses> => {
      if (used) throw new Error("Historical capture fixture permits one two-pass admitted invocation");
      used = true;
      const captured: Array<Readonly<{ captureCase: HistoricalCaptureCase;
        runCapture: () => Effect.Effect<HistoricalEnvelope, FiniteStorageCaptureError>; first: HistoricalEnvelope }>> = [];
      const counts: [number, number] = [0, 0];
      let completion: HistoricalCapturePasses | undefined;
      const work = Effect.gen(function* () {
        const method = admittedParticipant.operationMethods[0];
        if (method === undefined) return yield* Effect.die("Original Product participant has no method");
        const admission = yield* fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt,
          { ...admittedParticipant, sources: admittedParticipant.sources.map(source =>
            ({ ...source, application: fixture.active.selection })) });
        const encoded = yield* Effect.fromResult(encodeAdmittedFrameworkOperationV1Result({
          format: "flarex.admitted-framework-operation", version: 1,
          participant: admittedParticipant.participant, operation: method, args: {},
        }));
        const request = { syscallSequence: CommitSyscallSequenceV1Schema.make(1n), requestBytes: encoded.bytes,
          requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
          participant: admittedParticipant.participant, method, profileRevision: admittedParticipant.profileRevision };
        const outcome = yield* fixture.store.runAdmittedOperationEffect(fixture.persistenceAttempt, admission, request,
          borrowInput => Effect.gen(function* () {
            if (borrowInput.captureStorage === undefined || borrowInput.admissions[0] === undefined)
              return yield* Effect.die("Historical capture requires the genuine finite borrowed storage owner");
            const sourceAdmission = inspectLogicalParticipantAttemptAdmission(borrowInput.admissions[0],
              borrowInput.attempt, borrowInput.method);
            if (sourceAdmission === null || sourceAdmission.sourceKey !== productSource.key ||
              sourceAdmission.sourceSha256 !== productSource.sourceSha256)
              return yield* Effect.die("Historical capture requires the genuine admitted native Product source");
            const originalCapture = borrowInput.captureStorage;
            const observe = <A>(captureCase: HistoricalCaptureCase, pass: 1 | 2,
              runCapture: () => Effect.Effect<A, FiniteStorageCaptureError>) => {
              let submitted = false;
              return observeCapture(captureCase, pass, () => Effect.suspend(() => {
                if (submitted) return Effect.die("Observer attempted to reexecute a selected capture");
                submitted = true;
                counts[pass - 1]++;
                return runCapture();
              })).pipe(Effect.tap(() => submitted ? Effect.void : Effect.die("Observer omitted the selected capture")));
            };
            const captureStorage: LogicalFiniteStorageCapture<FiniteStorageCaptureError> = (operation, demand) => {
              const original = originalCapture(operation, demand);
              return Effect.suspend(() => {
                const source = sources[Math.floor(captured.length / 2)];
                const actualOperation: FiniteStorageCaptureOperation = operation;
                const membership = captured.length % 2 === 0;
                if (source === undefined || (actualOperation.kind !== "indexPage" && actualOperation.kind !== "rows") ||
                  actualOperation.kind !== (membership ? "indexPage" : "rows"))
                  return Effect.die("Selected source emitted an unexpected historical capture");
                const expectedBound = membership ? (source.unique ? 2 : 256) : source.rows;
                const sourceTable = sourceTables.find(table => table.localName === source.tableName);
                if (sourceTable === undefined || !sourceAdmission.tableIds.has(sourceTable.tableId) ||
                  (actualOperation.kind === "indexPage"
                    ? actualOperation.tableId !== sourceTable.tableId ||
                      actualOperation.input.definition.access.tableId !== sourceTable.tableId ||
                      actualOperation.input.limit !== expectedBound || demand.kind !== "index" ||
                      demand.tableId !== sourceTable.tableId || demand.indexDefinitionId !== actualOperation.input.definition.indexDefinitionId
                    : actualOperation.input.tableId !== sourceTable.tableId ||
                      actualOperation.input.rowIds.length !== expectedBound || demand.kind !== "rows" ||
                      demand.tableId !== sourceTable.tableId))
                  return Effect.die(`Historical source demand mismatch for ${source.id}`);
                const captureCase: HistoricalCaptureCase = Object.freeze({ ordinal: captured.length + 1,
                  id: `${source.id}-${actualOperation.kind}`, owner: source.owner, ancestry: source.ancestry, tableName: source.tableName,
                  operation: actualOperation, demand, expectedRows: source.rows, expectedBound });
                return observe(captureCase, 1, () => original).pipe(
                  Effect.tap(envelope => Effect.sync(() => {
                    if (envelope.kind !== actualOperation.kind || (envelope.kind !== "indexPage" && envelope.kind !== "rows"))
                      throw new Error("Selected historical capture returned another envelope");
                    assertCaptureRows(captureCase, envelope);
                    captured.push({ captureCase, runCapture: () => originalCapture(actualOperation, demand), first: envelope });
                  })));
              });
            };
            const borrowed = yield* makeBorrowedLogicalAttempt({ ...borrowInput,
              captureStorage, admission: borrowInput.admissions[0] }).pipe(Effect.mapError(invocationFailure));
            return { abort: borrowed.abort, currentUsage: borrowed.currentUsage,
              invoke: () => runHistoricalCaptureInvocation(borrowed, Effect.gen(function* () {
                const selected = yield* findProducts(borrowed.context, catalog,
                  { where: { id: [seed.productId] }, options: { limit: 1, populate: ["options", "options.values", "tags"] } }, false);
                const variant = yield* loaderRead(borrowed.context, catalog.variant.table, catalog.foreignKeys.variant, [seed.productId]);
                const images = yield* loaderRead(borrowed.context, catalog.image.table, catalog.foreignKeys.image, [seed.productId]);
                const categories = yield* loaderRead(borrowed.context, categoryPivot, categorySourceColumn, [seed.productId]);
                const categoryIds: string[] = [];
                for (const row of categories) {
                  const id = row[categoryTargetColumn];
                  if (typeof id !== "string") return yield* Effect.die("Native category pivot key is invalid");
                  categoryIds.push(id);
                }
                const categoryTargets = yield* loaderRead(borrowed.context, catalog.category.table, categoryPrimaryColumn, categoryIds);
                const selectedSeed = yield* decodeSelectedProductSeed(selected.rows[0]).pipe(Effect.orDie);
                const nativeSeed = yield* decodeSelectedProductSeed(fixture.seedGraph.baseline).pipe(Effect.orDie);
                if (captured.length !== sources.length * 2 || captured.length !== HISTORICAL_CAPTURE_INPUTS_PER_PASS ||
                  selected.rows.length !== 1 || selected.rows[0]?.id !== seed.productId ||
                  !isDeepStrictEqual(selectedSeed, nativeSeed) ||
                  variant.length !== 1 || variant[0]?.id !== seed.variantId || images.length !== 1 || images[0]?.id !== seed.imageId ||
                  categories.length !== 1 || categoryTargets.length !== 1 || categoryTargets[0]?.id !== seed.categoryId)
                  return yield* Effect.die("Historical source-equivalent reads differ from the retained native seed");
                for (const capture of captured) {
                  const replay = yield* observe(capture.captureCase, 2, capture.runCapture).pipe(
                    Effect.mapError(projectFiniteStorageCaptureFailure), Effect.mapError(projectCommerceRequestFailure));
                  assertCaptureRows(capture.captureCase, replay);
                  if (!isDeepStrictEqual(replay.rawRows, capture.first.rawRows))
                    return yield* Effect.die("Uncached historical capture changed row payloads within one open borrow");
                }
                return { products: selected.rows, variants: variant, images, categories: categoryTargets };
              })).pipe(Effect.map(({ result, closed }) => {
                completion = Object.freeze({ captureCount: counts[0] + counts[1], passCaptureCounts: Object.freeze<[number, number]>([counts[0], counts[1]]),
                  rootOutcome: "aborted", workBytes: closed.workBytes, workCalls: closed.workCalls,
                  changes: closed.changes.attempts.length, events: closed.events.length });
                return { result,
                  changes: closed.changes, eventIntents: closed.events.map(intent => ({ sourceKey: "medusa.product", intent })),
                  workBytes: closed.workBytes, workCalls: closed.workCalls };
              }), Effect.mapError(invocationFailure)) };
          }));
        if (outcome.kind !== "completed" || outcome.delivery !== "executed" || completion === undefined ||
          completion.captureCount !== HISTORICAL_CAPTURE_INPUTS_PER_PASS * 2 ||
          counts[0] !== HISTORICAL_CAPTURE_INPUTS_PER_PASS || counts[1] !== HISTORICAL_CAPTURE_INPUTS_PER_PASS ||
          completion.changes !== 0 || completion.events !== 0)
          return yield* Effect.die("Historical capture did not complete its membership and row submissions in both passes");
        return completion;
      }).pipe(Effect.ensuring(fixture.store.discardFiniteRootEffect(fixture.persistenceAttempt).pipe(Effect.orDie)));
      return Effect.runPromise(work);
    };
    return { pools,
      setup: { fixtureMilliseconds, ...fixture.setupTimings }, runPasses, close: fixture.close };
  } catch (cause) {
    try { await fixture.close(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Historical fixture construction cleanup failed"); }
    throw cause;
  }
}

const invocationFailure = (cause: CommerceTransactionError) => new LogicalParticipantInvocationError({ kind: "infrastructure", cause });

function assertCaptureRows(captureCase: HistoricalCaptureCase, envelope: HistoricalEnvelope): void {
  if (envelope.rawRows.length !== captureCase.expectedRows)
    throw new Error(`Historical capture ${captureCase.id} expected ${captureCase.expectedRows} ${envelope.kind} rows`);
}

/** Match write/replace.ts's load query, including compiler-owned PK/FK ordering. */
const loaderRead = Effect.fn("HistoricalCapture.sourceEquivalentLoader")(function* (
  ctx: Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>["context"],
  table: ProductRuntimeMetadata["tables"][number], column: string, values: readonly string[],
) {
  const primary = table.columns.filter(candidate => candidate.primaryKey).map(candidate => candidate.name);
  const keys = primary.length > 0 ? primary : table.foreignKeys.flatMap(key => key.columns);
  const order = keys[0];
  if (order === undefined) return yield* Effect.die("Native replacement loader has no compiler-owned ordering key");
  const store = yield* ctx.table(table.name);
  return yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: order, direction: "asc" },
    predicate: { kind: "in", column, values: [...new Set(values)] } });
});
