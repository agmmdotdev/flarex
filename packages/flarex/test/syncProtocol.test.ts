import { describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { serializePathArgsAndPartition } from "../src/sync/localState";
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

  it("serializes normalized query arguments with protocol canonical ordering", () => {
    expect(serializePathArgsAndPartition(
      "lessons:list",
      { z: 2, omitted: undefined, a: { d: 4, c: 3 } },
      "user:ada",
    )).toBe(
      'user:ada|lessons:list|{"a":{"c":3,"d":4},"z":2}',
    );
  });

  it("rejects sparse SDK argument arrays instead of producing malformed JSON", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(() => serializePathArgsAndPartition(
      "lessons:list",
      { values: sparse },
      "user:ada",
    )).toThrow("Expected $.values[0] to be a JSON value.");
  });

  it("preserves __proto__ as an own JSON property during normalization", () => {
    const input = Object.fromEntries([
      ["__proto__", { polluted: true }],
    ]);
    const normalized = assertJson(input);
    if (!isJsonObject(normalized)) {
      throw new Error("Expected normalized query arguments to be an object.");
    }

    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    expect(Object.hasOwn(normalized, "__proto__")).toBe(true);
    expect(normalized["__proto__"]).toEqual({ polluted: true });
    expect(serializePathArgsAndPartition(
      "lessons:list",
      input,
      "user:ada",
    )).toBe(
      'user:ada|lessons:list|{"__proto__":{"polluted":true}}',
    );
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
