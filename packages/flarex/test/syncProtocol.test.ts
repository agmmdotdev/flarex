import { describe, expect, it } from "vitest";
import {
  assertJson,
  parseServerMessage,
  type Authenticate,
  type ClientMessage,
} from "../src/sync/protocol";

describe("sync protocol ownership", () => {
  it("normalizes SDK arguments locally while returning protocol JSON", () => {
    expect(assertJson({ name: "Ada", omitted: undefined })).toEqual({
      name: "Ada",
    });
  });

  it("decodes the SDK server subset through the shared protocol parser", () => {
    expect(parseServerMessage({
      type: "MutationResponse",
      requestId: 1,
      success: true,
      result: { id: "1:user" },
      logLines: [],
    })).toEqual({
      type: "MutationResponse",
      requestId: 1,
      success: true,
      result: { id: "1:user" },
      logLines: [],
    });
  });

  it("retains the SDK's deliberate rejection of unsupported action responses", () => {
    expect(() => parseServerMessage({
      type: "ActionResponse",
      requestId: 1,
      success: true,
      result: null,
      logLines: [],
    })).toThrow("Unknown sync server message type: ActionResponse.");
  });

  it("derives the SDK's narrower outbound authentication subset", () => {
    const authentication: Authenticate = {
      type: "Authenticate",
      tokenType: "None",
      baseVersion: 0,
    };
    const message: ClientMessage = authentication;

    expect(message).toEqual(authentication);
  });
});
