import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
  type PrivateSha256V1Foreign,
} from "@flarex/analysis/internal/private-sha256-v1";
import { Data, Effect } from "effect";

export interface SourceArtifactV2Sha256Budget {
  readonly maximumInputBytes: number;
}

export class SourceArtifactV2Sha256InputError extends Data.TaggedError(
  "SourceArtifactV2Sha256InputError",
)<{
  readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class SourceArtifactV2Sha256ResourceError extends Data.TaggedError(
  "SourceArtifactV2Sha256ResourceError",
)<{
  readonly reason: "unavailable" | "nativeRejected";
}> {}

export class SourceArtifactV2Sha256InvariantDefect extends Data.TaggedError(
  "SourceArtifactV2Sha256InvariantDefect",
)<{
  readonly reason: "invalidPlatformIntrinsic" | "invalidDigestOutput";
  readonly observedByteLength?: number;
}> {}

export type SourceArtifactV2Sha256Error =
  | SourceArtifactV2Sha256InputError
  | SourceArtifactV2Sha256ResourceError;

export type SourceArtifactV2ForeignSha256 = PrivateSha256V1Foreign;

export type SourceArtifactV2Sha256 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, SourceArtifactV2Sha256Error, never>;

const nativeCauseByResourceError = new WeakMap<SourceArtifactV2Sha256ResourceError, DOMException>();

export function sourceArtifactV2Sha256NativeCause(
  error: SourceArtifactV2Sha256ResourceError,
): DOMException | undefined {
  return nativeCauseByResourceError.get(error);
}

export function makeSourceArtifactV2Sha256(
  foreign: SourceArtifactV2ForeignSha256,
): SourceArtifactV2Sha256 {
  const sha256 = makePrivateSha256V1(foreign, sourceArtifactV2Sha256ErrorPolicy);
  return Effect.fn("SourceArtifactV2.sha256")((input: unknown, budget: unknown) =>
    sha256(input, budget)
  );
}

export function makeLiveSourceArtifactV2Sha256(): SourceArtifactV2Sha256 {
  const sha256 = makeLivePrivateSha256V1(sourceArtifactV2Sha256ErrorPolicy);
  return Effect.fn("SourceArtifactV2.sha256")((input: unknown, budget: unknown) =>
    sha256(input, budget)
  );
}

const sourceArtifactV2Sha256ErrorPolicy: PrivateSha256V1ErrorPolicy<
  SourceArtifactV2Sha256Error
> = {
  invalidBudget: () => new SourceArtifactV2Sha256InputError({ reason: "invalidBudget" }),
  invalidBytes: () => new SourceArtifactV2Sha256InputError({ reason: "invalidBytes" }),
  inputBytesExceeded: (observed, maximum) => new SourceArtifactV2Sha256InputError({
    reason: "inputBytesExceeded",
    observed,
    maximum,
  }),
  unavailable: () => new SourceArtifactV2Sha256ResourceError({ reason: "unavailable" }),
  nativeRejected: cause => {
    const error = new SourceArtifactV2Sha256ResourceError({ reason: "nativeRejected" });
    nativeCauseByResourceError.set(error, cause);
    return error;
  },
  invalidDigestOutput: observedByteLength => new SourceArtifactV2Sha256InvariantDefect({
    reason: "invalidDigestOutput",
    ...(observedByteLength === undefined ? {} : { observedByteLength }),
  }),
};
