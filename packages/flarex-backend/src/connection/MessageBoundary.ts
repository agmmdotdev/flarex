import {
  ConnectionClientMessageError,
  decodeConnectionClientMessageEffect,
  decodeConnectionClientMessagePayloadEffect,
  type ConnectionClientMessage,
} from "flarex-protocol/connection";
import { Effect } from "effect";

export { ConnectionClientMessageError } from "flarex-protocol/connection";

export const decodeConnectionClientMessage = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessage",
)((
  message: string | ArrayBuffer,
): Effect.Effect<ConnectionClientMessage, ConnectionClientMessageError> =>
  decodeConnectionClientMessageEffect(message));

export const decodeConnectionClientMessagePayload = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessagePayload",
)((
  value: unknown,
): Effect.Effect<ConnectionClientMessage, ConnectionClientMessageError> =>
  decodeConnectionClientMessagePayloadEffect(value));
