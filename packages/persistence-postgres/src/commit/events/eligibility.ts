import { and, asc, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { commitEventsDigest } from "./digest";
import { CommitEventError, EventEligibilityReference, eventError, commitEventLimits,
  type CommitEventEligibilityReference, type CommittedEvent } from "./model";
import { fxSystemCommitEventEligibilityGroups as groups, fxSystemCommitEventEligibilityMembers as members } from "./eligibilitySchema";
import { makeCommitEventTransactionRunner, type CommitEventScopePins, type CommitEventTransactionInput } from "./transaction";

declare const groupBrand: unique symbol;
declare const preparationBrand: unique symbol;
export interface CommitEventEligibilityGroup { readonly [groupBrand]: true }
export interface PreparedCommitEventEligibility { readonly [preparationBrand]: true }
type GroupFacts = Readonly<CommitEventScopePins & { readonly reference: CommitEventEligibilityReference }>;
const issuedGroups = new WeakMap<object, GroupFacts>();
const issuedPreparations = new WeakMap<object, readonly GroupFacts[]>();
const decodeReference = Schema.decodeUnknownResult(EventEligibilityReference, { onExcessProperty: "error" });
const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query, cause => eventError("statementFailure", cause));
const groupWhere = (pins: CommitEventScopePins, groupId: string) => and(eq(groups.scopeUuid, pins.scopeUuid), eq(groups.epochUuid, pins.epochUuid), eq(groups.groupId, groupId));
const commitWhere = (pins: CommitEventScopePins & { readonly commitSeq: CommitSeq }) => and(eq(members.scopeUuid, pins.scopeUuid), eq(members.epochUuid, pins.epochUuid), eq(members.commitSeq, pins.commitSeq));
const sameReference = (a: CommitEventEligibilityReference, b: CommitEventEligibilityReference) => a.groupId === b.groupId && a.ownerIdentity === b.ownerIdentity && a.policyRevision === b.policyRevision && a.maximumCommits === b.maximumCommits;
const sameScope = (a: CommitEventScopePins, b: CommitEventScopePins) => a.scopeUuid === b.scopeUuid && a.epochUuid === b.epochUuid;
const referencesOf = (facts: readonly GroupFacts[]) => Object.freeze(facts.map(fact => fact.reference));
const storedGroupFields = {
  ...EventEligibilityReference.fields,
  memberCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 16 })),
};
const StoredCommitEventEligibilityGroup = Schema.Union([
  Schema.Struct({ ...storedGroupFields, state: Schema.Literal("held"), decidedAt: Schema.Null }),
  Schema.Struct({ ...storedGroupFields, state: Schema.Literals(["released", "cleared"]), decidedAt: Schema.Date }),
]).check(Schema.makeFilter(row => row.memberCount <= row.maximumCommits));
type StoredCommitEventEligibilityGroup = typeof StoredCommitEventEligibilityGroup.Type;
// Scope and epoch remain contextual pins from the locked query, rather than
// additional unverified copies in the stored group projection.
const decodeStoredGroup = Schema.decodeUnknownEffect(StoredCommitEventEligibilityGroup, { onExcessProperty: "ignore" });
/** Private row codec; exposes no issuer or database authority. */
export const decodeStoredCommitEventEligibilityGroup = Effect.fn("CommitEvents.decodeStoredEligibilityGroup")((input: unknown) =>
  decodeStoredGroup(input).pipe(Effect.mapError(cause => eventError("storedCorruption", cause))));

/** Private trusted construction; callers receive neither transactions nor group-string authority. */
export const makeCommitEventEligibilityStore = Effect.fn("CommitEvents.makeEligibilityStore")(function* (input: CommitEventTransactionInput) {
  const transact = yield* makeCommitEventTransactionRunner(input);
  const open = Effect.fn("CommitEvents.openEligibilityGroup")(function* (definition: CommitEventEligibilityReference) {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(definition, 1024, () => eventError("invalidInput")));
    const reference = Object.freeze(yield* Effect.fromResult(decodeReference(captured.value)).pipe(Effect.mapError(cause => eventError("invalidInput", cause))));
    return yield* transact((tx, pins) => Effect.gen(function* () {
      yield* statement(tx.insert(groups).values({ ...pins, ...reference, state: "held" }).onConflictDoNothing());
      const rows = yield* statement(tx.select().from(groups).where(groupWhere(pins, reference.groupId)).for("update"));
      if (rows.length !== 1) return yield* Effect.fail(eventError("storedCorruption"));
      const row = yield* decodeStoredCommitEventEligibilityGroup(rows[0]);
      if (!sameReference(row, reference)) return yield* Effect.fail(eventError("groupConflict"));
      // SAFETY: only authenticated database rows enter this module-private registry.
      const capability = Object.freeze({}) as CommitEventEligibilityGroup;
      issuedGroups.set(capability, Object.freeze({ ...pins, reference }));
      return capability;
    }));
  });
  const decide = Effect.fn("CommitEvents.decideEligibilityGroup")((capability: CommitEventEligibilityGroup, decision: "released" | "cleared") => transact((tx, pins, now) => Effect.gen(function* () {
    const facts = issuedGroups.get(capability);
    if (facts === undefined || !sameScope(facts, pins)) return yield* Effect.fail(eventError("invalidAuthority"));
    if (decision !== "released" && decision !== "cleared") return yield* Effect.fail(eventError("invalidInput"));
    const row = yield* lockGroup(tx, facts);
    yield* verifyGroupMembershipCount(tx, pins, row);
    if (row.state === decision) return "replayed" as const;
    if (row.state !== "held") return yield* Effect.fail(eventError("groupConflict"));
    yield* statement(tx.update(groups).set({ state: decision, decidedAt: now }).where(groupWhere(pins, row.groupId)));
    return "applied" as const;
  })));
  return Object.freeze({ open, decide });
});

