import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NodePgSession } from "drizzle-orm/node-postgres";
import { PgliteSession } from "drizzle-orm/pglite";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { JsonObject } from "flarex-protocol/json";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { createMixedMutationProductFixture } from "../../../executor/test/performance/support/mixedMutationProductFixture";
import { runNativeStandaloneProductMutation, runNativeStandaloneProductUpdate, seedNativeProductAttemptGraph } from "../../../medusa-adapter/test/support/native-product-attempt-seed";
import { fxAppRowRevisions } from "../../src/database/schema";
import { LogicalParticipantInvocationError } from "../../src/storage/documents/logicalDocuments/participantErrors";
import type { FiniteSessionJournalParticipantSelection } from "../../src/execution/journal/api";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../../src/execution/preparation/boundedRequestLifetime";
import { withLogicalRelationalAttemptAdmissionEffect, type LogicalRelationalAttemptAdmissionState } from "../../src/storage/documents/logicalDocuments/relationalAdmission";
import { compileLogicalRelationalRead } from "../../src/storage/documents/logicalDocuments/relationalQuery";
import { preparePostgresRelationalBatch, decodePostgresRelationalMatches } from "../../src/storage/documents/logicalDocuments/postgresRelationalPredicate";
import { requireLogicalDocumentRootEvaluatorOpen } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet } from "../../src/storage/documents/logicalDocuments/workingSet";
import type { LogicalFiniteStorageCapture } from "../../src/storage/documents/logicalDocuments/model";
import { logicalCommerceBatchResources, logicalCommerceWorkingSetLimits } from "../../src/frameworks/commerceTransaction/resources";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../src/scope/scopeClock";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "../../src/execution/session/terminalization";
import { postgresUrl } from "../support/postgresHelpers";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
type Working = Effect.Success<ReturnType<typeof makeLogicalDocumentWorkingSet<Error>>>;
type NativeCapture = Readonly<{ kind: "indexPage" | "rows" | "relationalPredicate"; bodyIds: readonly AppRowIdHexV1[];
  bodyBytes: number; rawCount: number; withheld: number; transferBudget: number | undefined; headerReason?: string }>;
const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
async function nativeSeedPhase<Value>(phase: string, run: () => Promise<Value>): Promise<Value> {
  try { return await run(); }
  catch (cause) { throw failure(`Native permission seed failed: ${phase}`, cause); }
}
const rowId = (bytes: unknown): AppRowIdHexV1 => {
  if (!(bytes instanceof Uint8Array)) throw failure("Missing genuine native row identity");
  return Result.getOrThrow(appRowIdHexV1FromBytesResult(bytes));
};

/** The mapper and execution are the original driver's. Observation never
 * registers authority, retries capture, or manufactures a successful body. */
