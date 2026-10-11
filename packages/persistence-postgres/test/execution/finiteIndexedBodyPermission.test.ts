import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NodePgSession } from "drizzle-orm/node-postgres";
import { PgliteSession } from "drizzle-orm/pglite";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core/session";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { createMixedMutationProductFixture } from "../../../executor/test/performance/support/mixedMutationProductFixture";
import { runNativeStandaloneProductMutation, seedNativeProductAttemptGraph } from "../../../medusa-adapter/test/support/native-product-attempt-seed";
import { fxAppRowRevisions } from "../../src/database/schema";
import { LogicalParticipantInvocationError } from "../../src/storage/documents/logicalDocuments/participantErrors";
import type { FiniteSessionJournalParticipantSelection } from "../../src/execution/journal/api";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../../src/execution/preparation/boundedRequestLifetime";
import { withLogicalRelationalAttemptAdmissionEffect } from "../../src/storage/documents/logicalDocuments/relationalAdmission";
import { requireLogicalDocumentRootEvaluatorOpen } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet } from "../../src/storage/documents/logicalDocuments/workingSet";
import type { LogicalFiniteStorageCapture } from "../../src/storage/documents/logicalDocuments/model";
import { logicalCommerceBatchResources, logicalCommerceWorkingSetLimits } from "../../src/frameworks/commerceTransaction/resources";
import { postgresUrl } from "../support/postgresHelpers";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
type Working = Effect.Success<ReturnType<typeof makeLogicalDocumentWorkingSet<Error>>>;
type NativeCapture = Readonly<{ kind: "indexPage" | "rows"; bodyIds: readonly AppRowIdHexV1[];
  bodyBytes: number; rawCount: number; withheld: number; transferBudget: number | undefined }>;
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
  let observing = false;
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
    if (!observing || !args[2]?.startsWith("fx_finite_") || mapper === undefined || fields === undefined) return;
    const kind = fields.some(field => field.path[0] === "raw" && field.path[1] === "valueBytes") ? "rows" :
      fields.some(field => field.path[0] === "raw" && field.path[1] === "encodedKeyBytes") ? "indexPage" : undefined;
    if (kind === undefined) return;
    let transferBudget: number | undefined;
    args[4] = rows => {
      const mapped = mapper(rows);
      if (!isNonArrayRecord(mapped) || !isNonArrayRecord(mapped.header) || mapped.header.reason !== "accepted" ||
        !Array.isArray(mapped.rawRows)) throw failure("Missing actual accepted native finite envelope");
      expect(mapped.layoutFailure).toBeUndefined();
      const raw: unknown[] = mapped.rawRows;
      const bodyIds: AppRowIdHexV1[] = [];
      let bodyBytes = 0, withheld = 0;
      if (kind === "rows") for (const value of raw) {
        if (!isNonArrayRecord(value)) throw failure("Missing original native capture row");
        if (value.valueBytes instanceof Uint8Array) { bodyIds.push(rowId(value.requestedRowId)); bodyBytes += value.valueBytes.byteLength; }
        if (value.bodyWithheld === true) withheld++;
      }
      captures.push({ kind, bodyIds, bodyBytes, rawCount: raw.length, withheld, transferBudget });
      if (kind === "indexPage") {
        membershipIds = raw.map(value => {
          if (!isNonArrayRecord(value)) throw failure("Missing native membership");
          return rowId(value.rowIdBytes);
        });
      }
      const injectFault = kind === "indexPage" ? corruptUniqueMembership || substituteCachedAbsence !== undefined
        : corruptBodyOrdinal !== undefined;
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
    return (bindings: unknown[]) => {
      const bound = bindings[0];
      if (!isNonArrayRecord(bound) || typeof bound.transferBudget !== "number")
        throw failure("Missing original native transfer budget binding");
      transferBudget = bound.transferBudget;
    };
  };
  const originalPglite = PgliteSession.prototype.prepareQuery, originalPostgres = NodePgSession.prototype.prepareQuery;
  PgliteSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(
    ...args: Parameters<typeof originalPglite<T>>
  ) {
    const observeBindings = wrap(args), prepared = (originalPglite<T>).apply(this, args);
    return observeBindings === undefined ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, bindings: unknown[]) {
        observeBindings(bindings);
        return Reflect.apply(execute, target, bindings);
      } });
    } });
  };
  NodePgSession.prototype.prepareQuery = function <T extends PreparedQueryConfig = PreparedQueryConfig>(
    ...args: Parameters<typeof originalPostgres<T>>
  ) {
    const observeBindings = wrap(args), prepared = (originalPostgres<T>).apply(this, args);
    return observeBindings === undefined ? prepared : new Proxy(prepared, { get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver);
      return new Proxy(target.execute, { apply(execute, _receiver, bindings: unknown[]) {
        observeBindings(bindings);
        return Reflect.apply(execute, target, bindings);
      } });
    } });
  };
  return {
    captures,
    get membershipIds() { return membershipIds; },
    get corruptBodyReads() { return corruptBodyReads; },
    begin(input: Readonly<{ corruptUniqueMembership?: boolean; substituteCachedAbsence?: AppRowIdHexV1;
      corruptBodyOrdinal?: number }> = {}) {
      captures.length = 0; membershipIds = []; corruptBodyReads = 0; observing = true;
      corruptUniqueMembership = input.corruptUniqueMembership ?? false;
      substituteCachedAbsence = input.substituteCachedAbsence;
      corruptBodyOrdinal = input.corruptBodyOrdinal;
    },
    stop() { observing = false; },
    restore() {
      Object.defineProperty(PgliteSession.prototype, "prepareQuery", pglite);
      Object.defineProperty(NodePgSession.prototype, "prepareQuery", postgres);
    },
  };
}

type ReadCase = Readonly<{
  identities?: number;
  beforeRead?: (selection: "point" | "batch" | "scan" | "index", lifetime: BoundedRequestLifetime<Error>) => Effect.Effect<void, Error>;
  afterMembership?: (lifetime: BoundedRequestLifetime<Error>) => Effect.Effect<void, Error>;
  run: (working: Working, lifetime: BoundedRequestLifetime<Error>, id: string,
    root: NonNullable<Parameters<typeof requireLogicalDocumentRootEvaluatorOpen>[0]>) => Effect.Effect<void, Error>;
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
            { calls: 64, commandBytes: 1_048_576, commandMs: 10_000 }, input.attempt, {}, "finite-body-permission", "write");
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
          return { working, lifetime, id: yield* lifetime.begin(lifetime.context) };
        }), (_state, _checkedRead, { working, lifetime, id }) => Effect.succeed({
          abort: lifetime.close,
          currentUsage: () => ({ workBytes: 1_048_576 - lifetime.remainingBytes(), workCalls: lifetime.usedCalls() }),
          invoke: () => selected.run(working, lifetime, id, root).pipe(
            Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })),
            Effect.tap(() => Effect.sync(() => { completed = true; })),
            Effect.andThen(Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: "read-only witness discards root" }))),
            Effect.ensuring(lifetime.close)),
        })).pipe(Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })));
    }));
    expect(completed).toBe(true);
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
        try { await runReadCase(fixture, originalParticipant, selected); }
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
});
