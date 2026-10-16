import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { fxSystemExternalEffectAttemptsV1 as effects } from "../../database/schema";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { inspectTrustedWorkflowExecutionSubject, requireLiveTrustedWorkflowExecutionSubject,
  TrustedWorkflowExecutionSubjectError, type TrustedWorkflowExecutionSubject } from "../../tasks/trustedWorkflowExecutionSubject";
import { commerceError } from "../commerceTransaction/model";
import { canonicalizeJsonOutcome } from "../../values/jsonOutcome";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import type { AtomicCommerceRequestEvidence } from "./request";
import { hashAtomicCommerceBytes } from "./request";
import { inspectCommitEventEligibility, type PreparedCommitEventEligibility } from "../../commit/events/eligibility";

/** The complete command budget is required at entry. A further second remains
 * for the final database lease observation and the existing settlement owner. */
export const trustedWorkflowChildSettlementReserveMs = 1000;
/** This private profile admits a finite set of logical child occurrences, not
 * an unbounded mutation loop or an automatic sequence-number allocator. */
export const trustedWorkflowMaximumCommerceOccurrences = 16;
const utf8 = new TextEncoder();
const ordinalDecoder = Schema.decodeUnknownEffect(Schema.BigInt.check(Schema.makeFilter(
  value => value >= 1n && value <= BigInt(trustedWorkflowMaximumCommerceOccurrences))));
const digest = Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32));
const storedChild = Schema.Struct({
  effectKind: Schema.Literal("child_commerce"), subjectKind: Schema.Literal("durable_task_attempt"),
  subjectIdentitySha256: digest, subjectFence: Schema.BigInt, effectOrdinal: Schema.BigInt,
  stableEffectKey: Schema.String, requestIdentitySha256: digest,
  childCommerceRequestKey: Schema.String, childCommerceCommandName: Schema.String,
  childCommerceArgumentsSha256: digest, childCommercePolicySha256: digest,
  childCommerceOutcomeSha256: digest, state: Schema.Literal("confirmed"),
});
const decodeStoredChild = Schema.decodeUnknownEffect(storedChild);
type StoredChild = typeof storedChild.Type;
const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query,
  cause => commerceError("statementFailure", cause));
const projectSubjectFailure = (cause: TrustedWorkflowExecutionSubjectError) => commerceError(
  cause.reason === "storeFailure" ? "resourceFailure" : cause.reason === "storedCorruption" ? "storedCorruption" : "invalidAuthority", cause);

export interface CapturedAtomicCommerceTaskChild {
  readonly subject: TrustedWorkflowExecutionSubject;
  readonly ordinal: bigint;
  readonly key: string;
  readonly subjectIdentitySha256: Uint8Array;
  readonly executionFence: bigint;
  readonly identity: { readonly runId: string; readonly bindingSha256: string };
  readonly eligibility: PreparedCommitEventEligibility | undefined;
}

/** Run/occurrence identity survives attempts. The authentic subject is still
 * checked inside every accepting transaction; these facts convey no live lease. */
export const captureAtomicCommerceTaskChild = Effect.fn("AtomicCommerce.captureTaskChild")(
  function* (subject: TrustedWorkflowExecutionSubject, rawOrdinal: bigint, eligibility?: PreparedCommitEventEligibility) {
    const pins = yield* Effect.fromResult(inspectTrustedWorkflowExecutionSubject(subject)).pipe(Effect.mapError(projectSubjectFailure));
    const ordinal = yield* ordinalDecoder(rawOrdinal).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (eligibility !== undefined) yield* Effect.fromResult(inspectCommitEventEligibility(eligibility))
      .pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
    const bindingSha256 = encodeBytesToLowercaseHex(pins.bindingSha256);
    const logical = { codec: "flarex.trusted-workflow.child-commerce.v1", scopeId: pins.scopeId,
      runId: pins.runId, ordinal: ordinal.toString() };
    const canonical = (value: Parameters<typeof encodeCanonicalJson>[0]) => utf8.encode(encodeCanonicalJson(value,
      issue => { throw new Error(`Invalid established child identity: ${issue.reason}`); }));
    const keyDigest = yield* hashAtomicCommerceBytes(canonical(logical));
    const subjectIdentitySha256 = yield* hashAtomicCommerceBytes(canonical({
      codec: "flarex.trusted-workflow.execution-subject.v1", scopeId: pins.scopeId,
      runId: pins.runId, attemptId: pins.attemptId, bindingSha256,
    }));
    return Object.freeze({ subject, ordinal, key: `commerce/atomic/task/${encodeBytesToLowercaseHex(keyDigest)}`,
      subjectIdentitySha256, executionFence: pins.executionFence,
      identity: Object.freeze({ runId: pins.runId, bindingSha256 }), eligibility });
  },
);

const childWhere = (scopeId: TrustedScopeAuthority["scopeId"], key: string) => and(
  eq(effects.scopeId, scopeId), eq(effects.effectKind, "child_commerce"), eq(effects.stableEffectKey, key));

/** Scope locks precede run/attempt, then the effect row and request lock. A new
 * attempt can recover the same occurrence but cannot bypass request equality. */
