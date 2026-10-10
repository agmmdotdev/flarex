import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import {
  type ApplicationActivationReadinessCommitment,
  applicationActivationRequestFrame,
  applicationActiveHeadFrame,
} from "../applicationActivationFrames";
import type { fxSystemApplicationActivations } from "../applicationActivationSchema";
import type { ValidatedActivation } from "./activationPersistence";
import type { ApplicationActivationReceipt, ApplicationActiveCasToken } from "./contracts";
import { sha256 } from "./databaseBoundary";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import type { DecodedActivation, DecodedHead } from "./headCapture";
import { MAX_FRAME_BYTES, MAX_SEQUENCE, UTF8 } from "./limits";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

export type CanonicalActivationFrame = Readonly<{
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}>;

export const canonicalActivationRequest = Effect.fn(
  "ApplicationActivation.canonicalRequest",
)(function* (
  validated: ValidatedActivation,
  expected: ApplicationActiveCasToken | null,
): Effect.fn.Return<CanonicalActivationFrame, ApplicationActivationError> {
  const basis = validated.basis;
  return yield* canonicalFrame(applicationActivationRequestFrame({
    scopeId: basis.authority.scopeId,
    revisionId: basis.revisionId,
    readiness: activationReadinessCommitment(validated),
    expectedActiveHead: expected === null ? null : {
      activationSequence: expected.activationSequence.toString(),
      headSha256: expected.headSha256,
    },
  }), "activate", basis.revisionId);
});

export const activationReceipt = Effect.fn(
  "ApplicationActivation.activationReceipt",
)(function* (
  disposition: "replayed",
  row: typeof fxSystemApplicationActivations.$inferSelect,
  decoded: DecodedActivation,
  requestSha256: Uint8Array,
): Effect.fn.Return<
  ApplicationActivationReceipt,
  ApplicationActivationError
> {
  const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
  if (activatedAt === null) {
    return yield* activationFailure(
      "activate",
      "storedState",
      decoded.revisionId,
    );
  }
  const head = yield* canonicalFrame(applicationActiveHeadFrame({
    scopeId: decoded.scopeId,
    activationSequence: decoded.activationSequence.toString(),
    revisionId: decoded.revisionId,
    readiness: decodedReadinessCommitment(decoded),
    activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
  }), "activate", decoded.revisionId);
  return Object.freeze({
    status: "activated",
    disposition,
    scopeId: decoded.scopeId,
    revisionId: decoded.revisionId,
    activationSequence: decoded.activationSequence,
    previousActivationSequence: decoded.previousActivationSequence,
    readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
    activationRequestSha256: encodeBytesToLowercaseHex(requestSha256),
    expectedActiveHead: Object.freeze({
      activationSequence: decoded.activationSequence,
      headSha256: encodeBytesToLowercaseHex(head.sha256),
    }),
    activatedAt: new Date(activatedAt.getTime()),
  });
});

export function expectedMatchesHead(
  expected: ApplicationActiveCasToken | null,
  head: DecodedHead | null,
): boolean {
  return expected === null
    ? head === null
    : head !== null && expected.activationSequence === head.activationSequence &&
      expected.headSha256 === encodeBytesToLowercaseHex(head.headSha256);
}

export function activationReadinessCommitment(
  validated: ValidatedActivation,
): ApplicationActivationReadinessCommitment {
  if (validated.kind === "relation" && validated.basis.writeOwnership !== null) {
    return Object.freeze({ kind: "policy", contractVersion: 3,
      readinessSha256: encodeBytesToLowercaseHex(validated.basis.readinessSha256),
      relationSetReadinessSha256: encodeBytesToLowercaseHex(validated.basis.relationSetReadinessSha256), relationCount: validated.basis.relationCount,
      writePolicySetSha256: validated.basis.writeOwnership.frame.writePolicySetSha256,
      writeOwnershipSha256: validated.basis.writeOwnership.sha256Hex });
  }
  return validated.kind === "legacy"
    ? Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256:
          encodeBytesToLowercaseHex(validated.basis.readinessSha256),
      })
    : Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256:
          encodeBytesToLowercaseHex(validated.basis.readinessSha256),
        relationSetReadinessSha256: encodeBytesToLowercaseHex(
          validated.basis.relationSetReadinessSha256,
        ),
        relationCount: validated.basis.relationCount,
      });
}

