import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import {
  encodeAdmittedFrameworkOperationV1Result,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import { describe, expect, it, vi } from "vitest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { prepareLogicalSourceEvidence } from "../../src/storage/documents/logicalDocuments/sourceAdmission";
import {
  prepareLogicalRelationalAdmission,
} from "../../src/storage/documents/logicalDocuments/relationalAdmission";
import {
  LogicalParticipantInvocationError,
} from "../../src/storage/documents/logicalDocuments/participantErrors";
import type { FiniteStorageCaptureError } from "../../src/execution/finiteStorageCapture";
import type {
  LogicalStorageReadDemand,
  LogicalFiniteStorageCapture,
} from "../../src/storage/documents/logicalDocuments/model";
import { prepareLogicalStorageReadiness } from "../../src/storage/catalog/logicalStorageReadiness";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../src/scope/scopeAuthorityResolution";
import type {
  FiniteSessionJournalParticipantSelection,
} from "../../src/execution/journal/api";
import { fxAppRowRevisions, fxSystemCommits, fxSystemIndexBuildStates, fxSystemSearchBuildStates,
  fxSystemTransactionSessions, fxSystemUniqueConstraintBuilds } from "../../src/database/schema";
import { fxSystemCommitEvents } from "../../src/commit/events/schema";
import {
  createMixedMutationProductFixture,
} from "../../../executor/test/performance/support/mixedMutationProductFixture";
import { postgresUrl } from "../support/postgresHelpers";

const drivers = postgresUrl === null ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("finite source capability acceptance on %s", driver => {
  for (const kind of ["index", "unique", "search"] as const) {
    it(`accepts an unused unready ${kind}, refuses its demand and poisons the actual root`, async () => {
      let source: Effect.Success<ReturnType<typeof prepareLogicalSourceEvidence>> | undefined;
      let prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>> | undefined;
      let participant: FiniteSessionJournalParticipantSelection | undefined;
      let demand: LogicalStorageReadDemand | undefined;
      const restore: Array<() => Promise<unknown>> = [];
      const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-source-${kind}-${driver}`, hooks: {
        onPreparedContext: async currency => {
          const logical = currency.hostInput.logicalStorage;
          const location = { deploymentId: currency.deploymentId, scopeId: currency.application.authority.scopeId,
            schemaVersionId: currency.schemaVersionId };
          const catalog = await Effect.runPromise(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
          if (catalog.status !== "prepared") throw new Error("Missing genuine source catalog");
          const input = { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
            schema: currency.currencyDefinition.schema, evidence: currency.currencyDefinition.provenance };
          source = await Effect.runPromise(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
            { sourceKey: input.sourceKey, writeProfile: input.writeProfile,
              definition: { kind: "relational", schema: input.schema }, evidence: input.evidence },
            "medusa", "relational", { kind: "prepared", catalog }));
          prepared = await Effect.runPromise(prepareLogicalRelationalAdmission(logical.ports, logical.unique,
            location, input, { kind: "prepared", catalog }));
          return undefined;
        },
        transformFiniteEntrySources: participants => {
          const original = participants[0];
          if (original === undefined || prepared === undefined) throw new Error("Missing genuine finite source construction");
          // The trusted fixture selects an actual source for this acceptance
          // witness. Its profile/method pins still come from the real journal.
          participant = { ...original, sources: [{ selection: prepared, methods: original.operationMethods }] };
          return [participant];
        },
        beforeFinalEntry: async ({ currency }) => {
          if (source === undefined) throw new Error("Missing selected source evidence");
          const db = currency.persistence.drizzle;
          const scopeId = currency.application.authority.scopeId;
          if (kind === "index") {
            const definition = source.indexes.find(member => member.access.kind === "developer");
            if (definition === undefined || definition.access.kind !== "developer") throw new Error("Missing actual source ordered index");
            const where = and(eq(fxSystemIndexBuildStates.scopeId, scopeId),
              eq(fxSystemIndexBuildStates.indexDefinitionId, definition.indexDefinitionId));
            const [original] = await db.select().from(fxSystemIndexBuildStates).where(where);
            if (original?.lifecycle !== "enabled") throw new Error("Source index was not originally serving");
            restore.push(() => currency.testOwner.drizzle.update(fxSystemIndexBuildStates).set(original).where(where));
            expect(await currency.testOwner.drizzle.update(fxSystemIndexBuildStates).set({ lifecycle: "validating",
              maintenanceActivationSequence: null }).where(where).returning())
              .toHaveLength(1);
            demand = { kind, tableId: definition.access.tableId, indexDefinitionId: definition.indexDefinitionId };
          } else if (kind === "unique") {
            const definition = source.unique[0];
            if (definition === undefined) throw new Error("Missing actual source unique definition");
            const where = and(eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId),
              eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, definition.uniqueConstraintDefinitionId));
            const [original] = await db.select().from(fxSystemUniqueConstraintBuilds).where(where);
            if (original?.lifecycle !== "enabled") throw new Error("Source unique definition was not originally serving");
            restore.push(() => currency.testOwner.drizzle.update(fxSystemUniqueConstraintBuilds).set(original).where(where));
            expect(await currency.testOwner.drizzle.update(fxSystemUniqueConstraintBuilds).set({ lifecycle: "validating",
              maintenanceActivationSequence: null }).where(where).returning())
              .toHaveLength(1);
            demand = { kind, tableId: definition.tableId, uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId };
          } else {
            const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
            const [original] = await db.select().from(fxSystemSearchBuildStates).where(and(
              eq(fxSystemSearchBuildStates.scopeUuid, scopeUuid), eq(fxSystemSearchBuildStates.sourceSha256, source.source.sourceSha256)));
            if (original?.lifecycle !== "ready") throw new Error("Missing actual ready source search build");
            const where = and(eq(fxSystemSearchBuildStates.scopeUuid, scopeUuid),
              eq(fxSystemSearchBuildStates.tableId, original.tableId), eq(fxSystemSearchBuildStates.logicalIndexId, original.logicalIndexId));
            restore.push(() => db.update(fxSystemSearchBuildStates).set(original).where(where));
            expect(await db.update(fxSystemSearchBuildStates).set({ lifecycle: "building" }).where(where).returning()).toHaveLength(1);
            demand = { kind, tableId: original.tableId, logicalIndexId: original.logicalIndexId };
          }
        },
      } });
      try {
        if (source === undefined || participant === undefined || demand === undefined) throw new Error("Missing admitted source witness");
        const admittedSource = source;
        const admittedParticipant = participant;
        const admittedDemand = demand;
        if (admittedDemand.kind === "clock") throw new Error("Expected actual source storage demand");
        const method = admittedParticipant.operationMethods[0];
        if (method === undefined) throw new Error("Missing genuine admitted method");
        expect(fixture.activation.status).toBe("created");
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
        const scopeId = fixture.activation.anchor.scopeId;
        const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
        const db = fixture.currency.persistence.drizzle;
        const inspect = async () => ({
          sessions: await db.select().from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId)),
          rows: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
          commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
          events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)),
        });
        const before = await inspect();
        const resolved = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityEffect(fixture.activation.anchor.deploymentId,
          fixture.application.authorityPorts));
        const full = await db.transaction(tx => Effect.runPromise(Effect.gen(function* () {
          const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
          return yield* admittedSource.withBinding(fixture.active.selection, tx, resolved.authority, clock,
            () => Effect.die("Unready full admission must not enter")).pipe(Effect.result);
        })));
        expect(full).toMatchObject({ _tag: "Failure", failure: { reason: "logicalSchemaNotReady" } });
        const bundle = await Effect.runPromise(fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt,
          { ...admittedParticipant, sources: admittedParticipant.sources.map(member => ({ ...member, application: fixture.active.selection })) }));
        let closedCaptures = 0;
        let capturedStorage: LogicalFiniteStorageCapture<FiniteStorageCaptureError> | undefined;
        const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
          format: "flarex.admitted-framework-operation", version: 1,
          participant: admittedParticipant.participant, operation: method, args: {},
        }));
        const request = { syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          requestBytes: encoded.bytes, requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
          participant: admittedParticipant.participant, method, profileRevision: admittedParticipant.profileRevision };
        const refused = await Effect.runPromise(fixture.store.runAdmittedOperationEffect(fixture.persistenceAttempt,
          bundle, request, input => Effect.gen(function* () {
            if (input.captureStorage === undefined) return yield* Effect.die("Expected actual finite borrow");
            capturedStorage = input.captureStorage;
            yield* input.captureStorage({ kind: "transactionTime" }, { kind: "clock" }).pipe(
              Effect.tap(() => Effect.sync(() => { closedCaptures++; })),
              Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })));
            yield* input.captureStorage({ kind: "rows", input: {
              scopeId, tableId: admittedDemand.tableId, rowIds: [], snapshotCommitSeq: fixture.activation.anchor.snapshotToken.commitSeq,
            } }, admittedDemand).pipe(
              Effect.tap(() => Effect.sync(() => { closedCaptures++; })),
              Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })));
            return yield* Effect.die("Unready demanded source must not return a framework invocation capability");
          })).pipe(Effect.result));
        expect(refused).toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalParticipantInvocationError",
          cause: { _tag: "FiniteStorageCaptureError", reason: kind === "search" ? "invalidAuthority" : "notReady" } } });
        if (kind === "search") expect(refused).toMatchObject({ _tag: "Failure", failure: { cause: { cause: {
          _tag: "LogicalParticipantAdmissionError", reason: "unsupportedProfile", cause: "finiteHistoricalSearchUnsupported",
        } } } });
        expect(closedCaptures).toBe(1);
        if (capturedStorage === undefined) throw new Error("Missing genuine borrowed capture owner");
        expect(await Effect.runPromise(capturedStorage({ kind: "transactionTime" }, { kind: "clock" }).pipe(Effect.result)))
          .toMatchObject({ _tag: "Failure", failure: { _tag: "FiniteStorageCaptureError", reason: "invalidAuthority" } });
        expect(closedCaptures).toBe(1);
        expect(await inspect()).toEqual(before);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      } finally {
        try { for (const work of restore.reverse()) await work(); }
        finally { await fixture.close(); }
      }
    }, 240_000);
  }
});

describe.skipIf(postgresUrl === null)("finite capture effective PostgreSQL timeout", () => {
  for (const changedTimeout of ["0", "31s"] as const) {
    it(`refuses effective ${changedTimeout} before real installation and authority locks`, async () => {
      let participant: FiniteSessionJournalParticipantSelection | undefined;
      let source: Effect.Success<ReturnType<typeof prepareLogicalSourceEvidence>> | undefined;
      let prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>> | undefined;
      const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: `finite-timeout-${changedTimeout}`, hooks: {
        onPreparedContext: async currency => {
          const logical = currency.hostInput.logicalStorage;
          const location = { deploymentId: currency.deploymentId, scopeId: currency.application.authority.scopeId,
            schemaVersionId: currency.schemaVersionId };
          const catalog = await Effect.runPromise(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
          if (catalog.status !== "prepared") throw new Error("Missing genuine timeout witness catalog");
          const input = { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
            schema: currency.currencyDefinition.schema, evidence: currency.currencyDefinition.provenance };
          source = await Effect.runPromise(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
            { sourceKey: input.sourceKey, writeProfile: input.writeProfile,
              definition: { kind: "relational", schema: input.schema }, evidence: input.evidence },
            "medusa", "relational", { kind: "prepared", catalog }));
          prepared = await Effect.runPromise(prepareLogicalRelationalAdmission(logical.ports, logical.unique,
            location, input, { kind: "prepared", catalog }));
          return undefined;
        },
        transformFiniteEntrySources: participants => {
          const original = participants[0];
          if (original === undefined || prepared === undefined) throw new Error("Missing genuine timeout source");
          participant = { ...original, sources: [{ selection: prepared, methods: original.operationMethods }] };
          return [participant];
        },
      } });
      try {
        const resource = fixture.currency.resource;
        if (resource.kind !== "postgres" || fixture.currency.managedRead === undefined || participant === undefined || source === undefined)
          throw new Error("Expected genuine installed PostgreSQL capture target");
        const table = source.tables[0];
        const method = participant.operationMethods[0];
        if (table === undefined || method === undefined) throw new Error("Missing genuine source table and method");
        const admitted = participant;
        const bundle = await Effect.runPromise(fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt,
          { ...admitted, sources: admitted.sources.map(member => ({ ...member, application: fixture.active.selection })) }));
        const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({ format: "flarex.admitted-framework-operation", version: 1,
          participant: admitted.participant, operation: method, args: {} }));
        const request = { syscallSequence: CommitSyscallSequenceV1Schema.make(1n), requestBytes: encoded.bytes,
          requestSha256: new Uint8Array(createHash("sha256").update(encoded.bytes).digest()),
          participant: admitted.participant, method, profileRevision: admitted.profileRevision };
        const pool = resource.target.pool;
        const captureClient = await pool.connect();
        const blocker = await pool.connect();
        let captureReleased = false;
        const captureQueries = vi.spyOn(captureClient, "query");
        try {
          await blocker.query("begin");
          const locked = await blocker.query("select scope_id from fx_system_scope_execution_authority where scope_id=$1 for update",
            [fixture.activation.anchor.scopeId]);
          expect(locked.rows).toHaveLength(1);
          // Hold the real maintenance interlock too. A generic gate SQL failure
          // must not masquerade as the named acceptor's canonical refusal.
          await blocker.query("select pg_advisory_xact_lock(2147483002,(namespace_oid-2147483648)::integer) from fx_system_installation where singleton_id=1");
          await captureClient.query(`set statement_timeout = '${changedTimeout}'`);
          expect((await captureClient.query<{ statement_timeout: string }>("show statement_timeout")).rows)
            .toEqual([{ statement_timeout: changedTimeout }]);
          captureQueries.mockClear();
          captureClient.release(); captureReleased = true;
          expect(pool.idleCount).toBe(1);
          let refusal: FiniteStorageCaptureError | undefined;
          let bodyCompleted = false;
          const result = await Effect.runPromise(fixture.store.runAdmittedOperationEffect(fixture.persistenceAttempt,
            bundle, request, input => Effect.gen(function* () {
              if (input.captureStorage === undefined) return yield* Effect.die("Missing genuine borrowed capture");
              yield* input.captureStorage({ kind: "rows", input: { scopeId: fixture.activation.anchor.scopeId,
                tableId: table.tableId, rowIds: [], snapshotCommitSeq: fixture.activation.anchor.snapshotToken.commitSeq } },
              { kind: "rows", tableId: table.tableId }).pipe(
                Effect.tapError(cause => Effect.sync(() => { refusal = cause; })),
                Effect.mapError(cause => new LogicalParticipantInvocationError({ kind: "infrastructure", cause })));
              bodyCompleted = true;
              return yield* Effect.die("An unbounded effective session must not lend a body");
            })).pipe(Effect.result, Effect.timeout("1 second")));
          expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalParticipantInvocationError",
            cause: { _tag: "FiniteStorageCaptureError", reason: "resourceFailure" } } });
          expect(refusal?.reason).toBe("resourceFailure");
          expect(refusal?.cause).toBeUndefined();
          expect(bodyCompleted).toBe(false);
          expect(captureQueries.mock.calls.some(call => {
            const query: unknown = call[0];
            if (typeof query !== "object" || query === null) return false;
            const text: unknown = Reflect.get(query, "text");
            return typeof text === "string" && text.includes("fx_accept_finite_storage_capture");
          })).toBe(true);
          expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
        } finally {
          captureQueries.mockRestore();
          try {
            if (captureReleased) {
              const client = await pool.connect();
              try { expect(client).toBe(captureClient); await client.query("reset statement_timeout"); }
              finally { client.release(); }
            } else captureClient.release(true);
          } finally {
            try { await blocker.query("rollback"); }
            finally { blocker.release(); }
          }
        }
      } finally { await fixture.close(); }
    }, 240_000);
  }
});
