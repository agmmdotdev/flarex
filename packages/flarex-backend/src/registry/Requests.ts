import { Effect } from "effect";
import {
  decodeCreateDeploymentRequestEffect,
  ProtocolValidationError,
  type CreateDeploymentRequest,
} from "flarex-protocol/registry";

export const decodeRegistryCreateDeploymentPayload = Effect.fn(
  "RegistryRequests.decodeCreateDeploymentPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<CreateDeploymentRequest, ProtocolValidationError> {
  return yield* decodeCreateDeploymentRequestEffect(value);
});
