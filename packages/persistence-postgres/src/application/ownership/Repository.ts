import type { ApplicationWriteOwnershipCatalog } from "./Catalog";
import { Effect, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { isJson, isJsonObject, encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import type { ScopeId } from "flarex-protocol/storage-authority";
import {
  decodeCapturedApplicationActivationRowEffect,
  decodeCapturedApplicationActiveHeadRowEffect,
  activationMatchesHead,
} from "../applicationActiveHeadRead";
import {
  type CoherentApplicationActiveHead,
} from "../activeHead/contracts";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { canonicalizeApplicationWriteOwnership, decodeStoredApplicationWriteOwnership } from "./Codec";
import { digestApplicationWriteOwnership } from "./Digest";
import { ApplicationWriteOwnershipError, type CanonicalApplicationWriteOwnership } from "./Model";
import { ApplicationWriteOwnershipHistoryBudget } from "./Policy";
import {
  prepareApplicationOwnershipSuccessor,
  admitsApplicationOwnershipSuccessor,
  type ApplicationOwnershipSuccessorCapturePort,
} from "./Successor";
import {
  captureApplicationWriteOwnershipInTransaction,
  decodeCapturedOwnershipEnvelopeResult,
  decodeCapturedOwnershipBodyResult,
} from "./Capture";

export interface ApplicationWriteOwnershipSnapshot {
  readonly active: CoherentApplicationActiveHead | null;
  readonly ownership: CanonicalApplicationWriteOwnership | null;
  readonly history: ReadonlyArray<CanonicalApplicationWriteOwnership>;
}

/** Ordinary callers own the scope-clock lock or repeatable-read snapshot. */
export const readApplicationWriteOwnershipInTransaction = Effect.fn("ApplicationWriteOwnership.readInTransaction")(
  function* (tx: AppRowTransaction, scopeId: ScopeId, budget: ApplicationWriteOwnershipHistoryBudget, catalog?: ApplicationWriteOwnershipCatalog):
    Effect.fn.Return<ApplicationWriteOwnershipSnapshot, ApplicationWriteOwnershipError> {
    const raw = yield* captureApplicationWriteOwnershipInTransaction(tx, scopeId, budget.remaining());
    return yield* decodeCapturedApplicationWriteOwnershipEffect(scopeId, raw, budget, catalog, { kind: "transaction", tx });
  });

const capturedSequenceResult = Schema.decodeUnknownResult(Schema.BigIntFromString);
const envelope = (row: unknown) => Effect.fromResult(decodeCapturedOwnershipEnvelopeResult(row)).pipe(
  Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
const body = (row: unknown) => Effect.fromResult(decodeCapturedOwnershipBodyResult(row)).pipe(
  Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));

/** Decode the installed fixed projection in the original group's budget and
 * canonical order. Target bytes are inert; no transaction observation escapes. */
export const decodeCapturedApplicationWriteOwnershipEffect = Effect.fn("ApplicationWriteOwnership.decodeCapturedSnapshot")(
  function* (scopeId: ScopeId, raw: readonly unknown[], budget: ApplicationWriteOwnershipHistoryBudget,
    catalog?: ApplicationWriteOwnershipCatalog, successorSource?: ApplicationOwnershipSuccessorCapturePort):
    Effect.fn.Return<ApplicationWriteOwnershipSnapshot, ApplicationWriteOwnershipError> {
    const select = (kind: string) => raw.filter(row => isNonArrayRecord(row) && row.kind === kind);
    const headRows = select("head"), currentActivationRows = select("headActivation");
    if (headRows.length > 1 || currentActivationRows.length > 1) return yield* refuse();
    const headRaw = headRows[0], currentActivationRaw = currentActivationRows[0];
    const headEnvelope = headRaw === undefined ? undefined : yield* envelope(headRaw);
    const currentActivationEnvelope = currentActivationRaw === undefined ? undefined : yield* envelope(currentActivationRaw);
    if (headEnvelope !== undefined && currentActivationEnvelope !== undefined)
      yield* Effect.fromResult(budget.consume(2, headEnvelope.evidenceLength + currentActivationEnvelope.evidenceLength));
    if ((headEnvelope !== undefined && (headEnvelope.ordinal !== 0 || headEnvelope.scopeId !== scopeId)) ||
      (currentActivationEnvelope !== undefined && (currentActivationEnvelope.ordinal !== 0 || currentActivationEnvelope.scopeId !== scopeId)) ||
      (headEnvelope === undefined && currentActivationEnvelope !== undefined)) return yield* refuse();
    const head = headRaw === undefined ? null : yield* decodeCapturedApplicationActiveHeadRowEffect(headRaw).pipe(
      Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
    let active: CoherentApplicationActiveHead | null = null;
    if (head !== null) {
      if (head.scopeId !== scopeId || currentActivationRaw === undefined) return yield* refuse();
      const activation = yield* decodeCapturedApplicationActivationRowEffect(currentActivationRaw).pipe(
        Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
      if (!activationMatchesHead(activation, head) || head.evidenceByteLength !== headEnvelope?.evidenceLength ||
        activation.evidenceByteLength !== currentActivationEnvelope?.evidenceLength) return yield* refuse();
      active = Object.freeze({ head, activation });
    }
    const ownershipRows = select("ownership");
    const sizes = [];
    for (const [ordinal, row] of ownershipRows.entries()) {
      const value = yield* envelope(row);
      if (value.ordinal !== ordinal || value.scopeId !== scopeId || value.sequenceText === null) return yield* refuse();
      const sequence = yield* Effect.fromResult(capturedSequenceResult(value.sequenceText)).pipe(
        Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
      sizes.push({ activationSequence: sequence, length: value.evidenceLength });
    }
    yield* Effect.fromResult(budget.consume(sizes.length, sizes.reduce((sum, row) => sum + row.length, 0)));
    if (sizes.length === 0) {
      if (raw.length !== headRows.length + currentActivationRows.length + select("activation").length + select("readiness").length) return yield* refuse();
      if (select("activation").length !== 0 || select("readiness").length !== 0) return yield* refuse();
      if (active?.head.readinessContractVersion === 3) return yield* refuse();
      return Object.freeze({ active, ownership: null, history: Object.freeze([]) });
    }
    if (active === null || active.head.readinessContractVersion !== 3) return yield* refuse();
    const rows = [];
    for (const [index, rawRow] of ownershipRows.entries()) {
      const value = yield* body(rawRow), size = sizes[index]!;
      if (value.evidenceBytes.byteLength !== size.length) return yield* refuse();
      rows.push({ activationSequence: size.activationSequence, claimsBytes: value.evidenceBytes, claimsSha256: value.evidenceSha256 });
    }
    const sequences = rows.filter(row => row.activationSequence !== active.head.activationSequence).map(row => row.activationSequence);
    const activationRows = select("activation");
    const activationSizes = [];
    for (const [ordinal, rawRow] of activationRows.entries()) {
      const value = yield* envelope(rawRow);
      if (value.ordinal !== ordinal || value.scopeId !== scopeId || value.sequenceText === null) return yield* refuse();
      const sequence = yield* Effect.fromResult(capturedSequenceResult(value.sequenceText)).pipe(
        Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
      activationSizes.push({ sequence, length: value.evidenceLength });
    }
    yield* Effect.fromResult(budget.consume(activationSizes.length, activationSizes.reduce((sum, row) => sum + row.length, 0)));
    if (activationSizes.length !== sequences.length || activationSizes.some((size,index) => size.sequence !== sequences[index])) return yield* refuse();
    const activations = new Map([[active.activation.activationSequence, active.activation]]);
    for (const [index, row] of activationRows.entries()) {
      const activation = yield* decodeCapturedApplicationActivationRowEffect(row).pipe(Effect.mapError(cause =>
        new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
      if (activation.evidenceByteLength !== activationSizes[index]?.length) return yield* refuse();
      activations.set(activation.activationSequence, activation);
    }
    const revisionIds = [...new Set([...activations.values()].map(activation => activation.revisionId))];
    const capturedReadinessRows = select("readiness");
    const readinessSizes = [];
    for (const [ordinal, row] of capturedReadinessRows.entries()) {
      const value = yield* envelope(row);
      if (value.ordinal !== ordinal || value.scopeId !== scopeId || value.revisionId === null) return yield* refuse();
      readinessSizes.push({ revisionId: value.revisionId, length: value.evidenceLength });
    }
    yield* Effect.fromResult(budget.consume(readinessSizes.length, readinessSizes.reduce((sum, row) => sum + row.length, 0)));
    if (readinessSizes.length !== revisionIds.length) return yield* refuse();
    const readinessRows = [];
    for (const [index, row] of capturedReadinessRows.entries()) {
      const value = yield* body(row);
      readinessRows.push({ revisionId: readinessSizes[index]!.revisionId, bytes: value.evidenceBytes, sha256: value.evidenceSha256 });
    }
    const readinessByRevision = new Map(readinessRows.map(row => [row.revisionId, row]));
    let previous: CanonicalApplicationWriteOwnership | null = null;
    let previousReadiness: JsonObject | undefined;
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
      const successor = previous === null ? undefined : yield* prepareApplicationOwnershipSuccessor(successorSource, scopeId,
        previous.frame.revisionId, frame.revisionId, previous.frame.claims, frame.claims.map(claim => claim.policy), frame.writePolicySetSha256, budget, catalog, previousReadiness === undefined ? undefined : { prior: previousReadiness, next: readyFrame });
      for (const old of oldClaims.values()) {
        const next = nextClaims.get(old.policy.tableId);
        if (next === undefined || (next.policy.writePolicySha256 !== old.policy.writePolicySha256 && !admitsApplicationOwnershipSuccessor(successor, old.policy, next.policy)) ||
          next.policy.logicalName !== old.policy.logicalName ||
          next.establishingActivationSequence !== old.establishingActivationSequence ||
          next.establishingRevisionId !== old.establishingRevisionId) return yield* refuse();
      }
      for (const claim of frame.claims) {
        if (!oldClaims.has(claim.policy.tableId) && (claim.establishingActivationSequence !== frame.activationSequence ||
          claim.establishingRevisionId !== frame.revisionId)) return yield* refuse();
      }
      previousReadiness = readyFrame;
      previous = owned;
      history.push(owned);
    }
    if (previous === null || previous.sha256Hex !== active.head.writeOwnershipSha256 ||
      previous.frame.activationSequence !== active.head.activationSequence.toString() ||
      raw.length !== headRows.length + currentActivationRows.length + ownershipRows.length + activationRows.length + capturedReadinessRows.length) return yield* refuse();
    return Object.freeze({ active, ownership: previous, history: Object.freeze(history) });
  },
);

function refuse() {
  return Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
}
