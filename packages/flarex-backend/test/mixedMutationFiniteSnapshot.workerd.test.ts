import { and, eq } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { logicalTableKey } from "flarex-protocol/internal/logical-schema-candidate";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../../persistence-postgres/src/installation/frameworkSchema/binding/repository";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/execution/sessionJournalFiniteFreeze";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/pointCommitTransaction";
import { fxAppRowRevisions, fxSystemIndexBuildStates, fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities, fxSystemTransactionSessions } from "../../persistence-postgres/src/database/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const WorkerSuccess = Schema.Struct({ kind: Schema.Literal("result"),
  result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) });
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("finite original-snapshot Product serving on %s", driver => {
  it("reads the old handle through real closed index coverage after data and equal-semantic binding publication", async () => {
    let fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
    let observing = false;
    let restoreObserver = () => {};
    const frontiers: string[][] = [];
    let historicalIndex: number | undefined;
    let checked = false;
    const observe = (statement: string) => {
      if (!observing) return;
      // Each installed capture is one implicit target statement. Its accepted
      // authority cut and named historical read share this submission.
      if (/\bfx_accept_finite_storage_capture\b/.test(statement)) frontiers.push([statement]);
    };
    fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-snapshot-${driver}`, hooks: {
      observeSql: (_phase, statement) => observe(statement),
      onPreparedContext: async currency => {
        if (currency.resource.kind !== "postgres") return undefined;
        // Observe actual accepting target submissions; the fixture's SQL
        // callback is PGlite-only.
        const pool = currency.resource.target.pool;
        const patched = new Map<PoolClient, PoolClient["query"]>();
        const onAcquire = (client: PoolClient) => {
          const original = client.query;
          client.query = new Proxy(original, { apply(query, receiver, args: unknown[]) {
            const result: unknown = Reflect.apply(query, receiver, args);
            if (!observing || args.some(arg => typeof arg === "function")) return result;
            const first = args[0];
            const statement = typeof first === "string" ? first
              : isNonArrayRecord(first) && typeof first.text === "string" ? first.text : "";
            return Promise.resolve(result).then(value => { observe(statement); return value; });
          } });
          patched.set(client, original);
        };
        const onRelease = (_error: Error | undefined, client: PoolClient) => {
          const original = patched.get(client);
          if (original !== undefined) client.query = original;
          patched.delete(client);
        };
        pool.on("acquire", onAcquire); pool.on("release", onRelease);
        restoreObserver = () => {
          pool.off("acquire", onAcquire); pool.off("release", onRelease);
          for (const [client, original] of patched) client.query = original;
        };
        return undefined;
      },
      afterProductBorrow: (method, borrowed) => method !== "update" ? Effect.void : Effect.gen(function* () {
        const store = yield* borrowed.context.table("product");
        const baseline = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String, handle: Schema.String }))(fixture.baseline);
        const originalSnapshot = fixture.activation.anchor.snapshotToken.commitSeq;
        observing = true;
        const first = yield* store.find(borrowed.context.manager, {
          predicate: { kind: "in", column: "id", values: [fixture.seed.productId] },
          order: { column: "id", direction: "asc" },
        });
        observing = false;
        expect(first).toMatchObject([{ id: fixture.seed.productId, title: baseline.title,
          handle: baseline.handle }]);
        expect(frontiers).toHaveLength(1);
        expect(frontiers[0]?.[0]).toMatch(/\bfx_read_snapshot_index_page\b/);
        expect(frontiers[0]?.[0]).toMatch(/\bfx_read_snapshot_rows\b/);
        // A repeated exact unique selection consumes its authenticated cached
        // owner and original body without opening another storage demand.
        observing = true;
        expect(yield* store.find(borrowed.context.manager, {
          predicate: { kind: "in", column: "id", values: [fixture.seed.productId] },
          order: { column: "id", direction: "asc" },
        })).toEqual(first);
        observing = false;
        expect(frontiers).toHaveLength(1);
        observing = true;
        const missing = yield* store.find(borrowed.context.manager, {
          predicate: { kind: "in", column: "id", values: [`${fixture.seed.productId}-missing`] },
          order: { column: "id", direction: "asc" },
        });
        observing = false;
        expect(missing).toEqual([]);
        expect(frontiers).toHaveLength(2);
        expect(frontiers[1]?.[0]).toMatch(/\bfx_read_snapshot_index_page\b/);
        expect(frontiers[1]?.[0]).toMatch(/\bfx_read_snapshot_rows\b/);
        expect(fixture.getOpenTransactionDepth()).toBe(0);

        const requirements = yield* readLogicalStorageRequirements(fixture.currency.control.drizzle,
          fixture.currency.deploymentId, fixture.logicalSchemaVersionId)
          .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
        const source = requirements.evidence.candidate.sources.find(member => member.key === "medusa.product");
        const binding = source?.bindings.find(member => member.localName === "product");
        const table = binding === undefined ? undefined : requirements.evidence.tableBindings
          .find(member => logicalTableKey(member.table) === logicalTableKey(binding.table));
        if (table === undefined) throw new Error("Missing genuine Product table binding");
        const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(fixture.currency.control.drizzle,
          { deploymentId: fixture.currency.deploymentId, schemaVersionId: fixture.logicalSchemaVersionId })
          .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
        if (snapshot === null) throw new Error("Missing genuine Product immutable catalog");
        const definitions = yield* Effect.forEach(snapshot.definitions.filter(member => member.access.tableId === table.tableId),
          member => locateAppIndexDefinitionByIdEffect(fixture.currency.control.drizzle,
            fixture.activation.anchor.scopeId, member.indexDefinitionId))
          .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
        const handle = definitions.find(member => member !== null && member.access.kind === "developer" &&
          member.physicalSpec.orderedFields[0]?.kind === "documentPath" &&
          member.physicalSpec.orderedFields[0].path === "handle" &&
          member.physicalSpec.predicate?.kind === "fieldIsNull" && member.physicalSpec.predicate.field === "deleted_at");
        if (handle == null) throw new Error("Missing genuine Product historical handle index");
        historicalIndex = handle.indexDefinitionId;

        yield* Effect.tryPromise({ try: async () => {
          const scopeId = fixture.activation.anchor.scopeId;
          const [before] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeClocks)
            .where(eq(fxSystemScopeClocks.scopeId, scopeId));
          const [authorityBefore] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
            .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
          if (before === undefined || authorityBefore === undefined) throw new Error("Missing genuine scope state");
          const standalone = { title: `${fixture.seed.newTitle}-standalone`, handle: `${fixture.seed.newHandle}-standalone` };
          await fixture.runStandaloneProductUpdate(standalone);
          expect(await fixture.readCurrentProduct()).toMatchObject(standalone);

          const location = { scopeId, storageGeneration: fixture.activation.anchor.storageGeneration };
          const selected = await fixture.currency.persistence.drizzle.transaction(tx =>
            Effect.runPromise(readBindingSelectedEvidence(tx, location)));
          if (Option.isNone(selected)) throw new Error("Missing actual binding selection");
          const host = await Effect.runPromise(makeDataBindingHost({ database: fixture.currency.persistence.drizzle,
            selection: { deploymentId: fixture.currency.deploymentId, scopeId }, target: fixture.currency.bindingTarget,
            authority: fixture.application.authorityPorts, application: fixture.application.activation,
            logicalStorage: { controlDb: fixture.currency.control.drizzle, schemaVersionId: fixture.logicalSchemaVersionId,
              unique: fixture.application.uniqueConstraintEligibility } }));
          const candidate = await Effect.runPromise(host.prepare(selected.value.candidate.frame));
          expect(candidate.sha256).toBe(selected.value.candidate.sha256);
          const activated = await Effect.runPromise(host.activate(dataBindingActivationRequest(scopeId,
            location.storageGeneration, `finite-snapshot-same-candidate-${driver}`, candidate.sha256,
            { sequence: selected.value.head.frame.sequence, sha256: selected.value.head.sha256 })));
          expect(Result.getOrThrow(activated.current).selected).toBe(true);
          const next = await fixture.currency.persistence.drizzle.transaction(tx =>
            Effect.runPromise(readBindingSelectedEvidence(tx, location)));
          if (Option.isNone(next)) throw new Error("Missing reactivated genuine binding");
          expect(next.value.candidate.sha256).toBe(selected.value.candidate.sha256);
          expect(BigInt(next.value.head.frame.sequence)).toBeGreaterThan(BigInt(selected.value.head.frame.sequence));

          const [current] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeClocks)
            .where(eq(fxSystemScopeClocks.scopeId, scopeId));
          const [authority] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeExecutionAuthorities)
            .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
          const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
            .where(and(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId),
              eq(fxSystemTransactionSessions.attemptFence, fixture.activation.anchor.attemptFence)));
          const [build] = await fixture.currency.persistence.drizzle.select().from(fxSystemIndexBuildStates)
            .where(and(eq(fxSystemIndexBuildStates.scopeId, scopeId),
              eq(fxSystemIndexBuildStates.indexDefinitionId, handle.indexDefinitionId)));
          if (current === undefined || authority === undefined || session === undefined || build === undefined)
            throw new Error("Missing real serving proof after publication");
          const anchor = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
          if (anchor.reservation === null) throw new Error("Missing authentic finite reservation");
          expect(current.lastCommitSeq).toBeGreaterThan(originalSnapshot);
          expect(current.lastMetadataSequence).toBeGreaterThan(before.lastMetadataSequence);
          expect(authority.authorizationRevocationEpoch).toBe(authorityBefore.authorizationRevocationEpoch);
          expect(anchor.snapshotToken.commitSeq).toBe(originalSnapshot);
          expect(anchor.reservation.metadataWatermark).toBe(before.lastMetadataSequence);
          expect(build.lifecycle).toBe("enabled");
          if (build.firstReadableCommitSeq === null || build.coveredThroughCommitSeq === null)
            throw new Error("Missing real closed historical index coverage");
          expect(build.firstReadableCommitSeq).toBeLessThanOrEqual(originalSnapshot);
          // This real source-bound closed prefix certifies the old snapshot.
          // No current Application certificate's open suffix is borrowed.
          expect(build.coveredThroughCommitSeq).toBeGreaterThanOrEqual(originalSnapshot);
          expect(build.coveredThroughCommitSeq).toBeLessThanOrEqual(current.lastCommitSeq);
        }, catch: cause => commerceError("resourceFailure", cause) });

        const beforeLookup = frontiers.length;
        observing = true;
        const historical = yield* store.find(borrowed.context.manager, {
          predicate: { kind: "and", children: [
            { kind: "in", column: "handle", values: [baseline.handle] },
            { kind: "isNull", column: "deleted_at" },
          ] }, order: { column: "handle", direction: "asc" },
        });
        observing = false;
        expect(historical).toMatchObject([{ id: fixture.seed.productId, title: baseline.title,
          handle: baseline.handle }]);
        expect(historical).toHaveLength(1);
        expect(frontiers).toHaveLength(beforeLookup + 1);
        const frontier = frontiers.at(-1);
        if (frontier === undefined) throw new Error("Missing actual original-snapshot frontier");
        expect(frontier.some(statement => /\bfx_read_snapshot_index_page\b/.test(statement))).toBe(true);
        expect(frontier.some(statement => /\bfx_read_snapshot_rows\b/.test(statement))).toBe(true);
        expect(frontier.some(statement => /\bfx_accept_finite_storage_capture\b/.test(statement))).toBe(true);
        expect(frontier.some(statement => /\bfx_system_(?:snapshot_lease|tx_journal|tx_execution_claim)\b/.test(statement))).toBe(false);
        expect(frontier.some(statement => /\bfrom\s+"fx_system_(?:data_binding_head|application_active_head)"/i.test(statement))).toBe(false);
        expect(fixture.getOpenTransactionDepth()).toBe(0);
        checked = true;
      }),
    } });
    try {
      const success = Schema.decodeUnknownSync(WorkerSuccess)(await fixture.runExecution());
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(success.result.result))).value;
      expect(checked, fixture.bridgeFailures.join("\n")).toBe(true);
      const frozen = await Effect.runPromise(fixture.freeze(returnedValue));
      const graph = readFrozenFiniteAttempt(frozen);
      if (graph === undefined) throw new Error("Missing issuer-authentic frozen graph");
      const publication = await fixture.prepareFrozenPublication(frozen);
      const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
      if (session === undefined) throw new Error("Missing genuine compact anchor");
      const anchor = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
      if (anchor.reservation === null) throw new Error("Missing actual finite reservation");
      expect(anchor.reservation.snapshotToken).toEqual(fixture.activation.anchor.snapshotToken);
      const historicalEntries = [...graph.graph.indexReads, ...graph.graph.pageReads]
        .filter(range => range.definition.indexDefinitionId === historicalIndex).flatMap(range => range.entries);
      expect(historicalEntries.length).toBeGreaterThan(0);
      expect(historicalEntries.every(entry => BigInt(entry.commitSeq) <= fixture.activation.anchor.snapshotToken.commitSeq)).toBe(true);
      const [beforeConflict] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeClocks)
        .where(eq(fxSystemScopeClocks.scopeId, fixture.activation.anchor.scopeId));
      if (beforeConflict === undefined) throw new Error("Missing publication sequencer");
      const outcome = await Effect.runPromise(Effect.result(publication));
      if (Result.isSuccess(outcome)) throw new Error("Concurrent Product publication did not conflict");
      expect(outcome.failure).toBeInstanceOf(PointCommitConflictV1Error);
      if (!(outcome.failure instanceof PointCommitConflictV1Error)) throw new Error("Expected genuine data conflict");
      expect(outcome.failure.conflict.kind).toBe("finiteRootGraph");
      expect(outcome.failure.snapshotCommitSeq).toBe(fixture.activation.anchor.snapshotToken.commitSeq);
      expect(outcome.failure.currentCommitSeq).toBeGreaterThan(outcome.failure.snapshotCommitSeq);
      const [afterConflict] = await fixture.currency.persistence.drizzle.select().from(fxSystemScopeClocks)
        .where(eq(fxSystemScopeClocks.scopeId, fixture.activation.anchor.scopeId));
      expect(afterConflict?.lastCommitSeq).toBe(beforeConflict.lastCommitSeq);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const applicationWrites = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, CatalogTableIdSchema.make(1))));
      expect(applicationWrites).toHaveLength(0);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(events.filter(event => event.envelope.contract === fixture.binding.metadata.product.updatedEvent)).toHaveLength(1);
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: `${fixture.seed.newTitle}-standalone`,
        handle: `${fixture.seed.newHandle}-standalone` });
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1, retrieve: 1, listByHandle: 1 });
      expect(fixture.retryContexts).toHaveLength(0);
    } finally { restoreObserver(); await fixture.close(); }
  }, 240_000);
});