export const lockAtomicCommerceTaskChild = Effect.fn("AtomicCommerce.lockTaskChild")(
  function* (tx: FlarexMetadataTransaction, child: CapturedAtomicCommerceTaskChild,
    authority: TrustedScopeAuthority, commandMilliseconds: number) {
    const live = yield* requireLiveTrustedWorkflowExecutionSubject(tx, child.subject, authority).pipe(Effect.mapError(projectSubjectFailure));
    if (live.remainingLeaseMs < commandMilliseconds + trustedWorkflowChildSettlementReserveMs)
      return yield* commerceError("deadlineExceeded");
    const rows = yield* statement(tx.select().from(effects).where(childWhere(authority.scopeId, child.key)).for("update").limit(2));
    if (rows.length > 1) return yield* commerceError("storedCorruption");
    const row = rows[0];
    const stored = row === undefined ? undefined : yield* decodeStoredChild(row)
      .pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
    return { stored, scopeId: authority.scopeId };
  },
);

/** Preparation, dispatch declaration, business publication and confirmation all
 * share the child's existing SQL transaction. Crash-before-commit leaves none;
 * crash-after-commit is resolved through the existing retained outcome. */
export const prepareAtomicCommerceTaskChild = Effect.fn("AtomicCommerce.prepareTaskChild")(
  function* (tx: FlarexMetadataTransaction, child: CapturedAtomicCommerceTaskChild,
    locked: { readonly stored: StoredChild | undefined; readonly scopeId: TrustedScopeAuthority["scopeId"] },
    evidence: AtomicCommerceRequestEvidence, commandName: string, args: unknown) {
    const argumentBytes = yield* Effect.fromResult(canonicalizeJsonOutcome(args)).pipe(Effect.mapError(projectCommerceRequestFailure));
    const argsSha256 = yield* hashAtomicCommerceBytes(argumentBytes.canonicalBytes);
    const { lookup } = evidence;
    const stored = locked.stored;
    if (stored !== undefined) {
      if (stored.stableEffectKey !== child.key || stored.childCommerceRequestKey !== child.key ||
        stored.effectOrdinal !== child.ordinal || stored.childCommerceCommandName !== commandName ||
        !bytesEqualFullScan(stored.requestIdentitySha256, lookup.expectedRequestSha256) ||
        !bytesEqualFullScan(stored.childCommerceArgumentsSha256, argsSha256) ||
        !bytesEqualFullScan(stored.childCommercePolicySha256, lookup.expectedIdentityAccessPolicySha256))
        return yield* commerceError("requestConflict");
      return stored;
    }
    const inserted = yield* statement(tx.insert(effects).values({ scopeId: locked.scopeId,
      subjectKind: "durable_task_attempt", subjectIdentitySha256: child.subjectIdentitySha256,
      subjectFence: child.executionFence, effectOrdinal: child.ordinal, effectKind: "child_commerce",
      stableEffectKey: child.key, requestIdentitySha256: lookup.expectedRequestSha256,
      childCommerceRequestKey: child.key, childCommerceCommandName: commandName,
      childCommerceArgumentsSha256: argsSha256, childCommercePolicySha256: lookup.expectedIdentityAccessPolicySha256,
      state: "prepared",
    }).returning({ key: effects.stableEffectKey }));
    if (inserted.length !== 1 || inserted[0]?.key !== child.key) return yield* commerceError("storedCorruption");
    // The database owns timestamps; `prepared_at` is statement-transaction time.
    const dispatch = yield* statement(tx.update(effects).set({ state: "dispatching", dispatchDeclaredAt: sql`greatest(${effects.preparedAt}, clock_timestamp())` })
      .where(and(childWhere(locked.scopeId, child.key), eq(effects.state, "prepared"))).returning({ key: effects.stableEffectKey }));
    if (dispatch.length !== 1) return yield* commerceError("storedCorruption");
    return undefined;
  },
);

export const confirmAtomicCommerceTaskChild = Effect.fn("AtomicCommerce.confirmTaskChild")(
  function* (tx: FlarexMetadataTransaction, child: CapturedAtomicCommerceTaskChild,
    authority: TrustedScopeAuthority, outcomeSha256: Uint8Array) {
    const rows = yield* statement(tx.update(effects).set({ state: "confirmed", settledAt: sql`greatest(${effects.preparedAt}, clock_timestamp())`,
      childCommerceOutcomeSha256: outcomeSha256 }).where(and(childWhere(authority.scopeId, child.key),
      eq(effects.state, "dispatching"))).returning({ key: effects.stableEffectKey }));
    if (rows.length !== 1 || rows[0]?.key !== child.key) return yield* commerceError("storedCorruption");
    yield* requireAtomicCommerceTaskChildSettlement(tx, child, authority);
  },
);

export const requireAtomicCommerceTaskChildSettlement = Effect.fn("AtomicCommerce.requireTaskChildSettlement")(
  function* (tx: FlarexMetadataTransaction, child: CapturedAtomicCommerceTaskChild, authority: TrustedScopeAuthority) {
    const live = yield* requireLiveTrustedWorkflowExecutionSubject(tx, child.subject, authority).pipe(Effect.mapError(projectSubjectFailure));
    if (live.remainingLeaseMs < trustedWorkflowChildSettlementReserveMs) return yield* commerceError("deadlineExceeded");
  },
);

/** A retained outcome and its logical effect receipt must agree. Missing or
 * expired evidence can never authorize a fresh key or another business call. */
export function requireAtomicCommerceTaskChildOutcome(stored: StoredChild | undefined, outcomeSha256: Uint8Array) {
  return stored === undefined || !bytesEqualFullScan(stored.childCommerceOutcomeSha256, outcomeSha256)
    ? Effect.fail(commerceError("storedCorruption")) : Effect.void;
}
