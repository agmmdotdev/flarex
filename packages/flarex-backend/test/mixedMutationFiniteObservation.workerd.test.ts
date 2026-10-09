import { eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { readCapturedFiniteMetadataReservation } from "../../persistence-postgres/src/execution/finiteMetadataReservation";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/execution/sessionJournalStore";
import { fxSystemTransactionSessions, fxSystemTransactionJournalReceipts, fxSystemTransactionJournals } from "../../persistence-postgres/src/database/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { rebindMixedMutationApplication } from "./support/mixedMutationApplicationRebinding";

const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });
const dataRead = /\bfx_app_(?:row_rev|index_entry_(?:rev|current)|unique_key)\b/;
const sourcePhase = /^(?:product:|payload:|workflow:)/;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];
type ReadFrontier = Readonly<{ phase: string; statements: readonly string[] }>;

/** Observe issued SQL at the existing fixture boundary. Entry, freeze and
 * publication are deliberately excluded from read frontiers. */
function collectReadFrontiers() {
  const completed: ReadFrontier[] = [];
  let current: { phase: string; statements: string[] } | undefined;
  return {
    observe(phase: string, statement: string) {
      if (/^\s*begin\b/i.test(statement)) current = { phase, statements: [] };
      else if (/^\s*(?:commit|rollback)\b/i.test(statement)) {
        if (current !== undefined && sourcePhase.test(current.phase) && current.statements.some(sql => dataRead.test(sql)))
          completed.push(current);
        current = undefined;
      } else current?.statements.push(statement);
    },
    frontiers: completed,
  };
}

function assertFixedMetadataFrontier(frontier: ReadFrontier) {
  const reads = (table: string) => frontier.statements.filter(statement =>
    new RegExp(`\\bfrom\\s+"${table}"(?:\\s|$)`, "i").test(statement)).length;
  expect(reads("fx_system_data_binding_head"), frontier.phase).toBe(0);
  expect(reads("fx_system_data_binding_activation"), frontier.phase).toBe(0);
  expect(reads("fx_system_application_active_head"), frontier.phase).toBe(0);
  expect(reads("fx_system_application_revision_schema_v1"), frontier.phase).toBe(0);
  // Both data owners use the scope identity already accepted by this frontier's
  // finite kernel; its fresh authority and anchor guards remain present below.
  const scopeIdentityReads = frontier.statements.filter(statement => {
    const compact = statement.replace(/\s+/g, "").toLowerCase();
    return compact.startsWith('select"fx_system_scope_clock"."scope_id","fx_system_scope_clock"."scope_uuid"from"fx_system_scope_clock"') ||
      compact.startsWith('select"fx_system_scope_clock"."scope_uuid"from"fx_system_scope_clock"');
  });
  expect(scopeIdentityReads, frontier.phase).toHaveLength(0);
  expect(frontier.statements.some(statement => /\bfx_lock_finite_running_attempt\b/.test(statement)),
    frontier.phase).toBe(false);
  expect(frontier.statements.some(statement => /\bfrom\s+"fx_system_scope_execution_authority"[\s\S]*\bfor\s+share\b/i.test(statement)),
    frontier.phase).toBe(true);
  expect(frontier.statements.some(statement => /\bfrom\s+"fx_system_tx_session"[\s\S]*\bfor\s+share\b/i.test(statement)),
    frontier.phase).toBe(true);
}

