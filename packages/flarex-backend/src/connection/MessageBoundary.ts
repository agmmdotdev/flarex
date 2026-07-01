import {
  ConnectionClientMessageError,
  decodeConnectionClientMessageEffect,
  decodeConnectionClientMessagePayloadEffect,
} from "flarex-protocol/connection";
import { Effect } from "effect";
import type { ClientMessage } from "../syncProtocol";

export { ConnectionClientMessageError } from "flarex-protocol/connection";

export const decodeConnectionClientMessage = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessage",
)(function* (
  message: string | ArrayBuffer,
): Effect.fn.Return<ClientMessage, ConnectionClientMessageError> {
  return yield* decodeConnectionClientMessageEffect(message).pipe(
    Effect.map(message => message as ClientMessage),
  );
});

export const decodeConnectionClientMessagePayload = Effect.fn(
  "ConnectionMessageBoundary.decodeClientMessagePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<ClientMessage, ConnectionClientMessageError> {
  return yield* decodeConnectionClientMessagePayloadEffect(value).pipe(
    Effect.map(message => message as ClientMessage),
  );
});
