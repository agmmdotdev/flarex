import { Effect, Result, Schema } from "effect";
import { captureApplicationWritePolicyData } from "@flarex/analysis/internal/application-write-policy";
import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { digestApplicationWriteOwnership } from "./Digest";
import { encodeCanonicalJson, isJson, measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import {
  ApplicationWriteOwnershipError, ApplicationWriteOwnershipFrameSchema,
  MAX_WRITE_OWNERSHIP_HISTORY_BYTES, type CanonicalApplicationWriteOwnership,
} from "./Model";

const decodeFrame = Schema.decodeUnknownResult(ApplicationWriteOwnershipFrameSchema, { onExcessProperty: "error" });

export const canonicalizeApplicationWriteOwnership = Effect.fn("ApplicationWriteOwnership.canonicalize")(
  function* (value: unknown): Effect.fn.Return<CanonicalApplicationWriteOwnership, ApplicationWriteOwnershipError> {
    const captured = yield* Effect.fromResult(captureApplicationWritePolicyData(value).pipe(Result.mapError(cause =>
      new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }))));
    const decoded = yield* Effect.fromResult(decodeFrame(captured).pipe(Result.mapError(cause =>
      new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }))));
    if (!isJson(decoded) || measureCanonicalJsonUtf8Bytes(decoded, MAX_WRITE_OWNERSHIP_HISTORY_BYTES).kind !== "success") {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "historyLimit" }));
    }
    for (const claim of decoded.claims) {
      const policy = claim.policy;
      if (policy.owner !== "payload") return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
      const declaration = { format: "flarex.application-table-write-policy", version: 1, logicalTableName: policy.logicalName,
        owner: policy.owner, policyId: policy.policyId, configSha256: policy.configSha256, provenanceSha256: policy.provenanceSha256 };
      const policyBytes = new TextEncoder().encode(encodeCanonicalJson(declaration, () => { throw new Error("Invalid owned policy"); }));
      if (encodeBytesToLowercaseHex(yield* digestApplicationWriteOwnership(policyBytes)) !== policy.writePolicySha256) {
        return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
      }
    }
    const frame = Object.freeze({ ...decoded,
      predecessor: decoded.predecessor === null ? null : Object.freeze({ ...decoded.predecessor }),
      claims: Object.freeze(decoded.claims.map(claim => Object.freeze({ ...claim, policy: Object.freeze({ ...claim.policy }) }))),
    });
    const bytes = new TextEncoder().encode(encodeCanonicalJson(frame, () => { throw new Error("Invalid owned claims frame"); }));
    const sha256 = yield* digestApplicationWriteOwnership(bytes);
    return Object.freeze({ frame, sha256Hex: encodeBytesToLowercaseHex(sha256),
      get canonicalBytes() { return copyBytes(bytes); }, get sha256() { return copyBytes(sha256); } });
  },
);

export const decodeStoredApplicationWriteOwnership = Effect.fn("ApplicationWriteOwnership.decodeStored")(
  function* (bytes: Uint8Array, expectedSha256: Uint8Array): Effect.fn.Return<CanonicalApplicationWriteOwnership, ApplicationWriteOwnershipError> {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_WRITE_OWNERSHIP_HISTORY_BYTES) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "historyLimit" }));
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      catch: cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }),
    });
    const canonical = yield* canonicalizeApplicationWriteOwnership(parsed);
    if (!bytesEqualFullScan(canonical.canonicalBytes, bytes) || !bytesEqualFullScan(canonical.sha256, expectedSha256)) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
    }
    return canonical;
  },
);
