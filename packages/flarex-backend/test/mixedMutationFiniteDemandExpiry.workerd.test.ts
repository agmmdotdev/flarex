import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import {
  prepareLogicalSourceEvidence,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission";
import {
  inspectLogicalParticipantAdmissionBundle,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import { captureFiniteStorageEffect } from "../../persistence-postgres/src/execution/finiteStorageCapture";
import {
  readFrozenFiniteAttempt,
} from "../../persistence-postgres/src/testing/sessionJournalInspection";
import type {
  LogicalStorageReadDemand,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/model";
import type {
  FiniteSessionJournalParticipantSelection,
} from "../../persistence-postgres/src/execution/journal/api";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "@flarex/persistence-postgres/internal/session-construction";
import { fxAppRowRevisions, fxSystemCommits, fxSystemTransactionSessions } from
  "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
type BuildDemand = Readonly<{ kind: "index" | "unique"; definitionId: number }>;

function postgres(fixture: Fixture) {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected genuine PostgreSQL resource");
  return fixture.currency.resource.target;
}

async function businessInventory(fixture: Fixture) {
  const db = postgres(fixture).drizzle;
  const scopeUuid = Result.getOrThrow(projectScopeIdUuidV1Result(fixture.selector.scopeId)).scopeUuid;
  return {
    rows: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
    commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
    events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)),
  };
}

/** A real build writer blocks the actual reader. No callback is lent a clock. */
async function afterBuildWait<A>(fixture: Fixture, demand: BuildDemand, expires: boolean, read: () => Promise<A>) {
  const persistence = postgres(fixture);
  if (expires) await persistence.query(`update fx_system_tx_session
    set finite_claimed_at=least(finite_claimed_at,statement_timestamp()-interval '1 second'),
      finite_claim_expires_at=least(hard_expires_at,statement_timestamp()+interval '2 seconds'),
      finite_lease_expires_at=least(hard_expires_at,statement_timestamp()+interval '2 seconds') where session_id=$1`,
    [fixture.selector.sessionId]);
  const holder = await persistence.pool.connect();
  let reading: Promise<A> | undefined;
  try {
    await holder.query("begin");
    const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
    if (pid === undefined) throw new Error("Missing actual demand lock holder PID");
    await holder.query("select scope_id from fx_system_scope_execution_authority where scope_id=$1 for share",
      [fixture.selector.scopeId]);
    const held = demand.kind === "index"
      ? await holder.query("select index_definition_id from fx_system_index_build_state where scope_id=$1 and index_definition_id=$2 for update",
        [fixture.selector.scopeId, demand.definitionId])
      : await holder.query("select unique_constraint_definition_id from fx_system_unique_constraint_build where scope_id=$1 and unique_constraint_definition_id=$2 for update",
        [fixture.selector.scopeId, demand.definitionId]);
    expect(held.rows).toHaveLength(1);
    reading = read();
    const deadline = Date.now() + 5_000;
    let waited = false, expired = false;
    while (Date.now() < deadline) {
      const row = (await persistence.pool.query<{ waited: boolean; expired: boolean }>(`select
        exists(select 1 from pg_stat_activity where datname=current_database()
          and $1=any(pg_blocking_pids(pid))) as waited,
        exists(select 1 from fx_system_tx_session where session_id=$2
          and finite_lease_expires_at<=clock_timestamp()) as expired`, [pid, fixture.selector.sessionId])).rows[0];
      waited ||= row?.waited === true;
      expired = row?.expired === true;
      if (waited && (!expires || expired)) break;
      await delay(25);
    }
    expect(waited).toBe(true);
    if (expires) expect(expired).toBe(true);
    await holder.query("commit");
    return await reading;
  } finally {
    await holder.query("rollback");
    holder.release();
    // Drain the reader after releasing the blocker, including assertion failure.
    if (reading !== undefined) await reading;
  }
}

async function expireAndInspect(fixture: Fixture, before: Awaited<ReturnType<typeof businessInventory>>) {
  const terminal = await Effect.runPromise(createPointMutationSessionAttemptTerminalizationPersistenceV1(
    fixture.pointCommitPorts).expireEffect(fixture.selector));
  expect(terminal).toMatchObject({ status: "terminalized", terminal: { lifecycle: "expired" } });
  const [closed] = await postgres(fixture).drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.selector.sessionId));
  expect(closed).toMatchObject({ lifecycle: "expired", attemptFence: fixture.selector.attemptFence,
    validatedArgsJson: null, validatedArgsCanonicalBytes: null, authorizationGrantJson: null,
    authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityJson: null,
    applicationExecutionAuthorityCanonicalBytes: null });
  expect(await businessInventory(fixture)).toEqual(before);
  expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
  expect(fixture.getOpenTransactionDepth()).toBe(0);
}

