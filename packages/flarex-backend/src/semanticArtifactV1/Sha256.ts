import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
  type PrivateSha256V1Foreign,
} from "@flarex/analysis/internal/private-sha256-v1";
import { Data, Effect } from "effect";

export interface SemanticArtifactV1Sha256Budget {
  readonly maximumInputBytes: number;
}

export class SemanticArtifactV1Sha256InputError extends Data.TaggedError(
  "SemanticArtifactV1Sha256InputError",
)<{
  readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class SemanticArtifactV1Sha256ResourceError extends Data.TaggedError(
  "SemanticArtifactV1Sha256ResourceError",
)<{ readonly reason: "unavailable" | "nativeRejected" }> {}

export class SemanticArtifactV1Sha256InvariantDefect extends Data.TaggedError(
  "SemanticArtifactV1Sha256InvariantDefect",
)<{
  readonly reason: "invalidDigestOutput";
  readonly observedByteLength?: number;
}> {}

export type SemanticArtifactV1Sha256Error =
  | SemanticArtifactV1Sha256InputError
  | SemanticArtifactV1Sha256ResourceError;

export type SemanticArtifactV1Sha256 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, SemanticArtifactV1Sha256Error, never>;

const nativeCause = new WeakMap<SemanticArtifactV1Sha256ResourceError, DOMException>();

export function semanticArtifactV1Sha256NativeCause(
  error: SemanticArtifactV1Sha256ResourceError,
): DOMException | undefined {
  return nativeCause.get(error);
}

export function makeSemanticArtifactV1Sha256(
  foreign: PrivateSha256V1Foreign,
): SemanticArtifactV1Sha256 {
  const digest = makePrivateSha256V1(foreign, policy);
  return Effect.fn("SemanticArtifactV1.sha256")((input: unknown, budget: unknown) =>
    digest(input, budget)
  );
}

export function makeLiveSemanticArtifactV1Sha256(): SemanticArtifactV1Sha256 {
  const digest = makeLivePrivateSha256V1(policy);
  return Effect.fn("SemanticArtifactV1.sha256")((input: unknown, budget: unknown) =>
    digest(input, budget)
  );
}

const policy: PrivateSha256V1ErrorPolicy<SemanticArtifactV1Sha256Error> = {
  invalidBudget: () => new SemanticArtifactV1Sha256InputError({ reason: "invalidBudget" }),
  invalidBytes: () => new SemanticArtifactV1Sha256InputError({ reason: "invalidBytes" }),
  inputBytesExceeded: (observed, maximum) =>
    new SemanticArtifactV1Sha256InputError({
      reason: "inputBytesExceeded",
      observed,
      maximum,
    }),
  unavailable: () => new SemanticArtifactV1Sha256ResourceError({ reason: "unavailable" }),
  nativeRejected: cause => {
    const error = new SemanticArtifactV1Sha256ResourceError({ reason: "nativeRejected" });
    nativeCause.set(error, cause);
    return error;
  },
  invalidDigestOutput: observedByteLength =>
    new SemanticArtifactV1Sha256InvariantDefect({
      reason: "invalidDigestOutput",
      ...(observedByteLength === undefined ? {} : { observedByteLength }),
    }),
};