function observeNativeCaptures() {
  const captures: NativeCapture[] = [];
  const headers: Readonly<{ reason: string; databaseNow: string | undefined }>[] = [];
  let observing = false;
  let afterPredicateBody: (() => Promise<void>) | undefined;
  let installationTransportFailure: Error | undefined;
  let installationTransportFailures = 0;
  let membershipIds: AppRowIdHexV1[] = [];
  let corruptUniqueMembership = false;
  let substituteCachedAbsence: AppRowIdHexV1 | undefined;
  let corruptBodyOrdinal: number | undefined;
  let corruptBodyReads = 0;
  const pglite = Object.getOwnPropertyDescriptor(PgliteSession.prototype, "prepareQuery");
  const postgres = Object.getOwnPropertyDescriptor(NodePgSession.prototype, "prepareQuery");
  if (pglite === undefined || postgres === undefined) throw failure("Missing original native capture drivers");
  const wrap = <T extends PreparedQueryConfig>(args: Parameters<typeof PgliteSession.prototype.prepareQuery<T>>) => {
    const mapper = args[4], fields = args[1];
    if (!observing || mapper === undefined || fields === undefined) return;
    const kind = fields.some(field => field.path[0] === "raw" && field.path[1] === "valueBytes") ? "rows" :
      fields.some(field => field.path[0] === "raw" && field.path[1] === "encodedKeyBytes") ? "indexPage" :
      fields.some(field => field.path[0] === "raw" && field.path[1] === "matched") ? "relationalPredicate" :
      args[2]?.startsWith("fx_finite_") && fields.some(field => field.path[0] === "reason") ? "header" : undefined;
    // Predicate bodies are deliberately unnamed: pooled statements must not
    // retain one request's captured values. Their actual field layout identifies
    // this observer's narrow boundary without assigning a reusable SQL name.
    if (kind === undefined || kind !== "relationalPredicate" && !args[2]?.startsWith("fx_finite_")) return;
    let transferBudget: number | undefined;
    args[4] = rows => {
      const mapped = mapper(rows);
      if (!isNonArrayRecord(mapped) || !isNonArrayRecord(mapped.header) ||
        !Array.isArray(mapped.rawRows)) throw failure("Missing actual accepted native finite envelope");
      expect(mapped.layoutFailure).toBeUndefined();
      if (typeof mapped.header.reason !== "string") throw failure("Missing actual finite header reason");
      headers.push({ reason: mapped.header.reason,
        databaseNow: typeof mapped.header.databaseNow === "string" ? mapped.header.databaseNow : undefined });
      if (kind === "header") return mapped;
      const raw: unknown[] = mapped.rawRows;
      if (kind === "relationalPredicate" && mapped.header.reason !== "accepted") {
        if (typeof mapped.header.reason !== "string") throw failure("Missing native refusal reason");
        expect(raw).toHaveLength(0);
        captures.push({ kind, bodyIds: [], bodyBytes: 0, rawCount: raw.length, withheld: 0, transferBudget,
          headerReason: mapped.header.reason });
        return mapped;
      }
      if (mapped.header.reason !== "accepted") throw failure("Missing actual accepted native finite envelope");
      const bodyIds: AppRowIdHexV1[] = [];
      let bodyBytes = 0, withheld = 0;
      if (kind === "rows") for (const value of raw) {
        if (!isNonArrayRecord(value)) throw failure("Missing original native capture row");
        if (value.valueBytes instanceof Uint8Array) { bodyIds.push(rowId(value.requestedRowId)); bodyBytes += value.valueBytes.byteLength; }
        if (value.bodyWithheld === true) withheld++;
      }
      captures.push({ kind, bodyIds, bodyBytes, rawCount: raw.length, withheld, transferBudget,
        ...(kind === "relationalPredicate" ? { headerReason: "accepted" } : {}) });
      if (kind === "indexPage") {
        membershipIds = raw.map(value => {
          if (!isNonArrayRecord(value)) throw failure("Missing native membership");
          return rowId(value.rowIdBytes);
        });
      }
      const injectFault = kind === "indexPage" ? corruptUniqueMembership || substituteCachedAbsence !== undefined
        : kind === "rows" && corruptBodyOrdinal !== undefined;
      if (!injectFault) return mapped;
      // Original mapped records remain frozen and intact. Fault copies keep
      // native scalar/byte identities; only the selected foreign field changes.
      const faultRows = raw.map(value => {
        if (!isNonArrayRecord(value)) throw failure("Missing original native fault row");
        return { ...value };
      });
      if (kind === "indexPage") {
        // Explicit foreign-driver corruption, never impossible persisted state.
        if (corruptUniqueMembership) {
          const first = faultRows[0];
          if (first === undefined || faultRows.length !== 1) throw failure("Expected original single unique owner");
          faultRows.push({ ...first, ordinal: 1,
            rowIdBytes: appRowIdHexV1ToBytes(decodeAppRowIdHexV1("ffffffffffffffffffffffffffffffff")) });
        }
        if (substituteCachedAbsence !== undefined) {
          const first = faultRows[0];
          if (first === undefined) throw failure("Expected original first membership");
          Object.defineProperty(first, "rowIdBytes", { configurable: true, enumerable: true,
            value: appRowIdHexV1ToBytes(substituteCachedAbsence) });
        }
      } else if (corruptBodyOrdinal !== undefined) {
        const corrupted = faultRows[corruptBodyOrdinal];
        if (corrupted === undefined || !(corrupted.valueBytes instanceof Uint8Array))
          throw failure("Corruption witness requires an actually transported body");
        Object.defineProperty(corrupted, "valueSha256", { configurable: true, get() {
          corruptBodyReads++;
          return new Uint8Array(32);
        } });
      }
      // Cloning only the fault envelope retains the original generic mapper
      // return contract. Restore the exact native header and shallow fault rows
      // after cloning so their protected bytes and lazy corruption getter survive.
      return Object.assign(structuredClone(mapped), { header: mapped.header, rawRows: faultRows });
    };
    return { bind: (bindings: unknown[]) => {
      const bound = bindings[0];
      if (kind === "relationalPredicate" || kind === "header") return;
      if (!isNonArrayRecord(bound) || typeof bound.transferBudget !== "number")
        throw failure("Missing original native transfer budget binding");
      transferBudget = bound.transferBudget;
    }, after: kind === "relationalPredicate" ? () => afterPredicateBody?.() : undefined };
  };
  const executeWithObservation = (original: () => unknown, sql: string,
    observation: ReturnType<typeof wrap>, bindings: unknown[], installationFrontier: boolean) => {
    // Full profiles call the original admission helper; installed profiles
    // select the co-located frontier's exact generation projection. Neither
    // injection replaces a finite header, body, result mapper or authority.
    const admission = sql.includes("fx_lock_installation_admission") ||
      installationFrontier && sql.includes("fx_lock_installation_frontier");
    if (observing && installationTransportFailure !== undefined && admission) {
      const originalFailure = installationTransportFailure;
      installationTransportFailure = undefined;
      installationTransportFailures++;
      return Promise.reject(originalFailure);
    }
    observation?.bind(bindings);
    const result = original();
    return observation?.after === undefined ? result : Promise.resolve(result).then(async value => {
      await observation.after?.();
      return value;
    });
  };
  const originalPglite = PgliteSession.prototype.prepareQuery, originalPostgres = NodePgSession.prototype.prepareQuery;
  PgliteSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(
    ...args: Parameters<typeof originalPglite<T>>
  ) {
    const observation = wrap(args), prepared = (originalPglite<T>).apply(this, args);
    return !observing ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, bindings: unknown[]) {
        return executeWithObservation(() => Reflect.apply(execute, target, bindings), args[0].sql, observation, bindings,
          args[1]?.some(field => field.path.length === 1 && field.path[0] === "targetMetadataGeneration") ?? false);
      } });
    } });
  };
  NodePgSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(
    ...args: Parameters<typeof originalPostgres<T>>
  ) {
    const observation = wrap(args), prepared = (originalPostgres<T>).apply(this, args);
    return !observing ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, bindings: unknown[]) {
        return executeWithObservation(() => Reflect.apply(execute, target, bindings), args[0].sql, observation, bindings,
          args[1]?.some(field => field.path.length === 1 && field.path[0] === "targetMetadataGeneration") ?? false);
      } });
    } });
  };
  return {
    captures,
    headers,
    get membershipIds() { return membershipIds; },
    get corruptBodyReads() { return corruptBodyReads; },
    get installationTransportFailures() { return installationTransportFailures; },
    failNextInstallationAdmission(original: Error) { installationTransportFailure = original; },
    begin(input: Readonly<{ corruptUniqueMembership?: boolean; substituteCachedAbsence?: AppRowIdHexV1;
      corruptBodyOrdinal?: number; afterPredicateBody?: () => Promise<void> }> = {}) {
      captures.length = 0; headers.length = 0; membershipIds = []; corruptBodyReads = 0; observing = true;
      afterPredicateBody = input.afterPredicateBody;
      installationTransportFailure = undefined;
      installationTransportFailures = 0;
      corruptUniqueMembership = input.corruptUniqueMembership ?? false;
      substituteCachedAbsence = input.substituteCachedAbsence;
      corruptBodyOrdinal = input.corruptBodyOrdinal;
    },
    stop() { observing = false; afterPredicateBody = undefined; installationTransportFailure = undefined; },
    restore() {
      Object.defineProperty(PgliteSession.prototype, "prepareQuery", pglite);
      Object.defineProperty(NodePgSession.prototype, "prepareQuery", postgres);
    },
  };
}

type PredicatePermission = Pick<LogicalRelationalAttemptAdmissionState, "tables" | "schema"> &
  Readonly<{ capture: LogicalFiniteStorageCapture<Error> }>;
type PredicateSource = LogicalRelationalAttemptAdmissionState["tables"][number];
const predicateBatch = (permission: PredicatePermission, table: PredicateSource, rows: readonly JsonObject[], predicate: unknown) => Result.gen(function* () {
  const query = yield* compileLogicalRelationalRead(table.definition, permission.schema.capabilities,
    { order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
      { kind: "in", column: "id", values: rows.map(row => row.id) }, predicate,
    ] } }, 128, failure);
  if (query.postgresPredicate === undefined) return yield* Result.fail(failure("Missing genuine SQL predicate program"));
  for (const row of rows) yield* query.inspectRow(row);
  return yield* preparePostgresRelationalBatch(query.postgresPredicate, table.definition, table.tableId, rows,
    { rows: 4, bytes: 65_536 }, failure);
});

