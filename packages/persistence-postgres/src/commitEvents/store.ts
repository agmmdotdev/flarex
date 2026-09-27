import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result, MAX_PERSISTED_SIGNED_INT64_V1, type CommitSeq, type ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { FlarexMetadataDatabase } from "../deployments";
import { capturePrivateJsonData } from "../privateJsonData";
import { captureExactTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityPortError, TrustedScopeAuthorityResolutionError,
  type ExactTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { hasRelationalSessionDatabase, runRelationalSession, type RelationalSession } from "../relationalTransaction/session";
import { lockScopeClockForShareInTransactionEffect } from "../scopeClock";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { fxSystemCommits, fxSystemScopeClocks } from "../schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "./schema";
import { eventError, CommitEventError, EventEnvelope, commitEventLimits, type CommitEventSubscriber, type CommitEventMessage } from "./model";
import { commitEventsDigest } from "./digest";
import { observeDrizzleQuery } from "../drizzleQueryObservation";

export interface CommitEventQuery { readonly name: "eventDirectory" | "eventFamily" | "deliveryPage"; readonly sql: string; readonly params: readonly unknown[] }

export interface CommitEventStoreInput {
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly observeQuery?: (query: CommitEventQuery) => void;
}
type Delivery = typeof fxSystemCommitEventDeliveries.$inferSelect;
declare const claimBrand: unique symbol;
export interface CommitEventClaim { readonly [claimBrand]: true; readonly message: CommitEventMessage }
declare const familyBrand: unique symbol;
export interface VerifiedCommitEventFamily { readonly [familyBrand]: true }
const isEnvelope = Schema.is(EventEnvelope);
const decodeEnvelope = Schema.decodeUnknownEffect(EventEnvelope, { onExcessProperty: "error" });
const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query, cause => eventError("statementFailure", cause));
const sameCommit = (table: typeof fxSystemCommitEvents | typeof fxSystemCommitEventDeliveries, row: Pick<Delivery, "scopeUuid" | "epochUuid" | "commitSeq">) =>
  and(eq(table.scopeUuid, row.scopeUuid), eq(table.epochUuid, row.epochUuid), eq(table.commitSeq, row.commitSeq));
const sameDelivery = (row: Delivery) => and(sameCommit(fxSystemCommitEventDeliveries, row),
  eq(fxSystemCommitEventDeliveries.eventOrdinal, row.eventOrdinal), eq(fxSystemCommitEventDeliveries.subscriberId, row.subscriberId));

