import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { isJson, isJsonObject, encodeCanonicalJson } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { decodeApplicationActivationRowEffect, readCoherentApplicationActiveHeadInTransactionEffect,
  type CoherentApplicationActiveHead } from "../applicationActiveHeadRead";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../applicationActivationSchema";
import type { AppRowTransaction } from "../appRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { canonicalizeApplicationWriteOwnership, decodeStoredApplicationWriteOwnership } from "./Codec";
import { digestApplicationWriteOwnership } from "./Digest";
import { fxSystemApplicationReadiness } from "../applicationRelationSchema";
import { ApplicationWriteOwnershipError, type CanonicalApplicationWriteOwnership } from "./Model";
import { ApplicationWriteOwnershipHistoryBudget } from "./Policy";
import { fxSystemApplicationWriteOwnership } from "./Schema";

export interface ApplicationWriteOwnershipSnapshot {
  readonly active: CoherentApplicationActiveHead | null;
  readonly ownership: CanonicalApplicationWriteOwnership | null;
  readonly history: ReadonlyArray<CanonicalApplicationWriteOwnership>;
}

/** Callers own the scope-clock lock or repeatable-read snapshot. No caller supplies claims. */
export const readApplicationWriteOwnershipInTransaction = Effect.fn("ApplicationWriteOwnership.readInTransaction")(
  function* (tx: AppRowTransaction, scopeId: ScopeId, budget: ApplicationWriteOwnershipHistoryBudget):
    Effect.fn.Return<ApplicationWriteOwnershipSnapshot, ApplicationWriteOwnershipError> {
    const headSizes = yield* query(tx.select({ head: sql<number>`octet_length(${fxSystemApplicationActiveHeads.headBytes})`,
      activation: sql<number>`octet_length(${fxSystemApplicationActivations.activationBytes})` })
      .from(fxSystemApplicationActiveHeads).innerJoin(fxSystemApplicationActivations, and(
        eq(fxSystemApplicationActivations.scopeId, fxSystemApplicationActiveHeads.scopeId),
        eq(fxSystemApplicationActivations.activationSequence, fxSystemApplicationActiveHeads.activationSequence)))
      .where(eq(fxSystemApplicationActiveHeads.scopeId, scopeId)).limit(1));
    const headSize = headSizes[0];
    if (headSize !== undefined) yield* Effect.fromResult(budget.consume(2, headSize.head + headSize.activation));
    const active = yield* readCoherentApplicationActiveHeadInTransactionEffect(tx, scopeId).pipe(
      Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
    if (active !== null && (headSize === undefined || active.head.evidenceByteLength !== headSize.head ||
      active.activation.evidenceByteLength !== headSize.activation)) return yield* refuse();
    const sizes = yield* query(tx.select({ activationSequence: fxSystemApplicationWriteOwnership.activationSequence,
      length: sql<number>`octet_length(${fxSystemApplicationWriteOwnership.claimsBytes})` }).from(fxSystemApplicationWriteOwnership)
      .where(eq(fxSystemApplicationWriteOwnership.scopeId, scopeId))
      .orderBy(asc(fxSystemApplicationWriteOwnership.activationSequence)).limit(65));
    yield* Effect.fromResult(budget.consume(sizes.length, sizes.reduce((sum, row) => sum + row.length, 0)));
    if (sizes.length === 0) {
      if (active?.head.readinessContractVersion === 3) return yield* refuse();
      return Object.freeze({ active, ownership: null, history: Object.freeze([]) });
    }
    if (active === null || active.head.readinessContractVersion !== 3) return yield* refuse();
    const rows = yield* query(tx.select().from(fxSystemApplicationWriteOwnership)
      .where(eq(fxSystemApplicationWriteOwnership.scopeId, scopeId))
      .orderBy(asc(fxSystemApplicationWriteOwnership.activationSequence)).limit(65));
    if (rows.length !== sizes.length || rows.some((row, index) => row.activationSequence !== sizes[index]?.activationSequence ||
      row.claimsBytes.byteLength !== sizes[index]?.length)) return yield* refuse();
    const sequences = rows.filter(row => row.activationSequence !== active.head.activationSequence).map(row => row.activationSequence);
    const activationSizes = sequences.length === 0 ? [] : yield* query(tx.select({ sequence: fxSystemApplicationActivations.activationSequence,
      length: sql<number>`octet_length(${fxSystemApplicationActivations.activationBytes})` }).from(fxSystemApplicationActivations)
      .where(and(eq(fxSystemApplicationActivations.scopeId, scopeId), inArray(fxSystemApplicationActivations.activationSequence, sequences)))
      .orderBy(asc(fxSystemApplicationActivations.activationSequence)).limit(65));
    yield* Effect.fromResult(budget.consume(activationSizes.length, activationSizes.reduce((sum, row) => sum + row.length, 0)));
    if (activationSizes.length !== sequences.length) return yield* refuse();
    const activationRows = sequences.length === 0 ? [] : yield* query(tx.select().from(fxSystemApplicationActivations)
      .where(and(eq(fxSystemApplicationActivations.scopeId, scopeId), inArray(fxSystemApplicationActivations.activationSequence, sequences)))
      .orderBy(asc(fxSystemApplicationActivations.activationSequence)).limit(65));
    if (activationRows.length !== sequences.length || activationRows.some((row, index) =>
      row.activationSequence !== activationSizes[index]?.sequence || row.activationBytes.byteLength !== activationSizes[index]?.length)) return yield* refuse();
    const activations = new Map([[active.activation.activationSequence, active.activation]]);
    for (const row of activationRows) {
      const activation = yield* decodeApplicationActivationRowEffect(row).pipe(Effect.mapError(cause =>
        new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
      activations.set(activation.activationSequence, activation);
    }
    const revisionIds = [...new Set([...activations.values()].map(activation => activation.revisionId))];
    const readinessPredicate = and(eq(fxSystemApplicationReadiness.scopeId, scopeId), inArray(fxSystemApplicationReadiness.revisionId, revisionIds));
    const readinessSizes = yield* query(tx.select({ revisionId: fxSystemApplicationReadiness.revisionId,
      length: sql<number>`octet_length(${fxSystemApplicationReadiness.readinessBytes})` }).from(fxSystemApplicationReadiness).where(readinessPredicate).limit(65));
    yield* Effect.fromResult(budget.consume(readinessSizes.length, readinessSizes.reduce((sum, row) => sum + row.length, 0)));
    if (readinessSizes.length !== revisionIds.length) return yield* refuse();
    const readinessRows = yield* query(tx.select({ revisionId: fxSystemApplicationReadiness.revisionId,
      bytes: fxSystemApplicationReadiness.readinessBytes, sha256: fxSystemApplicationReadiness.readinessSha256 })
      .from(fxSystemApplicationReadiness).where(readinessPredicate).limit(65));
    if (readinessRows.length !== readinessSizes.length) return yield* refuse();
    const readinessByRevision = new Map(readinessRows.map(row => [row.revisionId, row]));
    let previous: CanonicalApplicationWriteOwnership | null = null;
    const history: CanonicalApplicationWriteOwnership[] = [];
    for (const row of rows) {
      const owned = yield* decodeStoredApplicationWriteOwnership(row.claimsBytes, row.claimsSha256);
      const frame = owned.frame;
      const activation = activations.get(row.activationSequence);
      if (frame.scopeId !== scopeId || frame.activationSequence !== row.activationSequence.toString() ||
        activation === undefined || activation.readinessContractVersion !== 3 || activation.revisionId !== frame.revisionId ||
        activation.writeOwnershipSha256 !== owned.sha256Hex || activation.writePolicySetSha256 !== frame.writePolicySetSha256 ||
        (previous === null ? frame.predecessor !== null : frame.predecessor?.claimsSha256 !== previous.sha256Hex ||
          frame.predecessor.activationSequence !== previous.frame.activationSequence ||
          activation.previousActivationSequence?.toString() !== previous.frame.activationSequence)) return yield* refuse();
      const readiness = readinessByRevision.get(frame.revisionId);
      if (readiness === undefined || readiness.bytes.byteLength !== readinessSizes.find(size => size.revisionId === frame.revisionId)?.length ||
        !bytesEqualFullScan(readiness.sha256, activation.readinessSha256) ||
        !bytesEqualFullScan(yield* digestApplicationWriteOwnership(readiness.bytes), readiness.sha256)) return yield* refuse();
      const readyFrame = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readiness.bytes)),
        catch: cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }) });
      if (!isJson(readyFrame) || !isJsonObject(readyFrame) || readyFrame.version !== 3 ||
        readyFrame.scopeId !== scopeId || readyFrame.revisionId !== frame.revisionId ||
        readyFrame.writePolicySetSha256 !== frame.writePolicySetSha256 || readyFrame.writeOwnershipSha256 !== owned.sha256Hex ||
        !bytesEqualFullScan(new TextEncoder().encode(encodeCanonicalJson(readyFrame, () => { throw new Error("Invalid readiness JSON"); })), readiness.bytes)) return yield* refuse();
      const readinessOwnership = yield* canonicalizeApplicationWriteOwnership(readyFrame.writeOwnership);
      if (readinessOwnership.sha256Hex !== owned.sha256Hex) return yield* refuse();
      const oldClaims = new Map(previous?.frame.claims.map(claim => [claim.policy.tableId, claim]) ?? []);
      const nextClaims = new Map(frame.claims.map(claim => [claim.policy.tableId, claim]));
      for (const old of oldClaims.values()) {
        const next = nextClaims.get(old.policy.tableId);
        if (next === undefined || next.policy.writePolicySha256 !== old.policy.writePolicySha256 ||
          next.policy.logicalName !== old.policy.logicalName ||
          next.establishingActivationSequence !== old.establishingActivationSequence ||
          next.establishingRevisionId !== old.establishingRevisionId) return yield* refuse();
      }
      for (const claim of frame.claims) {
        if (!oldClaims.has(claim.policy.tableId) && (claim.establishingActivationSequence !== frame.activationSequence ||
          claim.establishingRevisionId !== frame.revisionId)) return yield* refuse();
      }
      previous = owned;
      history.push(owned);
    }
    if (previous === null || previous.sha256Hex !== active.head.writeOwnershipSha256 ||
      previous.frame.activationSequence !== active.head.activationSequence.toString()) return yield* refuse();
    return Object.freeze({ active, ownership: previous, history: Object.freeze(history) });
  },
);

function refuse() {
  return Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
}

function query<A>(statement: PromiseLike<A>) {
  return runDrizzleStatementEffect(statement, cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }));
}
