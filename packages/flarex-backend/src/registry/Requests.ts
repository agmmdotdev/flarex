import { Effect } from "effect";
import {
  parseCreateDeploymentRequest,
  ProtocolValidationError,
  type CreateDeploymentRequest,
} from "flarex-protocol/registry";

export const decodeRegistryCreateDeploymentPayload = Effect.fn(
  "RegistryRequests.decodeCreateDeploymentPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<CreateDeploymentRequest, ProtocolValidationError> {
  return yield* registryProtocolParserResultToEffect(() =>
    parseRegistryCreateDeploymentPayload(value)
  );
});

export function parseRegistryCreateDeploymentPayload(
  value: unknown,
): CreateDeploymentRequest {
  return parseCreateDeploymentRequest(value);
}

function registryProtocolParserResultToEffect<T>(
  parse: () => T,
): Effect.Effect<T, ProtocolValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(parse());
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        return Effect.fail(error);
      }
      return Effect.die(error);
    }
  });
}