export function decodedReadinessCommitment(
  decoded: DecodedActivation,
): ApplicationActivationReadinessCommitment {
  if (decoded.readinessKind === "relation" && decoded.readinessContractVersion === 3 &&
    decoded.writePolicySetSha256 !== null && decoded.writeOwnershipSha256 !== null) {
    return Object.freeze({ kind: "policy", contractVersion: 3,
      readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      relationSetReadinessSha256: encodeBytesToLowercaseHex(decoded.relationSetReadinessSha256), relationCount: decoded.relationCount,
      writePolicySetSha256: decoded.writePolicySetSha256, writeOwnershipSha256: decoded.writeOwnershipSha256 });
  }
  return decoded.readinessKind === "legacy"
    ? Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      })
    : Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
        relationSetReadinessSha256: encodeBytesToLowercaseHex(
          decoded.relationSetReadinessSha256,
        ),
        relationCount: decoded.relationCount,
      });
}

export function activationMatchesValidated(
  activation: DecodedActivation,
  validated: ValidatedActivation,
): boolean {
  const basis = validated.basis;
  if (activation.scopeId !== basis.authority.scopeId ||
    activation.readinessContractVersion !== (validated.kind === "legacy" ? 1 : validated.basis.manifest.version) ||
    activation.revisionId !== basis.revisionId ||
    !bytesEqualFullScan(activation.readinessSha256, basis.readinessSha256)) {
    return false;
  }
  return validated.kind === "legacy"
    ? activation.readinessKind === "legacy"
    : activation.readinessKind === "relation" &&
      activation.relationCount === validated.basis.relationCount &&
      bytesEqualFullScan(
        activation.relationSetReadinessSha256,
        validated.basis.relationSetReadinessSha256,
      );
}

export function headMatchesValidatedReadiness(
  head: DecodedHead,
  validated: ValidatedActivation,
): boolean {
  const basis = validated.basis;
  if (head.scopeId !== basis.authority.scopeId ||
    head.readinessContractVersion !== (validated.kind === "legacy" ? 1 : validated.basis.manifest.version) ||
    head.revisionId !== basis.revisionId ||
    !bytesEqualFullScan(head.readinessSha256, basis.readinessSha256)) {
    return false;
  }
  return validated.kind === "legacy"
    ? head.readinessKind === "legacy"
    : head.readinessKind === "relation" &&
      head.relationCount === validated.basis.relationCount &&
      bytesEqualFullScan(
        head.relationSetReadinessSha256,
        validated.basis.relationSetReadinessSha256,
      );
}

/** Own descriptors preserve the CAS no-getter and exact-key contract; foreign
 * reflection alone may throw. Invalid captured shapes stay typed verdicts. */
export function captureCasToken(
  input: ApplicationActiveCasToken | null,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Result.Result<ApplicationActiveCasToken | null, ApplicationActivationError> {
  if (input === null) return Result.succeed(null);
  const invalid = () => Result.fail(activationError(operation, "invalidInput", revisionId, false, new Error("invalid token")));
  if (typeof input !== "object") return invalid();
  return Result.gen(function* () {
    const keys = yield* Result.try({
      try: () => Array.isArray(input) ? undefined : Reflect.ownKeys(input),
      catch: cause => activationError(operation, "invalidInput", revisionId, false, cause),
    });
    if (keys === undefined || keys.length !== 2) return yield* invalid();
    const descriptors = yield* Result.try({
      try: () => ({
        sequence: Object.getOwnPropertyDescriptor(input, "activationSequence"),
        digest: Object.getOwnPropertyDescriptor(input, "headSha256"),
      }),
      catch: cause => activationError(operation, "invalidInput", revisionId, false, cause),
    });
    const { sequence, digest } = descriptors;
    const sequenceValue: unknown = sequence?.value;
    const digestValue: unknown = digest?.value;
    if (sequence === undefined || !("value" in sequence) ||
      sequence.enumerable !== true || typeof sequenceValue !== "bigint" ||
      sequenceValue < 1n || sequenceValue > MAX_SEQUENCE ||
      digest === undefined || !("value" in digest) ||
      digest.enumerable !== true || typeof digestValue !== "string" ||
      !/^[0-9a-f]{64}$/.test(digestValue)) return yield* invalid();
    return Object.freeze({ activationSequence: sequenceValue, headSha256: digestValue });
  });
}

export const canonicalFrame = Effect.fn(
  "ApplicationActivation.canonicalFrame",
)(function* (
  value: Readonly<Record<string, unknown>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.fn.Return<
  Readonly<{ readonly bytes: Uint8Array; readonly sha256: Uint8Array }>,
  ApplicationActivationError
> {
  if (!isJson(value)) {
    return yield* activationFailure(operation, "storedState", revisionId);
  }
  const bytes = UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Application activation frame invariant: ${issue.reason}`);
  }));
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
    return yield* activationFailure(operation, "storedState", revisionId);
  }
  return Object.freeze({ bytes, sha256: yield* sha256(bytes) });
});