describe("fixed finite metadata through native Worker graphs", () => {
  it.each(["product", "payload", "workflow"] as const)(
    "uses captured metadata and live authority in each %s read frontier", async profile => {
      const observed = collectReadFrontiers();
      const common = { driver: "pglite" as const,
        suffix: `finite-observation-${profile}`,
        hooks: { observeSql: observed.observe },
      };
      const fixture = await createMixedMutationProductFixture(profile === "workflow"
        ? { ...common, workflow: true, payloadProfile: "success" }
        : profile === "payload" ? { ...common, payloadProfile: "success" } : common);
      try {
        const native = await Effect.runPromise(fixture.currency.application.activation.readActive());
        expect(native.basis.schemaVersionId).not.toBe(fixture.currency.schemaVersionId);
        const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
        const result = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
        expect(fixture.hasSqlObserver).toBe(true);
        expect(fixture.currency.managedRead).toBeUndefined();
        expect(observed.frontiers.length).toBeGreaterThan(1);
        for (const frontier of observed.frontiers) assertFixedMetadataFrontier(frontier);
        if (profile === "product") {
          expect(result).toMatchObject({ updated: { id: fixture.seed.productId },
            pending: { title: fixture.seed.newTitle }, listed: [{ id: fixture.seed.productId }] });
          expect(fixture.nativeInvokeCount.get("update")).toBe(1);
        } else {
          expect(result).toMatchObject({ final: { title: fixture.seed.newTitle, score: 1, enabled: true } });
          expect(fixture.payload?.current()?.observations.hookRuns()).toBe(1);
          expect(fixture.payload?.current()?.observations.nestedReads()).toBe(1);
          if (profile === "workflow") {
            expect(result).toMatchObject({ workflow: { pricing: {
              variants: [expect.objectContaining({ product_id: fixture.seed.productId })],
              priceSets: [expect.objectContaining({ prices: [expect.objectContaining({ currency_code: "USD", amount: 50 })] })],
              links: [expect.objectContaining({ id: expect.any(String) })],
            } } });
            expect(fixture.nativeInvokeCount.get("workflow:run")).toBe(1);
          }
        }
        const frozen = await Effect.runPromise(fixture.freeze(result));
        const graph = readFrozenFiniteAttempt(frozen);
        if (graph === undefined) throw new Error("Missing authentic frozen graph");
        const publication = await fixture.prepareFrozenPublication(frozen);
        const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
          .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
        expect(roots).toHaveLength(0);
        const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
        if (session === undefined) throw new Error("Missing finite graph compact anchor");
        const anchor = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
        const reservation = anchor.reservation;
        if (reservation === null || graph.metadataReservation === undefined)
          throw new Error("Missing authentic finite metadata reservation");
        expect(reservation.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
        expect(readCapturedFiniteMetadataReservation(graph.metadataReservation)).toEqual(reservation);
        expect(graph.graph.metadataDependencies?.length).toBeGreaterThan(0);
        const operations = graph.operations.filter(operation => operation.kind === "participant");
        for (const operation of operations) for (const source of operation.sourceRefs) {
          expect(source.sourceSha256Hex).toMatch(/^[0-9a-f]{64}$/);
          expect(source.sourceBindingSha256Hex).toMatch(/^[0-9a-f]{64}$/);
          expect(source.methods.length).toBeGreaterThan(0);
        }
        const sourceKeys = new Set(operations.flatMap(operation => operation.sourceRefs.map(source => source.sourceKey)));
        expect(sourceKeys.has("medusa.product")).toBe(true);
        if (profile !== "product") {
          expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
          expect(sourceKeys.size).toBeGreaterThanOrEqual(profile === "workflow" ? 4 : 2);
        }
        if (profile === "workflow") for (const key of ["medusa.pricing", "medusa.link.productVariantPriceSet"])
          expect(sourceKeys.has(key), key).toBe(true);
        expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
        expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally { await fixture.close(); }
    }, 180_000);

  it("keeps a newly discovered handle unique-index demand inside the initial write frontier", async () => {
    const observed = collectReadFrontiers();
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let checked = false;
    fixture = await createMixedMutationProductFixture({ driver: "pglite", suffix: "finite-observation-dynamic-index",
      hooks: {
        observeSql: observed.observe,
        afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
          const store = yield* borrowed.context.table("product");
          // Hydrate the identity without loading this working set's timestamp.
          // The next write starts with rows/clock demand, then discovers the
          // conditional handle unique constraint's historical ordered index.
          expect(yield* store.find(borrowed.context.manager, {
            predicate: { kind: "in", column: "id", values: [fixture.seed.productId] },
            order: { column: "id", direction: "asc" },
          })).toHaveLength(1);
          const before = observed.frontiers.length;
          const temporaryHandle = `${fixture.seed.newHandle}-before-native`;
          expect(yield* store.write(borrowed.context.manager, "update", [
            { id: fixture.seed.productId, handle: temporaryHandle },
          ])).toMatchObject([{ id: fixture.seed.productId, handle: temporaryHandle }]);
          expect(observed.frontiers.length).toBe(before + 1);
          const frontier = observed.frontiers.at(-1);
          if (frontier === undefined) throw new Error("Missing dynamic unique-index frontier");
          expect(frontier.statements.some(statement => /\bfx_app_index_entry_rev\b/.test(statement))).toBe(true);
          assertFixedMetadataFrontier(frontier);
          checked = true;
        }),
      },
    });
    try {
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const result = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      expect(result).toMatchObject({ updated: { id: fixture.seed.productId, handle: fixture.seed.newHandle },
        pending: { title: fixture.seed.newTitle }, listed: [{ id: fixture.seed.productId }] });
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      expect(await fixture.publish(result)).toMatchObject({ kind: "published" });
      expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, handle: fixture.seed.newHandle });
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.each(drivers)("finite live authority on %s", driver => {
  it("keeps captured metadata through an equal-semantic Application activation and publishes", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let moved = false;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-metadata-equal-${driver}`,
      hooks: {
        afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
          const store = yield* borrowed.context.table("product");
          const select = (id: string) => store.find(borrowed.context.manager, {
            predicate: { kind: "in" as const, column: "id", values: [id] },
            order: { column: "id", direction: "asc" as const },
          });
          expect(yield* select(fixture.seed.productId)).toHaveLength(1);
          const active = yield* Effect.tryPromise({ try: () => fixture.application.moveHead(),
            catch: cause => commerceError("resourceFailure", cause) });
          expect(active.basis.revisionId).not.toBe(fixture.active.basis.revisionId);
          // This identity was not previously observed by the working set.
          expect(yield* select("prod_00000000000000000000000000")).toHaveLength(0);
          moved = true;
        }),
      },
    });
    try {
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const result = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      expect(moved, fixture.bridgeFailures.join("\n")).toBe(true);
      expect(await fixture.publish(result)).toMatchObject({ kind: "published" });
      const rebound = await rebindMixedMutationApplication(fixture, `equal-semantic-read-${driver}`);
      expect(await rebound.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId, title: fixture.seed.newTitle });
      expect(await rebound.proveCurrentInitializationAndWrite()).toMatchObject({ readCallbacks: 2, writeCallbacks: 1 });
      expect(fixture.retryContexts).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a real scope revocation after a successful borrowed read and poisons freeze", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let checked = false;
    let checkingRead = false;
    let dataStatements = 0;
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-observation-stale-${driver}`,
      hooks: {
        observeSql: (_phase, statement) => { if (checkingRead && dataRead.test(statement)) dataStatements++; },
        afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
          const store = yield* borrowed.context.table("product");
          const select = (id: string) => store.find(borrowed.context.manager, {
            predicate: { kind: "in" as const, column: "id", values: [id] },
            order: { column: "id", direction: "asc" as const },
          });
          checkingRead = true;
          expect(yield* select(fixture.seed.productId)).toHaveLength(1);
          checkingRead = false;
          if (fixture.hasSqlObserver) expect(dataStatements).toBeGreaterThan(0);
          yield* Effect.tryPromise({ try: async () => {
            await fixture.currency.persistence.drizzle.transaction(tx => Effect.runPromise(
              advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, fixture.activation.anchor.scopeId)));
          }, catch: cause => commerceError("resourceFailure", cause) });
          dataStatements = 0;
          checkingRead = true;
          // An unobserved valid identity requires a new actual storage frontier.
          const refused = yield* Effect.result(select("prod_00000000000000000000000000"));
          checkingRead = false;
          expect(Result.isFailure(refused)).toBe(true);
          if (Result.isFailure(refused)) expect(refused.failure).toMatchObject({
            _tag: "CommerceTransactionError", reason: "invalidAuthority",
          });
          if (fixture.hasSqlObserver) expect(dataStatements).toBe(0);
          checked = true;
        }),
      },
    });
    try {
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      expect(await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId))).toHaveLength(0);
      await expect(Effect.runPromise(fixture.freeze(null)))
        .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
    } finally { await fixture.close(); }
  }, 180_000);
});
