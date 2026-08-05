import { copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import type {
  DeclarativeV2RuntimeArtifactSha256V1,
  DeclarativeV2RuntimeArtifactSha256V1Error,
} from "./DeclarativeV2RuntimeArtifactSha256";

const UTF8 = new TextEncoder();

interface CandidateBoundRuntimeTargetEncodingV1 {
  readonly canonicalBytes: Uint8Array;
}

export interface CandidateBoundRuntimeTargetCommitmentV1 {
  readonly exactRuntimeGraphBasisSha256: Uint8Array;
  readonly canonicalTargetBytes: Uint8Array;
  readonly runtimeTargetSha256: Uint8Array;
}

/**
 * Commits an exact Worker graph into a candidate-bound runtime target.
 *
 * The domain-owned encoder decides the target frame. This operation owns the
 * invariant that the graph digest is supplied to that encoder before the
 * resulting canonical target bytes receive their final digest.
 */
export const deriveCandidateBoundRuntimeTargetCommitmentV1 = Effect.fn(
  "CandidateBoundRuntimeTarget.deriveCommitmentV1",
)(function* <Encoded extends CandidateBoundRuntimeTargetEncodingV1, EncodeError>(
  graphBasis: string,
  maximumHashBytes: number,
  encodeTarget: (
    exactRuntimeGraphBasisSha256: Uint8Array,
  ) => Result.Result<Encoded, EncodeError>,
  sha256: DeclarativeV2RuntimeArtifactSha256V1,
): Effect.fn.Return<
  CandidateBoundRuntimeTargetCommitmentV1,
  EncodeError | DeclarativeV2RuntimeArtifactSha256V1Error
> {
  const exactRuntimeGraphBasisSha256 = yield* sha256(
    UTF8.encode(graphBasis),
    { maximumInputBytes: maximumHashBytes },
  );
  const encoded = yield* Effect.fromResult(
    encodeTarget(exactRuntimeGraphBasisSha256),
  );
  const runtimeTargetSha256 = yield* sha256(encoded.canonicalBytes, {
    maximumInputBytes: maximumHashBytes,
  });
  return Object.freeze({
    exactRuntimeGraphBasisSha256: copyBytes(exactRuntimeGraphBasisSha256),
    canonicalTargetBytes: copyBytes(encoded.canonicalBytes),
    runtimeTargetSha256: copyBytes(runtimeTargetSha256),
  });
});
