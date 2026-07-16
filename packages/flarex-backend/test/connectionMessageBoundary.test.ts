import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConnectionClientMessageError,
  decodeConnectionClientMessage,
  decodeConnectionClientMessagePayload,
} from "../src/connection/MessageBoundary";
import {
  parseClientMessage,
  type ClientMessage,
} from "../src/syncProtocol";

describe("connection message boundary", () => {
  it("decodes websocket client messages through a named Effect boundary", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessage(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [],
    })))).resolves.toEqual({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [],
    });
  });

  it("keeps binary websocket messages typed before FatalError mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessage(new ArrayBuffer(0))))
      .rejects
      .toMatchObject({
        _tag: "ConnectionClientMessageError",
        message: "Binary sync messages are not supported.",
      });
  });

  it("keeps malformed websocket JSON typed before FatalError mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessage("{")))
      .rejects
      .toBeInstanceOf(ConnectionClientMessageError);
  });

  it("preserves sync protocol validation messages in the typed channel", async () => {
    await expect(Effect.runPromise(decodeConnectionClientMessagePayload({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: "invalid",
    }))).rejects.toMatchObject({
      _tag: "ConnectionClientMessageError",
      message: "ModifyQuerySet.modifications must be an array.",
    });
  });

  it("keeps the published backend test parser as a protocol-owned compatibility facade", () => {
    const message: ClientMessage = parseClientMessage({
      type: "Connect",
      sessionId: "legacy-session",
    });

    expect(message).toEqual({ type: "Connect" });
  });
});
