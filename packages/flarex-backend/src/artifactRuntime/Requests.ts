import {
  decodeExecutionArtifactInvokePayloadBodyEffect,
  ExecutionArtifactInvokePayloadError,
} from "flarex-protocol/artifact-runtime";
import { Effect } from "effect";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";

export { ExecutionArtifactInvokePayloadError } from "flarex-protocol/artifact-runtime";

export const decodeExecutionArtifactInvokePayloadBody = Effect.fn(
  "ArtifactRuntimeRequests.decodeInvokePayloadBody",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionArtifactInvokePayload, ExecutionArtifactInvokePayloadError> {
  return yield* decodeExecutionArtifactInvokePayloadBodyEffect(value).pipe(
    Effect.map(payload => payload as ExecutionArtifactInvokePayload),
  );
});