async function currencyDemandFixture(suffix: string) {
  let source: Effect.Success<ReturnType<typeof prepareLogicalSourceEvidence>> | undefined;
  let participant: FiniteSessionJournalParticipantSelection | undefined;
  const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix, hooks: {
    selectFiniteProductSource: currency => currency.hostInput.logicalStorage.source,
    onPreparedFiniteProductSource: ({ currency, catalog }) => Effect.gen(function* () {
      const logical = currency.hostInput.logicalStorage;
      const location = { deploymentId: currency.deploymentId, scopeId: currency.application.authority.scopeId,
        schemaVersionId: currency.schemaVersionId };
      const input = { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
        schema: currency.currencyDefinition.schema, evidence: currency.currencyDefinition.provenance };
      source = yield* prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
        { sourceKey: input.sourceKey, writeProfile: input.writeProfile,
          definition: { kind: "relational", schema: input.schema }, evidence: input.evidence },
        "medusa", "relational", { kind: "prepared", catalog });
    }).pipe(Effect.orDie),
    transformFiniteEntrySources: participants => {
      const original = participants[0];
      if (original === undefined) throw new Error("Missing genuine finite source preparation");
      participant = original;
      return participants;
    },
  } });
  if (source === undefined || participant === undefined) throw new Error("Missing admitted actual Currency source");
  return { fixture, source, participant };
}

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("finite demanded readiness after PostgreSQL waits", () => {
  for (const expires of [false, true]) {
    it(`Application index ${expires ? "refuses expiry" : "serves its original snapshot"} after its actual build wait`, async () => {
      const fixture = await createMixedMutationProductFixture({ driver: "postgres",
        suffix: `application-index-wait-${expires}`, includeUserNameIndex: true });
      try {
        const definitions = fixture.active.basis.physicalRequirements.definitions.filter(member =>
          member.access.kind === "developer" && member.access.logicalIndexId === 1);
        expect(definitions).toHaveLength(1);
        const definition = definitions[0];
        if (definition === undefined) throw new Error("Missing genuine users.by_name physical definition");
        const table = await Effect.runPromise(fixture.store.resolvePointTableEffect(fixture.persistenceAttempt, "users"));
        const index = await Effect.runPromise(fixture.store.resolveDeveloperIndexEffect(table, "by_name"));
        const before = await businessInventory(fixture);
        const verdict = await afterBuildWait(fixture, { kind: "index", definitionId: definition.indexDefinitionId }, expires,
          () => Effect.runPromise(fixture.store.runIndexedQueryEffect(index, { kind: "indexRange",
            syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 1 }).pipe(Effect.result)));
        if (expires) {
          expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "SessionJournalPersistenceV1Error",
            operation: "runIndexedQuery", cause: { _tag: "FiniteStorageCaptureError", reason: "expired" } } });
          await expireAndInspect(fixture, before);
        } else {
          expect(verdict).toMatchObject({ _tag: "Success", success: { kind: "completed",
            delivery: "executed", outcome: { kind: "indexRangePage" } } });
          expect(await businessInventory(fixture)).toEqual(before);
        }
      } finally { await fixture.close(); }
    }, 240_000);
  }

  for (const selection of ["initial", "late"] as const) {
    it(`native unique ${selection} demand refuses expiry after the exact unique build wait`, async () => {
      const { fixture, source, participant } = await currencyDemandFixture(`native-unique-${selection}-expiry`);
      try {
        const definition = source.unique[0], method = participant.operationMethods[0];
        if (definition === undefined || method === undefined) throw new Error("Missing genuine selected unique/method");
        const bundle = await Effect.runPromise(fixture.store.admitLogicalParticipantsEffect(fixture.persistenceAttempt,
          { ...participant, sources: participant.sources.map(member => ({ ...member, application: fixture.active.selection })) }));
        const demand: LogicalStorageReadDemand = { kind: "unique", tableId: definition.tableId,
          uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId };
        const before = await businessInventory(fixture);
        let callbacks = 0, storageBodies = 0;
        const issued = inspectLogicalParticipantAdmissionBundle(bundle, fixture.persistenceAttempt,
          participant.participant, method, participant.profileRevision);
        const admission = issued?.admissions[0];
        if (admission === undefined) throw new Error("Missing actual finite source admission");
        const frozen = await Effect.runPromise(fixture.freeze(null));
        const original = readFrozenFiniteAttempt(frozen);
        if (original === undefined) throw new Error("Missing original confirmed finite anchor");
        const pins = { selector: original.attemptState.selector, executionClaim: original.attemptState.executionClaim,
          preliminaryAuthority: original.resolvedTarget.authority, finiteAnchor: original.anchorCapture };
        const read = () => Effect.gen(function* () {
          if (selection === "late") {
            yield* captureFiniteStorageEffect(original.resolvedTarget.target, { ...pins,
              finiteReadDemand: { admission, attempt: fixture.persistenceAttempt, method, demand: { kind: "clock" } } },
              { kind: "transactionTime" });
            callbacks++;
          }
          yield* captureFiniteStorageEffect(original.resolvedTarget.target, { ...pins,
            finiteReadDemand: { admission, attempt: fixture.persistenceAttempt, method, demand } },
            { kind: "rows", input: { scopeId: fixture.selector.scopeId, tableId: definition.tableId, rowIds: [],
              snapshotCommitSeq: original.attemptState.snapshotToken.commitSeq } });
          storageBodies++;
        });
        const verdict = await afterBuildWait(fixture, { kind: "unique",
          definitionId: definition.uniqueConstraintDefinitionId }, true, () => Effect.runPromise(read().pipe(Effect.result)));
        expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "FiniteStorageCaptureError", reason: "expired" } });
        expect(callbacks).toBe(selection === "initial" ? 0 : 1);
        expect(storageBodies).toBe(0);
        await expireAndInspect(fixture, before);
      } finally { await fixture.close(); }
    }, 240_000);
  }
});