type ReadCase = Readonly<{
  caseName?: string;
  identities?: number;
  commandMilliseconds?: number;
  beforeRead?: (selection: "point" | "batch" | "scan" | "index", lifetime: BoundedRequestLifetime<Error>) => Effect.Effect<void, Error>;
  afterMembership?: (lifetime: BoundedRequestLifetime<Error>) => Effect.Effect<void, Error>;
  run: (working: Working, lifetime: BoundedRequestLifetime<Error>, id: string,
    root: NonNullable<Parameters<typeof requireLogicalDocumentRootEvaluatorOpen>[0]>,
    permission: PredicatePermission) => Effect.Effect<void, Error>;
}>;

/** Build the same working-set profile inside the actual admitted borrow. The
 * original source token, root, checked read and capture remain authoritative. */
async function runReadCase(fixture: Fixture, participant: FiniteSessionJournalParticipantSelection, selected: ReadCase) {
  let completed = false;
  const operation = participant.operationMethods[0];
  if (operation === undefined) throw failure("Missing original admitted Product operation");
  await Effect.runPromise(Effect.gen(function* () {
    const admission = yield* fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt, {
      ...participant, sources: participant.sources.map(source => ({ ...source, application: fixture.active.selection })),
    });
    const encoded = yield* Effect.fromResult(encodeAdmittedFrameworkOperationV1Result({
      format: "flarex.admitted-framework-operation", version: 1,
      participant: participant.participant, operation, args: {},
    }));
    const outcome = yield* Effect.result(fixture.store.runAdmittedOperationEffect(fixture.persistenceAttempt, admission, {
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n), requestBytes: encoded.bytes,
      requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
      participant: participant.participant, method: operation, profileRevision: participant.profileRevision,
    }, input => {
      const sourceAdmission = input.admissions[0];
      if (sourceAdmission === undefined || input.rootEvaluator === undefined || input.captureStorage === undefined)
        return Effect.die("Permission witness requires the actual finite admitted borrow");
      const root = input.rootEvaluator, originalCapture = input.captureStorage, attemptFence = input.rootAttemptFence;
      return withLogicalRelationalAttemptAdmissionEffect(sourceAdmission, input.attempt, input.method,
        (state, checkedRead, tx) => Effect.gen(function* () {
          const lifetime = yield* makeBoundedRequestLifetime(failure,
            { calls: 64, commandBytes: 1_048_576, commandMs: selected.commandMilliseconds ?? 10_000 }, input.attempt, {}, "finite-body-permission", "write");
          const captureStorage: LogicalFiniteStorageCapture<Error> = (capture, demand) =>
            originalCapture(capture, demand).pipe(Effect.mapError(cause => failure("captureFailure", cause)),
              Effect.tap(envelope => capture.kind === "indexPage" && envelope.kind === "indexPage" && selected.afterMembership !== undefined
                ? selected.afterMembership(lifetime) : Effect.void));
          const working = yield* makeLogicalDocumentWorkingSet({
            scopeId: state.root.scopeId, clock: state.clock, snapshotCommitSeq: state.root.snapshotCommitSeq,
            readTransaction: (read, demand) => checkedRead(read, demand).pipe(Effect.mapError(cause => failure("admissionFailure", cause))),
            rootEvaluator: root, rootAttempt: input.attempt, rootAttemptFence: attemptFence,
            lifetime, requireAdmission: requireLogicalDocumentRootEvaluatorOpen(root, {
              attempt: input.attempt, scopeId: state.root.scopeId, snapshotCommitSeq: state.root.snapshotCommitSeq,
              attemptFence,
            }, () => failure("closed")),
            writeMechanics: state.writeMechanics, tables: state.writeMechanics.tables,
            ...(state.writeMechanics.relationalCapabilities === undefined ? {} : {
              relationalCapabilities: state.writeMechanics.relationalCapabilities,
            }), searchDefinitions: state.writeMechanics.searchDefinitions,
            readReadiness: { kind: "finiteQueryRequired", mechanics: state.writeMechanics, captureStorage },
            validateDocument: write => Effect.fromResult(state.values.validate(write.tableId, write.document)).pipe(
              Effect.mapError(cause => failure("invalidInput", cause))),
            error: failure, uniqueConflict: () => failure("uniqueConflict"),
            limits: { ...logicalCommerceWorkingSetLimits, pageRows: logicalCommerceBatchResources.queryRows,
              identities: selected.identities ?? logicalCommerceBatchResources.catalogRows },
          }, AppCreationTimeV1Schema.make(1), state.writeMechanics.unique, state.writeMechanics.indexes,
          { beforeRead: selection => selected.beforeRead?.(selection, lifetime) ?? Effect.void }, tx);
          return { working, lifetime, id: yield* lifetime.begin(lifetime.context),
            permission: { capture: captureStorage, tables: state.tables, schema: state.schema } };
        }), (_state, _checkedRead, { working, lifetime, id, permission }) => Effect.succeed({
          abort: lifetime.close,
          currentUsage: () => ({ workBytes: 1_048_576 - lifetime.remainingBytes(), workCalls: lifetime.usedCalls() }),
          invoke: () => selected.run(working, lifetime, id, root, permission).pipe(
            Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })),
            Effect.tap(() => Effect.sync(() => { completed = true; })),
            Effect.andThen(Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: "read-only witness discards root" }))),
            Effect.ensuring(lifetime.close)),
        })).pipe(Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })));
    }));
    if (!completed) throw failure(`Finite permission case ${selected.caseName ?? "unnamed"} did not complete`, outcome);
    expect(Result.isFailure(outcome)).toBe(true);
    if (!Result.isFailure(outcome)) throw failure("Expected read-only witness rejection");
    expect(outcome.failure).toMatchObject({ _tag: "LogicalParticipantInvocationError",
      kind: "rejection", cause: "read-only witness discards root" });
  }).pipe(Effect.ensuring(fixture.store.discardFiniteRootEffect(fixture.persistenceAttempt).pipe(Effect.orDie))));
}

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
describe.each(drivers)("finite indexed body permission on %s", driver => {
  it("accepts membership and callbacks before historical transfer, with fresh dense packet bounds and original ordinal refusal", async () => {
    let participant: FiniteSessionJournalParticipantSelection | undefined;
    const base = await createMixedMutationProductFixture({ driver, suffix: `finite-body-permission-${driver}`,
      hooks: { transformFiniteEntrySources: participants => { participant = participants[0]; return participants; } } });
    const observer = observeNativeCaptures();
    try {
      if (participant === undefined) throw failure("Missing actual prepared source participant");
      const originalParticipant = participant;
      // Real independently committed native business rows, not a fabricated
      // captured envelope or a foreign capability registered by the fixture.
      const secondProduct = await nativeSeedPhase(`${driver}: seed second native Product`, () =>
        seedNativeProductAttemptGraph(base.currency, base.product, `finite-body-permission-${driver}-second`));
      expect(secondProduct.seed.productId).not.toBe(base.seed.productId);
      // Native Product accepts variants without options. Its replacement owner
      // removes the seed's option/value links; variant creation still performs
      // the genuine existing-variant read and native business validation. Its
      // options population builds an IN over same-product variants: each real
      // Product stays at most 151 owners, below the native 256 operand bound.
      const products = [
        { productId: base.seed.productId, additionalVariants: 150, label: "first" },
        { productId: secondProduct.seed.productId, additionalVariants: 149, label: "second" },
      ];
      for (const product of products) {
        await nativeSeedPhase(`${driver}: remove ${product.label} Product options`, () =>
          runNativeStandaloneProductMutation(base.currency, base.product,
            `finite-body-options-${driver}-${product.label}`, "replaceOptionValues",
            { id: product.productId, data: { options: [] } }));
        // Required titles remain minimal; every finite budget below derives
        // from actual stored body bytes instead of padded native catalog reads.
        for (let offset = 0; offset < product.additionalVariants; offset += 10) {
          const count = Math.min(10, product.additionalVariants - offset);
          await nativeSeedPhase(`${driver}: create ${product.label} native variants ${offset}..${offset + count - 1}`, () =>
            runNativeStandaloneProductMutation(base.currency, base.product,
              `finite-body-variants-${driver}-${product.label}-${offset}`, "createVariant",
              Array.from({ length: count }, (_, ordinal) => ({
                id: `pvar_permission_${driver}_${product.label}_${offset + ordinal}`, product_id: product.productId,
                title: `v${offset + ordinal}`,
              })), undefined, logicalCommerceBatchResources));
        }
      }
      const sourceTables = base.logicalSourceCatalog.sourceDefinitionTables("medusa.product");
      const productTable = sourceTables?.find(table => table.localName === base.seedGraph.catalog.product.table.name);
      const variantTable = sourceTables?.find(table => table.localName === base.seedGraph.catalog.variant.table.name);
      if (productTable === undefined || variantTable === undefined)
        throw failure("Missing actual native query source");
      const scopeUuid = projectScopeIdUuidV1(base.currency.application.authority.scopeId).scopeUuid;
      const revisions = await base.currency.persistence.drizzle.select({ rowId: fxAppRowRevisions.rowId,
        tableId: fxAppRowRevisions.tableId, valueBytes: fxAppRowRevisions.valueBytes }).from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, variantTable.tableId)));
      const bytesByRow = new Map(revisions.map(row => [rowId(row.rowId), row.valueBytes?.byteLength ?? 0]));
      expect(bytesByRow.size).toBe(301);
      // The native Product ID is an unconditional unique key. Handle uniqueness
      // is partial and cannot select the historical unique-owner document path.
      const uniqueQuery = { where: { id: base.seed.productId }, offset: 0, limit: 1 };
      const lowerProductId = base.seed.productId < secondProduct.seed.productId ? base.seed.productId : secondProduct.seed.productId;
      const upperProductId = base.seed.productId < secondProduct.seed.productId ? secondProduct.seed.productId : base.seed.productId;
      const indexedQuery = { where: { product_id: { gte: lowerProductId, lte: upperProductId }, deleted_at: null }, offset: 0, limit: 1 };
      const nativeRows = () => observer.captures.filter(capture => capture.kind === "rows");
      const fresh = async (name: string, selected: ReadCase) => {
        const fixture = await base.openCompetingFiniteFixture(`finite-permission-${driver}-${name}`);
        try { await runReadCase(fixture, originalParticipant, { ...selected, caseName: name }); }
        finally { observer.stop(); await fixture.close(); }
      };
      observer.begin();
      await fresh("membership-refusal", {
        afterMembership: lifetime => Effect.fromResult(lifetime.charge(lifetime.remainingBytes())),
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected membership retention refusal");
          expect(result.failure).toMatchObject({ message: "limitExceeded" });
          expect(observer.captures.filter(capture => capture.kind === "indexPage")).toHaveLength(1);
          expect(nativeRows()).toHaveLength(0);
          expect(root.snapshot().dependencies).toHaveLength(0);
        }),
      });
      observer.begin();
      const pointRefusal = failure("acceptingPointRefusal");
      await fresh("point-refusal", {
        beforeRead: selection => selection === "point" ? Effect.fail(pointRefusal) : Effect.void,
        run: (working, lifetime, id) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected accepting point refusal");
          expect(result.failure).toMatchObject({ message: "acceptingPointRefusal" });
          expect(result.failure).toBe(pointRefusal);
          expect(nativeRows()).toHaveLength(0);
        }),
      });
      observer.begin({ corruptUniqueMembership: true });
      await fresh("unique-cardinality", {
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected unique membership corruption");
          expect(result.failure).toMatchObject({ message: "storedCorruption" });
          expect(nativeRows()).toHaveLength(0);
          expect(root.snapshot().dependencies).toHaveLength(0);
        }),
      });
      observer.begin();
      await fresh("lookahead", {
        identities: 256,
        run: (working, lifetime, id) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, variantTable.localName, indexedQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected membership lookahead refusal");
          expect(result.failure).toMatchObject({ message: "limitExceeded" });
          expect(observer.captures[0]?.rawCount).toBe(257);
          expect(nativeRows()).toHaveLength(0);
        }),
      });
      for (const corrupt of [false, true]) {
        observer.begin(corrupt ? { corruptBodyOrdinal: 0 } : {});
        await fresh(`late-point-${corrupt}`, {
          beforeRead: (selection, lifetime) => selection === "point"
            ? Effect.fromResult(lifetime.charge(lifetime.remainingBytes() - 1)) : Effect.void,
          run: (working, lifetime, id, root) => Effect.gen(function* () {
            const result = yield* Effect.result(working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery));
            expect(Result.isFailure(result)).toBe(true);
            if (!Result.isFailure(result)) throw failure("Expected late point allowance refusal");
            expect(result.failure).toMatchObject({ message: corrupt ? "storedCorruption" : "limitExceeded" });
            if (corrupt) expect(result.failure.cause).toMatchObject({ _tag: "AppRowStorageCorruptionError" });
            expect(nativeRows()).toHaveLength(1);
            expect(nativeRows()[0]?.bodyIds).toHaveLength(1);
            expect(nativeRows()[0]?.bodyBytes).toBeGreaterThan(1);
            expect(nativeRows()[0]?.transferBudget).toBe(1);
            expect(root.snapshot().dependencies).toHaveLength(0);
          }),
        });
      }
      observer.begin();
      await fresh("unique-retention", {
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const first = yield* working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery);
          expect(first.total).toBe(1);
          expect(nativeRows()).toHaveLength(1);
          expect(root.snapshot().uniqueReads).toHaveLength(1);
          expect(root.snapshot().indexReads).toHaveLength(1);
          const captured = observer.captures.length;
          expect((yield* working.documents.find(lifetime.context, id, productTable.localName, uniqueQuery)).total).toBe(1);
          expect(observer.captures).toHaveLength(captured);
          const missing = { where: { id: `${base.seed.productId}-absent-finite-permission` }, offset: 0, limit: 1 };
          expect((yield* working.documents.find(lifetime.context, id, productTable.localName, missing)).total).toBe(0);
          const afterMissing = observer.captures.length;
          expect(nativeRows()).toHaveLength(1);
          expect((yield* working.documents.find(lifetime.context, id, productTable.localName, missing)).total).toBe(0);
          expect(observer.captures).toHaveLength(afterMissing);
          expect(root.snapshot().uniqueReads).toHaveLength(2);
          expect(root.snapshot().dependencies).toHaveLength(1);
        }),
      });
      let packet = 0;
      observer.begin();
      await fresh("second-packet", {
        afterMembership: () => Effect.sync(() => {
          expect(observer.membershipIds).toHaveLength(301);
          expect(new Set(observer.membershipIds)).toEqual(new Set(bytesByRow.keys()));
        }),
        beforeRead: (selection, lifetime) => Effect.gen(function* () {
          if (selection !== "batch") return;
          if (++packet !== 2) return;
          const first = observer.membershipIds[256];
          const bytes = first === undefined ? undefined : bytesByRow.get(first);
          if (bytes === undefined || bytes < 129) return yield* Effect.die("Missing second packet's actual first body");
          expect(nativeRows()[0]?.bodyIds).toHaveLength(256);
          yield* Effect.fromResult(lifetime.charge(lifetime.remainingBytes() - (bytes - 1)));
        }),
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, variantTable.localName, indexedQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected second packet allowance refusal");
          expect(result.failure).toMatchObject({ message: "limitExceeded" });
          expect(nativeRows().map(capture => capture.rawCount)).toEqual([256, 45]);
          expect(nativeRows().map(capture => capture.bodyIds.length)).toEqual([256, 1]);
          expect(nativeRows()[1]?.withheld).toBe(44);
          const first = observer.membershipIds[256];
          expect(nativeRows()[1]?.transferBudget).toBe(first === undefined ? undefined : (bytesByRow.get(first) ?? 0) - 1);
          expect(root.snapshot().dependencies).toHaveLength(257);
        }),
      });
      observer.begin({ corruptBodyOrdinal: 1 });
      await fresh("ordinal-budget-first", {
        beforeRead: (selection, lifetime) => Effect.gen(function* () {
          if (selection !== "batch") return;
          const first = observer.membershipIds[0], bytes = first === undefined ? undefined : bytesByRow.get(first);
          if (bytes === undefined) return yield* Effect.die("Missing actual first historical body");
          yield* Effect.fromResult(lifetime.charge(lifetime.remainingBytes() - bytes));
        }),
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, variantTable.localName, indexedQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected ordinal hydration allowance refusal");
          expect(result.failure).toMatchObject({ message: "limitExceeded" });
          expect(nativeRows()).toHaveLength(1);
          expect(nativeRows()[0]?.bodyIds).toHaveLength(2);
          expect(observer.corruptBodyReads).toBe(0);
          expect(root.snapshot().dependencies).toHaveLength(1);
        }),
      });
      observer.begin({ corruptBodyOrdinal: 1 });
      await fresh("ordinal-corruption", {
        run: (working, lifetime, id, root) => Effect.gen(function* () {
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, variantTable.localName, indexedQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected original ordinal body corruption");
          expect(result.failure).toMatchObject({ message: "storedCorruption" });
          expect(result.failure.cause).toMatchObject({ _tag: "AppRowStorageCorruptionError" });
          expect(observer.corruptBodyReads).toBe(1);
          expect(nativeRows()).toHaveLength(1);
          expect(root.snapshot().dependencies).toHaveLength(1);
        }),
      });
      const absent = decodeAppRowIdHexV1("00000000000000000000000000000001");
      observer.begin();
      await fresh("cached-observations", {
        run: (working, lifetime, id) => Effect.gen(function* () {
          const absentId = appDocumentIdV1FromRowIdentity({ tableId: variantTable.tableId, rowId: absent });
          expect(yield* working.documents.get(lifetime.context, id, absentId)).toBeNull();
          const firstReadCount = nativeRows().length;
          expect(yield* working.documents.get(lifetime.context, id, absentId)).toBeNull();
          expect(nativeRows()).toHaveLength(firstReadCount);
          const removed = revisions[0], positive = revisions[1];
          if (removed === undefined || positive === undefined) return yield* Effect.die("Missing native cached rows");
          const removedRow = rowId(removed.rowId), removedId = appDocumentIdV1FromRowIdentity({ tableId: variantTable.tableId, rowId: removedRow });
          const positiveRow = rowId(positive.rowId);
          yield* working.documents.get(lifetime.context, id,
            appDocumentIdV1FromRowIdentity({ tableId: variantTable.tableId, rowId: positiveRow }));
          yield* working.documents.get(lifetime.context, id, removedId);
          yield* working.documents.delete(lifetime.context, id, removedId);
          observer.begin({ substituteCachedAbsence: absent });
          const result = yield* Effect.result(working.documents.find(lifetime.context, id, variantTable.localName, indexedQuery));
          expect(Result.isFailure(result)).toBe(true);
          if (!Result.isFailure(result)) throw failure("Expected cached absence membership conflict");
          expect(result.failure).toMatchObject({ message: "writeConflict" });
          const transported = nativeRows().flatMap(capture => capture.bodyIds);
          expect(transported).not.toContain(absent);
          expect(transported).not.toContain(removedRow);
          expect(transported).not.toContain(positiveRow);
          expect(nativeRows()[0]?.rawCount).toBe(256);
          expect(nativeRows()[1]?.rawCount).toBeLessThanOrEqual(44);
        }),
      });
    } finally { observer.restore(); await base.close(); }
  }, 180_000);

  it("evaluates captured predicates through genuine finite permission and nullable current/pending Product rows", async () => {
    let participant: FiniteSessionJournalParticipantSelection | undefined;
    const base = await createMixedMutationProductFixture({ driver, suffix: `finite-predicate-${driver}`,
      hooks: { transformFiniteEntrySources: participants => { participant = participants[0]; return participants; } } });
    const observer = observeNativeCaptures();
    try {
      if (participant === undefined) throw failure("Missing actual predicate participant");
      const originalParticipant = participant;
      const second = await nativeSeedPhase(`${driver}: predicate second Product`, () =>
        seedNativeProductAttemptGraph(base.currency, base.product, `finite-predicate-${driver}-second`));
      await nativeSeedPhase(`${driver}: native nullable text`, () => runNativeStandaloneProductUpdate(base.currency, base.product,
        `finite-predicate-${driver}-subtitle`, { id: second.seed.productId, data: { subtitle: "a%b" } }));
      const productName = base.seedGraph.catalog.product.table.name;
      const variantName = base.seedGraph.catalog.variant.table.name;
      const ids = [base.seed.productId, second.seed.productId];
      const anchor = { kind: "in", column: "id", values: ids };
      const text = (operator: string, value: string | boolean) => ({ kind: "postgresText", column: "subtitle", operator, value });
      const query = (predicate: unknown) => ({ order: { column: "id", direction: "asc" },
        predicate: { kind: "and", children: [anchor, predicate] } });
      const fresh = async (name: string, selected: ReadCase) => {
        const fixture = await base.openCompetingFiniteFixture(`finite-predicate-${driver}-${name}`);
        try { observer.begin(); await runReadCase(fixture, originalParticipant, { ...selected, caseName: name }); }
        finally { observer.stop(); await fixture.close(); }
      };
      const predicateCaptures = () => observer.captures.filter(capture => capture.kind === "relationalPredicate");
      const numeric = (operator: string, value: number) => ({ kind: "postgresNumericCast", column: "subtitle", operator, value });
      await fresh("nullable-current-and-pending", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing genuine Product source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const empty = rows.find(row => row.id === base.seed.productId), nonempty = rows.find(row => row.id === second.seed.productId);
          if (empty === undefined || nonempty === undefined) throw failure("Missing native predicate candidates");
          expect(empty.subtitle).toBeNull();
          expect(nonempty.subtitle).toBe("a%b");
          // Repeated values retain their original candidate ordinal. No test
          // SQL or substitute envelope supplies the verdicts.
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, [nonempty, empty, nonempty], text("like", "a\\%b")));
          const envelope = yield* permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId });
          if (envelope.kind !== "relationalPredicate") throw failure("Missing genuine predicate envelope");
          expect(envelope.rawRows).toEqual([{ ordinal: 0, matched: true }, { ordinal: 1, matched: false }, { ordinal: 2, matched: true }]);
          expect(yield* Effect.fromResult(decodePostgresRelationalMatches(batch, table.tableId, envelope.rawRows, failure)))
            .toMatchObject({ matches: [true, false, true] });
          expect(predicateCaptures().at(-1)).toMatchObject({ rawCount: 3, headerReason: "accepted" });
          const selectedIds = (predicate: unknown) => store.find(lifetime.context, query(predicate)).pipe(
            Effect.map(found => found.map(row => row.id).sort()));
          expect(yield* selectedIds(text("exists", false))).toEqual([base.seed.productId]);
          expect(yield* selectedIds(text("exists", true))).toEqual([second.seed.productId]);
          expect(yield* selectedIds({ kind: "postgresText", column: "subtitle", operator: "notIn", values: [] })).toEqual([...ids].sort());
          expect(yield* selectedIds({ kind: "postgresText", column: "subtitle", operator: "notIn", values: ["foreign"] })).toEqual([second.seed.productId]);
          expect(yield* selectedIds({ kind: "or", children: [text("regex", "^a%b$"),
            { kind: "in", column: "id", values: [base.seed.productId] }] })).toEqual([...ids].sort());
          expect(yield* selectedIds({ kind: "and", children: [text("regex", "^a%b$"),
            { kind: "in", column: "id", values: [base.seed.productId] }] })).toEqual([]);
          yield* store.write(lifetime.context, "update", [{ id: base.seed.productId, subtitle: "pending" }]);
          expect(yield* selectedIds(text("exists", false))).toEqual([]);
          expect(yield* selectedIds(text("regex", "^pending$"))).toEqual([base.seed.productId]);
          expect(yield* selectedIds({ kind: "postgresText", column: "subtitle", operator: "notIn", values: ["a%b"] })).toEqual([base.seed.productId]);
        }),
      });
      await fresh("numeric-cast-current-and-pending", {
        run: (working, lifetime, id) => Effect.gen(function* () {
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const current = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          expect(current.find(row => row.id === base.seed.productId)?.subtitle).toBeNull();
          expect(current.find(row => row.id === second.seed.productId)?.subtitle).toBe("a%b");
          const selected = (predicate: unknown) => store.find(lifetime.context, query(predicate)).pipe(Effect.map(rows => rows.map(row => row.id).sort()));
          // The original invalid TEXT remains valid data. Keep its lexical
          // guard and numeric cast inside one authenticated SQL expression.
          expect(yield* selected({ kind: "and", children: [
            { kind: "postgresText", column: "subtitle", operator: "notIn", values: ["a%b"] }, numeric("gt", 1),
          ] })).toEqual([]);
          expect(yield* selected({ kind: "or", children: [{ kind: "and", children: [] }, numeric("gt", 1)] }))
            .toEqual([...ids].sort());
          for (const [subtitle, operator, threshold, matches] of [
            ["1.0000000000000000001", "gt", 1, true],
            ["9007199254740993", "gt", 9007199254740992, true],
            [" 01.00 ", "gte", 1, true],
            ["1e0", "lte", 1, true],
            ["NaN", "gt", 1, true], ["Infinity", "gt", 1, true], ["-Infinity", "lt", 1, true],
            ["1.0000000000000000001", "lte", 1, false],
          ] as const) {
            yield* store.write(lifetime.context, "update", [{ id: second.seed.productId, subtitle }]);
            expect(yield* selected(numeric(operator, threshold))).toEqual(matches ? [second.seed.productId] : []);
          }
          expect(yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
            { kind: "in", column: "id", values: [] }, numeric("gt", 1),
          ] } })).toEqual([]);
          expect(predicateCaptures().some(capture => capture.rawCount === 0 && capture.headerReason === "accepted")).toBe(true);
        }),
      });
      await fresh("original-numeric-cast-error", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing genuine numeric predicate source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, numeric("gt", 1)));
          const outcome = yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }));
          expect(outcome).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
            cause: { _tag: "FiniteStorageCaptureError", reason: "resourceFailure" } } });
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
      for (const refusal of ["cloned-token", "wrong-table", "clock-demand", "wrong-demand-table", "cloned-source", "other-source"] as const) await fresh(`authority-${refusal}`, {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          const other = permission.tables.find(value => value.localName === variantName);
          if (table === undefined || other === undefined) throw failure("Missing genuine source pins");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          let batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, text("exists", true)));
          const before = predicateCaptures().length;
          // A genuine issuer token from a different source is still unable to
          // borrow this Product table's admitted authority. Prepare every
          // required row before the first refusal: refusal closes this root.
          if (refusal === "cloned-token") batch = structuredClone(batch);
          if (refusal === "cloned-source") {
            const copiedSource = { ...table, definition: { ...table.definition } };
            batch = yield* Effect.fromResult(predicateBatch(permission, copiedSource, rows, text("exists", true)));
          }
          if (refusal === "other-source") {
            const otherStore = yield* working.relationalTable(lifetime.context, id, variantName);
            const otherRows = yield* otherStore.find(lifetime.context, { order: { column: "id", direction: "asc" },
              predicate: { kind: "in", column: "product_id", values: [base.seed.productId] } });
            expect(otherRows.length).toBeGreaterThan(0);
            const otherProgram = yield* Effect.fromResult(compileLogicalRelationalRead(other.definition, permission.schema.capabilities,
              { order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
                { kind: "in", column: "id", values: otherRows.map(row => row.id) },
                { kind: "postgresText", column: "id", operator: "like", value: "%" },
              ] } }, 128, failure));
            if (otherProgram.postgresPredicate === undefined) throw failure("Missing genuine other-table program");
            for (const row of otherRows) yield* Effect.fromResult(otherProgram.inspectRow(row));
            batch = yield* Effect.fromResult(preparePostgresRelationalBatch(otherProgram.postgresPredicate,
              other.definition, table.tableId, otherRows, { rows: 4, bytes: 65_536 }, failure));
          }
          const target = refusal === "wrong-table" ? other.tableId : table.tableId;
          const demand = refusal === "clock-demand" ? { kind: "clock" as const } : { kind: "rows" as const,
            tableId: refusal === "wrong-demand-table" ? other.tableId : target };
          expect(yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: target, batch },
            demand))).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
              cause: { _tag: "FiniteStorageCaptureError", reason: "invalidAuthority" } } });
          expect(predicateCaptures()).toHaveLength(before);
        }),
      });
      await fresh("original-sql-error", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing genuine predicate source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, text("regex", "[")));
          expect(yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }))).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
              cause: { _tag: "FiniteStorageCaptureError", reason: "resourceFailure" } } });
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
      await fresh("mid-capture-interruption", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing actual interruption source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, text("exists", true)));
          const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
          let exposed = false, interruptionSettled = false;
          observer.begin({ afterPredicateBody: () => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)))) });
          const capturing = yield* Effect.forkChild(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }).pipe(Effect.tap(() => Effect.sync(() => { exposed = true; }))));
          yield* Effect.gen(function* () {
            yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
            expect(predicateCaptures()).toEqual([expect.objectContaining({ headerReason: "accepted", rawCount: rows.length })]);
            const interrupting = yield* Effect.forkChild(Fiber.interrupt(capturing).pipe(
              Effect.tap(() => Effect.sync(() => { interruptionSettled = true; }))));
            if (driver === "postgres") yield* Fiber.join(interrupting).pipe(Effect.timeout("10 seconds"));
            else yield* Effect.sleep(20);
            // Native SQL has finished; only this observer's Promise is held.
            // The installed PostgreSQL owner cancels its callback and rolls
            // back immediately. The full-profile PGlite bridge drains that
            // independent callback before exposing interruption.
            expect(interruptionSettled).toBe(driver === "postgres");
            expect(exposed).toBe(false);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(interrupting);
            const exit = yield* Fiber.await(capturing);
            expect(Exit.isFailure(exit)).toBe(true);
            if (!Exit.isFailure(exit)) throw failure("Interrupted capture unexpectedly exposed a value");
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
            expect(interruptionSettled).toBe(true);
            expect(exposed).toBe(false);
            expect(observer.headers.map(header => header.reason)).toEqual(driver === "postgres"
              ? ["accepted", "accepted"] : ["accepted", "accepted", "accepted"]);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        }),
      });
      await fresh("locks-available-after-interruption", {
        run: (working, lifetime, id) => Effect.gen(function* () {
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          expect((yield* store.find(lifetime.context, query(text("exists", true)))).map(row => row.id))
            .toEqual([second.seed.productId]);
          expect(predicateCaptures().some(capture => capture.headerReason === "accepted")).toBe(true);
        }),
      });
      await fresh("installation-admission-transport-failure", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing actual installation failure source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, text("exists", true)));
          const originalFailure = new Error("Original installation admission transport failed");
          observer.begin();
          observer.failNextInstallationAdmission(originalFailure);
          const result = yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }));
          expect(result).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
            cause: { _tag: "FiniteStorageCaptureError", reason: "resourceFailure" } } });
          if (!Result.isFailure(result)) throw failure("Installation failure unexpectedly exposed predicate results");
          let original: unknown = result.failure;
          for (let depth = 0; depth < 8 && original !== originalFailure; depth++) {
            if (!isNonArrayRecord(original)) break;
            original = original.cause;
          }
          expect(original).toBe(originalFailure);
          expect(observer.installationTransportFailures).toBe(1);
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
      await fresh("closed", {
        run: (working, lifetime, id) => Effect.gen(function* () {
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          yield* lifetime.close;
          expect(yield* Effect.result(store.find(lifetime.context, query(text("exists", true)))))
            .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
      await fresh("deadline", {
        commandMilliseconds: 1_000,
        run: (working, lifetime, id) => Effect.gen(function* () {
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          yield* Effect.sleep(1_050);
          expect(yield* Effect.result(store.find(lifetime.context, query(text("exists", true)))))
            .toMatchObject({ _tag: "Failure", failure: { message: "deadlineExceeded" } });
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
      // Revocation is performed by the existing scope-clock owner. The body
      // contains an invalid native regex so any eager execution is observable.
      await fresh("revoked-before-body", {
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === productName);
          if (table === undefined) throw failure("Missing genuine revocation source");
          const store = yield* working.relationalTable(lifetime.context, id, productName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" }, predicate: anchor });
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows, text("regex", "[")));
          yield* Effect.tryPromise({ try: () => base.currency.persistence.drizzle.transaction(tx => Effect.runPromise(
            advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, base.currency.application.authority.scopeId))),
            catch: cause => failure("Owner revocation failed", cause) });
          expect(yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }))).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
              cause: { _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged" } } });
          // The protected entry header refuses before a dynamic predicate
          // command is prepared or planned, including its invalid regex.
          expect(predicateCaptures()).toHaveLength(0);
        }),
      });
    } finally { observer.restore(); await base.close(); }
  }, 120_000);

  it("refuses a numeric-cast body before execution after genuine scope authorization revocation", async () => {
    let participant: FiniteSessionJournalParticipantSelection | undefined;
    const base = await createMixedMutationProductFixture({ driver, suffix: `finite-numeric-revocation-${driver}`,
      hooks: { transformFiniteEntrySources: participants => { participant = participants[0]; return participants; } } });
    const observer = observeNativeCaptures();
    try {
      if (participant === undefined) throw failure("Missing genuine numeric revocation participant");
      await nativeSeedPhase(`${driver}: native invalid numeric TEXT`, () => runNativeStandaloneProductUpdate(base.currency, base.product,
        `finite-numeric-revocation-${driver}-subtitle`, { id: base.seed.productId, data: { subtitle: "invalid-numeric-text" } }));
      const fixture = await base.openCompetingFiniteFixture(`finite-numeric-revocation-${driver}-child`);
      try {
        observer.begin();
        await runReadCase(fixture, participant, { caseName: "revoked-before-numeric-body",
          run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
            const table = permission.tables.find(value => value.localName === base.seedGraph.catalog.product.table.name);
            if (table === undefined) throw failure("Missing genuine numeric revocation source");
            const store = yield* working.relationalTable(lifetime.context, id, table.localName);
            const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" },
              predicate: { kind: "in", column: "id", values: [base.seed.productId] } });
            expect(rows).toHaveLength(1);
            expect(rows[0]?.subtitle).toBe("invalid-numeric-text");
            const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows,
              { kind: "postgresNumericCast", column: "subtitle", operator: "gt", value: 1 }));
            yield* Effect.tryPromise({ try: () => base.currency.persistence.drizzle.transaction(tx => Effect.runPromise(
              advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, base.currency.application.authority.scopeId))),
              catch: cause => failure("Owner numeric revocation failed", cause) });
            expect(yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
              { kind: "rows", tableId: table.tableId }))).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
                cause: { _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged" } } });
            expect(observer.captures.filter(capture => capture.kind === "relationalPredicate")).toHaveLength(0);
          }),
        });
      } finally { observer.stop(); await fixture.close(); }
    } finally { observer.restore(); await base.close(); }
  }, 120_000);

  it("refuses a predicate result when the genuine grant expires after the original body and before its fresh tail", async () => {
    let participant: FiniteSessionJournalParticipantSelection | undefined;
    const base = await createMixedMutationProductFixture({ driver, suffix: `finite-predicate-tail-${driver}`,
      hooks: { transformFiniteEntrySources: participants => { participant = participants[0]; return participants; } } });
    const observer = observeNativeCaptures();
    const failures: unknown[] = [];
    let fixture: Fixture | undefined;
    try {
      if (participant === undefined) throw failure("Missing genuine short-grant participant");
      const child = await base.openCompetingFiniteFixture(`finite-predicate-short-tail-${driver}`,
        { finiteGrantLifetimeMilliseconds: 5_000 });
      fixture = child;
      observer.begin();
      await runReadCase(child, participant, { caseName: "expired-after-actual-body", commandMilliseconds: 20_000,
        run: (working, lifetime, id, _root, permission) => Effect.gen(function* () {
          const table = permission.tables.find(value => value.localName === child.seedGraph.catalog.product.table.name);
          if (table === undefined) throw failure("Missing genuine short-grant Product source");
          const store = yield* working.relationalTable(lifetime.context, id, table.localName);
          const rows = yield* store.find(lifetime.context, { order: { column: "id", direction: "asc" },
            predicate: { kind: "in", column: "id", values: [child.seed.productId] } });
          expect(rows).toHaveLength(1);
          const batch = yield* Effect.fromResult(predicateBatch(permission, table, rows,
            { kind: "postgresText", column: "subtitle", operator: "exists", value: false }));
          let bodyReached = false, exposed = false;
          observer.begin({ afterPredicateBody: async () => {
            // The original mapper has already authenticated and recorded the
            // actual body. Delay only its delivery to the transaction owner.
            bodyReached = true;
            expect(observer.captures).toEqual([expect.objectContaining({ kind: "relationalPredicate", rawCount: 1, headerReason: "accepted" })]);
            expect(observer.headers.map(header => header.reason)).toEqual(["accepted", "accepted"]);
            await Effect.runPromise(Effect.sleep(5_500));
          } });
          const result = yield* Effect.result(permission.capture({ kind: "relationalPredicate", tableId: table.tableId, batch },
            { kind: "rows", tableId: table.tableId }).pipe(Effect.tap(() => Effect.sync(() => { exposed = true; }))));
          expect(bodyReached).toBe(true);
          expect(exposed).toBe(false);
          expect(result).toMatchObject({ _tag: "Failure", failure: { message: "captureFailure",
            cause: { _tag: "FiniteStorageCaptureError", reason: "expired" } } });
          expect(observer.headers.map(header => header.reason)).toEqual(["accepted", "accepted", "expired"]);
          const first = observer.headers[0]?.databaseNow, last = observer.headers[2]?.databaseNow;
          if (first === undefined || last === undefined) throw failure("Missing original entry/tail database clocks");
          expect(Number(last) - Number(first)).toBeGreaterThanOrEqual(5_000);
        }),
      });
      // The genuine expired child has no remaining live execution claim. Let
      // its existing terminalization owner confirm expiry before normal close
      // joins the original continuation; the base remains independently live.
      expect(await Effect.runPromise(createPointMutationSessionAttemptTerminalizationPersistenceV1(
        child.application.sessionAuthority).expireEffect(child.selector)))
        .toMatchObject({ terminal: { lifecycle: "expired" } });
    } catch (cause) {
      failures.push(cause);
    } finally {
      observer.restore();
      try { await fixture?.close(); } catch (cause) { failures.push(cause); }
      try { await base.close(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Native predicate tail witness or cleanup failed");
  }, 120_000);
});