/** Dynamic scope host. Claims retain data only; every operation reacquires authority and a short session. */
export const makeCommitEventStore = Effect.fn("CommitEvents.makeStore")(function* (input: CommitEventStoreInput) {
  const { database, session, deploymentId, scopeId, observeQuery } = input;
  if (!hasRelationalSessionDatabase(session, database)) return yield* Effect.fail(eventError("invalidAuthority"));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(input.authority);
  const claims = new WeakMap<object, Delivery>();
  const verifiedFamilies = new WeakMap<object, { readonly pins: Pick<Delivery, "scopeUuid" | "epochUuid" | "commitSeq">;
    readonly events: readonly (typeof fxSystemCommitEvents.$inferSelect)["envelope"][];
    cursor?: { readonly ordinal: number; readonly subscriberId: string } }>();
  const transact = Effect.fn("CommitEvents.transaction")(function* <A>(work: (tx: FlarexMetadataTransaction,
    pins: Pick<Delivery, "scopeUuid" | "epochUuid">, now: Date, lastCommitSeq: CommitSeq) => Effect.Effect<A, CommitEventError>) {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority).pipe(
      Effect.mapError(cause => eventError(cause instanceof TrustedScopeAuthorityPortError ||
        (cause instanceof TrustedScopeAuthorityResolutionError && cause.failure.reason === "scopeClockTargetResolutionFailed")
        ? "resourceFailure" : "invalidAuthority", cause)));
    if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(eventError("invalidAuthority"));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId)).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
    return yield* runRelationalSession(session, "command", tx => Effect.gen(function* () {
      yield* statement(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`));
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, located.authority.scopeId).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
      if (clock.epoch !== located.authority.epoch || clock.storageGeneration !== located.authority.storageGeneration || clock.storageGenerationFence !== located.authority.storageGenerationFence) return yield* Effect.fail(eventError("invalidAuthority"));
      const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch)).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
      const times = yield* statement(tx.select({ now: sql<string>`clock_timestamp()::text` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scope.scopeUuid)));
      const now = new Date(times[0]?.now ?? "");
      if (finiteDateMilliseconds(now) === undefined) return yield* Effect.fail(eventError("storedCorruption"));
      return yield* work(tx, { scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid }, now, clock.lastCommitSeq);
    })).pipe(Effect.mapError(cause => cause instanceof CommitEventError ? cause : eventError("resourceFailure", cause)));
  });
  const family = Effect.fn("CommitEvents.readFamily")(function* (tx: FlarexMetadataTransaction,
    pins: Pick<Delivery, "scopeUuid" | "epochUuid" | "commitSeq">, lockDeliveries = true) {
    const headers = yield* statement(tx.select().from(fxSystemCommits).where(and(eq(fxSystemCommits.scopeUuid, pins.scopeUuid), eq(fxSystemCommits.epochUuid, pins.epochUuid), eq(fxSystemCommits.commitSeq, pins.commitSeq))));
    const header = headers[0];
    if (headers.length !== 1 || header === undefined || !Number.isSafeInteger(header.eventCount) || header.eventCount < 0 || header.eventCount > commitEventLimits.messages) return yield* Effect.fail(eventError("storedCorruption"));
    const eventQuery = tx.select().from(fxSystemCommitEvents).where(sameCommit(fxSystemCommitEvents, pins))
      .orderBy(asc(fxSystemCommitEvents.eventOrdinal)).limit(commitEventLimits.messages + 1);
    observeDrizzleQuery("eventFamily", eventQuery, observeQuery);
    const rows = yield* statement(eventQuery);
    if (rows.length !== header.eventCount) return yield* Effect.fail(eventError("storedCorruption"));
    const deliveryQuery = tx.select().from(fxSystemCommitEventDeliveries).where(sameCommit(fxSystemCommitEventDeliveries, pins)).orderBy(asc(fxSystemCommitEventDeliveries.eventOrdinal), asc(fxSystemCommitEventDeliveries.subscriberId)).limit(commitEventLimits.messages * commitEventLimits.subscribers + 1);
    const deliveries = yield* statement(lockDeliveries ? deliveryQuery.for("update") : deliveryQuery);
    const expected = new Map<string, string>();
    const events = [];
    for (const [ordinal, row] of rows.entries()) {
      if (row.eventOrdinal !== ordinal) return yield* Effect.fail(eventError("storedCorruption"));
      const captured = yield* Effect.fromResult(capturePrivateJsonData(row.envelope, commitEventLimits.bytes, () => eventError("storedCorruption")));
      yield* decodeEnvelope(captured.value).pipe(Effect.mapError(cause => eventError("storedCorruption", cause)));
      const envelope = captured.value;
      if (!isEnvelope(envelope)) return yield* Effect.fail(eventError("storedCorruption"));
      const subscribers = new Set<string>();
      for (const subscriber of envelope.subscribers) {
        if (subscribers.has(subscriber.id)) return yield* Effect.fail(eventError("storedCorruption"));
        subscribers.add(subscriber.id);
        expected.set(`${ordinal}:${subscriber.id}`, subscriber.revision);
      }
      events.push(envelope);
    }
    for (const row of deliveries) {
      const key = `${row.eventOrdinal}:${row.subscriberId}`;
      if (expected.get(key) !== row.handlerRevision || !validDelivery(row)) return yield* Effect.fail(eventError("storedCorruption"));
      expected.delete(key);
    }
    if (expected.size !== 0) return yield* Effect.fail(eventError("storedCorruption"));
    const digest = events.length === 0 ? null : yield* commitEventsDigest(events, "storedVerification")
      .pipe(Effect.mapError(cause => eventError("storedCorruption", cause)));
    if (header.eventSha256 !== digest) return yield* Effect.fail(eventError("storedCorruption"));
    return { events, deliveries };
  });
  const nextCommit = Effect.fn("CommitEvents.nextCommit")((after: bigint = 0n) => transact((tx, pins) => Effect.gen(function* () {
    if (typeof after !== "bigint" || after < 0n || after > MAX_PERSISTED_SIGNED_INT64_V1) return yield* Effect.fail(eventError("invalidInput"));
    const query = tx.select({ commitSeq: fxSystemCommits.commitSeq }).from(fxSystemCommits).where(and(
      eq(fxSystemCommits.scopeUuid, pins.scopeUuid), eq(fxSystemCommits.epochUuid, pins.epochUuid), gt(fxSystemCommits.commitSeq, sql`${after}::bigint`), sql`${fxSystemCommits.eventCount} > 0`,
    )).orderBy(asc(fxSystemCommits.commitSeq)).limit(1);
    observeDrizzleQuery("eventDirectory", query, observeQuery);
    const rows = yield* statement(query);
    return Option.fromNullishOr(rows[0]?.commitSeq);
  })));
  const verifyFamily = Effect.fn("CommitEvents.verifyFamily")((commitSeq: CommitSeq) => transact((tx, pins, _now, lastCommitSeq) => Effect.gen(function* () {
    if (typeof commitSeq !== "bigint" || commitSeq < 1n || commitSeq > lastCommitSeq)
      return yield* Effect.fail(eventError("invalidInput"));
    const familyPins = { ...pins, commitSeq };
    const { events } = yield* family(tx, familyPins, false);
    // SAFETY: only this store can register the opaque token in its private
    // WeakMap after validating the complete committed family.
    const token = Object.freeze({}) as VerifiedCommitEventFamily;
    verifiedFamilies.set(token, { pins: familyPins, events });
    return token;
  })));
  const claimVerifiedBatch = Effect.fn("CommitEvents.claimVerifiedBatch")(function* (familyToken: VerifiedCommitEventFamily,
    registered: readonly CommitEventSubscriber[], maximum: number) {
    let advanced: { readonly ordinal: number; readonly subscriberId: string } | undefined;
    const result = yield* transact((tx, pins, now, lastCommitSeq) => Effect.gen(function* () {
    const verified = verifiedFamilies.get(familyToken);
    if (verified === undefined || verified.pins.scopeUuid !== pins.scopeUuid ||
      verified.pins.epochUuid !== pins.epochUuid) return yield* Effect.fail(eventError("invalidAuthority"));
    if (verified.pins.commitSeq > lastCommitSeq || !Number.isSafeInteger(maximum) ||
      maximum < 1 || maximum > commitEventLimits.claimBatch) return yield* Effect.fail(eventError("invalidInput"));
    const identities = or(...registered.map(handler => and(eq(fxSystemCommitEventDeliveries.subscriberId, handler.id),
      eq(fxSystemCommitEventDeliveries.handlerRevision, handler.revision))));
    if (identities === undefined) {
      const empty: CommitEventClaim[] = [];
      return Object.freeze(empty);
    }
    const due = or(and(eq(fxSystemCommitEventDeliveries.state, "pending"),
      lte(fxSystemCommitEventDeliveries.nextAttemptAt, now)),
    and(eq(fxSystemCommitEventDeliveries.state, "claimed"), lte(fxSystemCommitEventDeliveries.leaseExpiresAt, now)));
    const cursor = verified.cursor;
    const afterCursor = cursor === undefined ? undefined : or(
      gt(fxSystemCommitEventDeliveries.eventOrdinal, cursor.ordinal),
      and(eq(fxSystemCommitEventDeliveries.eventOrdinal, cursor.ordinal),
        gt(fxSystemCommitEventDeliveries.subscriberId, cursor.subscriberId)));
    const pageQuery = tx.select().from(fxSystemCommitEventDeliveries)
      .where(and(sameCommit(fxSystemCommitEventDeliveries, verified.pins), identities, due, afterCursor))
      .orderBy(asc(fxSystemCommitEventDeliveries.eventOrdinal), asc(fxSystemCommitEventDeliveries.subscriberId))
      .limit(maximum).for("update", { skipLocked: true });
    observeDrizzleQuery("deliveryPage", pageQuery, observeQuery);
    const deliveries = yield* statement(pageQuery);
    const last = deliveries.at(-1);
    if (last !== undefined) advanced = { ordinal: last.eventOrdinal, subscriberId: last.subscriberId };
    const selected: CommitEventClaim[] = [];
    for (const row of deliveries) {
      const envelope = verified.events[row.eventOrdinal];
      if (!validDelivery(row) || envelope === undefined ||
        !envelope.subscribers.some(subscriber => subscriber.id === row.subscriberId &&
          subscriber.revision === row.handlerRevision)) return yield* Effect.fail(eventError("storedCorruption"));
      if (row.attempts >= commitEventLimits.attempts) {
        yield* statement(tx.update(fxSystemCommitEventDeliveries).set({ state: "failed", owner: null,
          leaseExpiresAt: null, settledAt: now, failureCode: "attempts-exhausted" }).where(sameDelivery(row)));
        continue;
      }
      if (row.fence === MAX_PERSISTED_SIGNED_INT64_V1) return yield* Effect.fail(eventError("storedCorruption"));
      const claimed = { ...row, state: "claimed" as const, attempts: row.attempts + 1, fence: row.fence + 1n,
        owner: crypto.randomUUID(), leaseExpiresAt: new Date(now.getTime() + commitEventLimits.leaseMs) };
      const changed = yield* statement(tx.update(fxSystemCommitEventDeliveries).set({ state: claimed.state,
        attempts: claimed.attempts, fence: claimed.fence, owner: claimed.owner,
        leaseExpiresAt: claimed.leaseExpiresAt }).where(sameDelivery(row))
        .returning({ fence: fxSystemCommitEventDeliveries.fence }));
      if (changed.length !== 1 || changed[0]?.fence !== claimed.fence) return yield* Effect.fail(eventError("storedCorruption"));
      const eventId = `${pins.scopeUuid}/${pins.epochUuid}/${verified.pins.commitSeq}/${row.eventOrdinal}`;
      // SAFETY: the private registry owns the fenced claim; displayed message
      // fields grant no authority to settle it.
      const token = Object.freeze({ message: Object.freeze({ eventId, deliveryId: `${eventId}/${row.subscriberId}`,
        subscriber: Object.freeze({ id: row.subscriberId, revision: row.handlerRevision }), envelope }) }) as CommitEventClaim;
      claims.set(token, claimed);
      selected.push(token);
    }
    return Object.freeze(selected);
    }));
    const verified = verifiedFamilies.get(familyToken);
    if (verified !== undefined && advanced !== undefined) verified.cursor = advanced;
    return result;
  });
  const claimBatch = Effect.fn("CommitEvents.claimBatch")((commitSeq: CommitSeq,
    registered: readonly CommitEventSubscriber[], maximum: number) => transact((tx, pins, now, lastCommitSeq) => Effect.gen(function* () {
    if (typeof commitSeq !== "bigint" || commitSeq < 1n || commitSeq > lastCommitSeq ||
      !Number.isSafeInteger(maximum) || maximum < 1 || maximum > commitEventLimits.claimBatch)
      return yield* Effect.fail(eventError("invalidInput"));
    const { events, deliveries } = yield* family(tx, { ...pins, commitSeq });
    const selected: CommitEventClaim[] = [];
    for (const row of deliveries) {
      if (!registered.some(handler => handler.id === row.subscriberId && handler.revision === row.handlerRevision)) continue;
      if (row.state === "delivered" || row.state === "failed" || row.nextAttemptAt.getTime() > now.getTime() || (row.state === "claimed" && (row.leaseExpiresAt?.getTime() ?? Infinity) > now.getTime())) continue;
      if (row.attempts >= commitEventLimits.attempts) {
        yield* statement(tx.update(fxSystemCommitEventDeliveries).set({ state: "failed", owner: null, leaseExpiresAt: null, settledAt: now, failureCode: "attempts-exhausted" }).where(sameDelivery(row)));
        continue;
      }
      if (row.fence === MAX_PERSISTED_SIGNED_INT64_V1) return yield* Effect.fail(eventError("storedCorruption"));
      const claimed = { ...row, state: "claimed" as const, attempts: row.attempts + 1, fence: row.fence + 1n,
        owner: crypto.randomUUID(), leaseExpiresAt: new Date(now.getTime() + commitEventLimits.leaseMs) };
      const changed = yield* statement(tx.update(fxSystemCommitEventDeliveries).set({ state: claimed.state, attempts: claimed.attempts, fence: claimed.fence, owner: claimed.owner, leaseExpiresAt: claimed.leaseExpiresAt }).where(sameDelivery(row)).returning({ fence: fxSystemCommitEventDeliveries.fence }));
      if (changed.length !== 1 || changed[0]?.fence !== claimed.fence) return yield* Effect.fail(eventError("storedCorruption"));
      const envelope = events[row.eventOrdinal];
      if (envelope === undefined) return yield* Effect.fail(eventError("storedCorruption"));
      const eventId = `${pins.scopeUuid}/${pins.epochUuid}/${commitSeq}/${row.eventOrdinal}`;
      // SAFETY: the private registry owns the fenced claim; displayed message fields grant no authority.
      const token = Object.freeze({ message: Object.freeze({ eventId, deliveryId: `${eventId}/${row.subscriberId}`,
        subscriber: Object.freeze({ id: row.subscriberId, revision: row.handlerRevision }), envelope }) }) as CommitEventClaim;
      claims.set(token, claimed);
      selected.push(token);
      if (selected.length === maximum) break;
    }
    return Object.freeze(selected);
  })));
  const settle = Effect.fn("CommitEvents.settle")((claimToken: CommitEventClaim, failure?: { readonly retryable: boolean; readonly code: string }) => transact((tx, pins, now) => Effect.gen(function* () {
    const row = claims.get(claimToken);
    if (row === undefined || row.scopeUuid !== pins.scopeUuid || row.epochUuid !== pins.epochUuid) return yield* Effect.fail(eventError("invalidAuthority"));
    if (failure !== undefined && (!/^[a-zA-Z0-9._-]{1,128}$/.test(failure.code) || typeof failure.retryable !== "boolean")) return yield* Effect.fail(eventError("invalidInput"));
    const retry = failure?.retryable === true && row.attempts < commitEventLimits.attempts;
    const changed = yield* statement(tx.update(fxSystemCommitEventDeliveries).set({
      state: failure === undefined ? "delivered" : retry ? "pending" : "failed", owner: null, leaseExpiresAt: null,
      nextAttemptAt: retry ? new Date(now.getTime() + Math.min(60_000, 1000 * 2 ** (row.attempts - 1))) : now,
      settledAt: retry ? null : now, failureCode: failure?.code ?? null,
    }).where(and(sameDelivery(row), eq(fxSystemCommitEventDeliveries.state, "claimed"), eq(fxSystemCommitEventDeliveries.fence, row.fence),
      eq(fxSystemCommitEventDeliveries.owner, row.owner ?? ""), gt(fxSystemCommitEventDeliveries.leaseExpiresAt, now))).returning({ fence: fxSystemCommitEventDeliveries.fence }));
    if (changed.length !== 1) return yield* Effect.fail(eventError("staleClaim"));
  })));
  return Object.freeze({ nextCommit, verifyFamily, claimVerifiedBatch, claimBatch, settle });
});

function validDelivery(row: Delivery): boolean {
  const terminal = row.state === "delivered" || row.state === "failed";
  return Number.isSafeInteger(row.attempts) && row.attempts >= 0 && row.attempts <= commitEventLimits.attempts &&
    typeof row.fence === "bigint" && row.fence >= 0n && row.fence <= MAX_PERSISTED_SIGNED_INT64_V1 &&
    ["pending", "claimed", "delivered", "failed"].includes(row.state) && finiteDateMilliseconds(row.nextAttemptAt) !== undefined &&
    (row.failureCode === null || /^[a-zA-Z0-9._-]{1,128}$/.test(row.failureCode)) &&
    (terminal ? finiteDateMilliseconds(row.settledAt) !== undefined : row.settledAt === null) &&
    (row.state === "claimed" ? row.attempts > 0 && row.owner !== null && row.owner.length > 0 && row.owner.length <= 128 && finiteDateMilliseconds(row.leaseExpiresAt) !== undefined : row.owner === null && row.leaseExpiresAt === null);
}