/** Canonical conjunction, never selected by an envelope's descriptive native `group`. */
export const prepareCommitEventEligibility = (capabilities: readonly CommitEventEligibilityGroup[]): Result.Result<PreparedCommitEventEligibility, CommitEventError> => {
  if (!Array.isArray(capabilities) || capabilities.length < 1 || capabilities.length > 2) return Result.fail(eventError("invalidInput"));
  const facts: GroupFacts[] = [];
  if (Reflect.ownKeys(capabilities).length !== capabilities.length + 1) return Result.fail(eventError("invalidInput"));
  for (let index = 0; index < capabilities.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(capabilities, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return Result.fail(eventError("invalidInput"));
    const fact = issuedGroups.get(descriptor.value);
    if (fact === undefined) return Result.fail(eventError("invalidAuthority"));
    facts.push(fact);
  }
  facts.sort((a, b) => a.reference.groupId < b.reference.groupId ? -1 : a.reference.groupId > b.reference.groupId ? 1 : 0);
  const first = facts[0];
  if (first === undefined || facts.some((fact, index) => !sameScope(fact, first) || fact.reference.groupId === facts[index - 1]?.reference.groupId)) return Result.fail(eventError("invalidInput"));
  // SAFETY: private issuance retains immutable authentic group facts.
  const prepared = Object.freeze({}) as PreparedCommitEventEligibility;
  issuedPreparations.set(prepared, Object.freeze(facts));
  return Result.succeed(prepared);
};
export const inspectCommitEventEligibility = (prepared: PreparedCommitEventEligibility): Result.Result<readonly CommitEventEligibilityReference[], CommitEventError> => {
  const facts = issuedPreparations.get(prepared);
  return facts === undefined ? Result.fail(eventError("invalidAuthority")) : Result.succeed(referencesOf(facts));
};

/** Trusted settlement seam, before the existing event digest is sealed. */
export const bindCommitEventEligibility = Effect.fn("CommitEvents.bindEligibility")(function* (events: readonly CommittedEvent[], prepared: PreparedCommitEventEligibility) {
  const eligibility = yield* Effect.fromResult(inspectCommitEventEligibility(prepared));
  if (events.length < 1 || events.length > commitEventLimits.messages) return yield* Effect.fail(eventError("invalidInput"));
  const values: CommittedEvent[] = [];
  let additionalBytes = 0;
  for (const event of events) {
    if (event.eligibility !== undefined) return yield* Effect.fail(eventError("invalidInput"));
    const value = Object.freeze({ ...event, eligibility });
    const original = yield* Effect.fromResult(capturePrivateJsonData(event, commitEventLimits.bytes, () => eventError("limitExceeded")));
    const augmented = yield* Effect.fromResult(capturePrivateJsonData(value, commitEventLimits.bytes, () => eventError("limitExceeded")));
    additionalBytes += augmented.bytes - original.bytes;
    values.push(value);
  }
  return { values: Object.freeze(values), sha256: yield* commitEventsDigest(values), additionalBytes };
});

const lockGroup = Effect.fn("CommitEvents.lockEligibilityGroup")(function* (tx: FlarexMetadataTransaction, facts: GroupFacts) {
  const rows = yield* statement(tx.select().from(groups).where(groupWhere(facts, facts.reference.groupId)).for("update"));
  if (rows.length !== 1) return yield* Effect.fail(eventError("storedCorruption"));
  const row = yield* decodeStoredCommitEventEligibilityGroup(rows[0]);
  if (!sameReference(row, facts.reference)) return yield* Effect.fail(eventError("invalidAuthority"));
  return row;
});
const verifyGroupMembershipCount = Effect.fn("CommitEvents.verifyEligibilityGroupCount")(function* (tx: FlarexMetadataTransaction, pins: CommitEventScopePins, row: StoredCommitEventEligibilityGroup) {
  const rows = yield* statement(tx.select({ commitSeq: members.commitSeq }).from(members).where(and(eq(members.scopeUuid, pins.scopeUuid), eq(members.epochUuid, pins.epochUuid), eq(members.groupId, row.groupId))).limit(17));
  if (rows.length !== row.memberCount) return yield* Effect.fail(eventError("storedCorruption"));
});

/** Zero-event child admission still authenticates current scope and open groups, without consuming membership. */
export const validatePreparedCommitEventEligibilityInTransaction = Effect.fn("CommitEvents.validatePreparedEligibility")(function* (
  tx: FlarexMetadataTransaction, pins: CommitEventScopePins, prepared: PreparedCommitEventEligibility,
) {
  const facts = issuedPreparations.get(prepared);
  if (facts === undefined || facts.some(fact => !sameScope(fact, pins))) return yield* Effect.fail(eventError("invalidAuthority"));
  for (const fact of facts) {
    const row = yield* lockGroup(tx, fact);
    yield* verifyGroupMembershipCount(tx, pins, row);
    if (row.state !== "held") return yield* Effect.fail(eventError("groupClosed"));
  }
});

/** Requires the trusted settlement transaction and scope clock lock; header must already exist. */
export const enrollCommitEventEligibilityInTransaction = Effect.fn("CommitEvents.enrollEligibility")(function* (
  tx: FlarexMetadataTransaction, pins: CommitEventScopePins & { readonly commitSeq: CommitSeq }, prepared: PreparedCommitEventEligibility,
) {
  const facts = issuedPreparations.get(prepared);
  if (facts === undefined || facts.some(fact => !sameScope(fact, pins))) return yield* Effect.fail(eventError("invalidAuthority"));
  const locked = [];
  for (const fact of facts) locked.push(yield* lockGroup(tx, fact));
  for (const row of locked) yield* verifyGroupMembershipCount(tx, pins, row);
  const existing = yield* statement(tx.select().from(members).where(commitWhere(pins)).orderBy(asc(members.groupId)).limit(3));
  if (existing.length !== 0) {
    if (existing.length !== facts.length || existing.some((row, index) => row.groupId !== facts[index]?.reference.groupId)) return yield* Effect.fail(eventError("storedCorruption"));
    return;
  }
  for (const row of locked) {
    if (row.state !== "held") return yield* Effect.fail(eventError("groupClosed"));
    if (row.memberCount >= row.maximumCommits) return yield* Effect.fail(eventError("limitExceeded"));
  }
  for (const row of locked) {
    yield* statement(tx.insert(members).values({ ...pins, groupId: row.groupId }));
    yield* statement(tx.update(groups).set({ memberCount: row.memberCount + 1 }).where(groupWhere(pins, row.groupId)));
  }
});

/** Rechecked inside every claim transaction, including previously verified families. */
export const readCommitEventEligibilityInTransaction = Effect.fn("CommitEvents.readEligibility")(function* (
  tx: FlarexMetadataTransaction, pins: CommitEventScopePins & { readonly commitSeq: CommitSeq }, events: readonly CommittedEvent[],
) {
  const expected = events[0]?.eligibility ?? [];
  if (expected.length > 2 || expected.some((ref, index) => index > 0 && ref.groupId <= (expected[index - 1]?.groupId ?? "")) ||
    events.some(event => { const refs = event.eligibility ?? []; return refs.length !== expected.length || refs.some((ref, index) => { const other = expected[index]; return other === undefined || !sameReference(ref, other); }); }))
    return yield* Effect.fail(eventError("storedCorruption"));
  const enrolled = yield* statement(tx.select().from(members).where(commitWhere(pins)).orderBy(asc(members.groupId)).limit(3));
  if (enrolled.length !== expected.length || enrolled.some((row, index) => row.groupId !== expected[index]?.groupId)) return yield* Effect.fail(eventError("storedCorruption"));
  let eligible = true;
  for (const reference of expected) {
    const rows = yield* statement(tx.select().from(groups).where(groupWhere(pins, reference.groupId)).for("share"));
    if (rows.length !== 1) return yield* Effect.fail(eventError("storedCorruption"));
    const row = yield* decodeStoredCommitEventEligibilityGroup(rows[0]);
    if (!sameReference(row, reference)) return yield* Effect.fail(eventError("storedCorruption"));
    yield* verifyGroupMembershipCount(tx, pins, row);
    if (row.state !== "released") eligible = false;
  }
  return eligible;
});
