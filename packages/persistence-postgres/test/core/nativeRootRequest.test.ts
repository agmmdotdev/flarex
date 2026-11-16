import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson, type Json, type JsonObject } from "flarex-protocol/json";
import { coreNativeRootEventFamilyId } from "../../src/commit/events/coreStore";
import { CoreNativeIdentitySchema } from "../../src/core/nativePolicy";
import { CORE_NATIVE_ROOT_FRAME_BYTES, captureCoreNativeRootIdentity, captureCoreNativeRootRequestEvidence,
  composeCoreNativeRootRequestEvidence, encodeCoreNativeRootRequestEvidence, isIssuedCoreNativeRootFrame } from "../../src/core/nativeRootRequest";

const canonical = (value: Json) => encodeCanonicalJson(value, issue => { throw new Error("Test evidence lost JSON", { cause: issue }); });
const decodeIdentity = Schema.decodeUnknownSync(CoreNativeIdentitySchema);
const source = (sourceKey = "neutral") => decodeIdentity({ scopeUuid: "414ae657-285f-46f0-b0f6-04c4a2b1c605",
  epochUuid: "e4aef41a-7d79-44d8-9707-248ba3a1058f", sourceKey, sourceSha256: "1".repeat(64), configSha256: "2".repeat(64),
  provenanceSha256: "3".repeat(64), definitionHash: "4".repeat(64) });
const frameInput = (contract: JsonObject, sourceKey?: string): JsonObject => ({ format: "flarex.core-native-root", version: 1, namespace: null,
  contract, participants: [{ source: source(sourceKey), commands: [{ name: "write", mode: "write" }],
    limits: { maxIdentities: 4, maxDocumentBytes: 4096 } }], applicationInsert: null, maxFinalUserDocuments: 1, protectedMetadata: true });
const nested = (depth: number): JsonObject => depth === 0 ? {} : { a: nested(depth - 1) };
const outcome = <A>(result: Result.Result<A, { readonly reason: string }>) =>
  Result.isSuccess(result) ? { evidence: result.success } : { refused: result.failure.reason };
const requestHash = "a".repeat(64);

describe("native root request evidence over a bound frame", () => {
  it("equals the complete capture in evidence, canonical bytes and family id", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const bound = yield* captureCoreNativeRootIdentity(frameInput({ events: { producerRevision: "a".repeat(64) }, nested: [1, "é", { z: null, a: -0 }] }));
      expect(isIssuedCoreNativeRootFrame(bound.frame)).toBe(true);
      for (const key of ["k", "request/é/😀", "x".repeat(256)]) {
        const request = { key, requestHash, root: bound.identity, source: source() };
        const full = yield* Effect.fromResult(captureCoreNativeRootRequestEvidence({ ...request, frame: bound.frame }));
        const composed = yield* Effect.fromResult(composeCoreNativeRootRequestEvidence(request, bound.frame));
        expect(composed).toEqual(full);
        expect(Object.keys(composed)).toEqual(Object.keys(full));
        expect(composed.frame).toBe(bound.frame);
        expect(Object.isFrozen(composed) && Object.isFrozen(composed.root) && Object.isFrozen(composed.source)).toBe(true);
        // First call encodes the frame, the second reuses it; both match the complete encoding.
        expect(encodeCoreNativeRootRequestEvidence(composed)).toBe(canonical(full));
        expect(encodeCoreNativeRootRequestEvidence(composed)).toBe(canonical(full));
        expect(encodeCoreNativeRootRequestEvidence(full)).toBe(canonical(full));
        expect(yield* coreNativeRootEventFamilyId(composed)).toBe(yield* coreNativeRootEventFamilyId(full));
      }
    }));
  });

  it("refuses exactly where the complete capture refuses", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const bound = yield* captureCoreNativeRootIdentity(frameInput({}));
      const both = (request: Parameters<typeof composeCoreNativeRootRequestEvidence>[0], frame = bound.frame) => {
        const composed = outcome(composeCoreNativeRootRequestEvidence(request, frame));
        expect(composed).toEqual(outcome(captureCoreNativeRootRequestEvidence({ ...request, frame })));
        return composed;
      };
      const valid = { key: "k", requestHash, root: bound.identity, source: source() };
      expect(both(valid)).toHaveProperty("evidence");
      expect(both({ ...valid, key: "" })).toEqual({ refused: "invalidValue" });
      expect(both({ ...valid, key: "x".repeat(257) })).toEqual({ refused: "invalidValue" });
      expect(both({ ...valid, key: "lone\uD800" })).toEqual({ refused: "invalidValue" });
      expect(both({ ...valid, requestHash: "A".repeat(64) })).toEqual({ refused: "invalidValue" });
      expect(both({ ...valid, root: { definitionHash: "short" } })).toEqual({ refused: "invalidValue" });
      expect(both({ ...valid, source: { ...source(), sourceKey: "" } })).toEqual({ refused: "invalidValue" });
      // A frame that was not issued here takes the complete capture.
      const foreign = structuredClone(bound.frame);
      expect(isIssuedCoreNativeRootFrame(foreign)).toBe(false);
      expect(both(valid, foreign)).toHaveProperty("evidence");

      // The frame is one level deeper inside evidence than when it was bound.
      const depths: string[] = [];
      for (let depth = 58; depth <= 66; depth++) {
        const deep = yield* Effect.result(captureCoreNativeRootIdentity(frameInput(nested(depth))));
        if (Result.isFailure(deep)) { depths.push("unbound"); continue; }
        const result = both({ ...valid, root: deep.success.identity }, deep.success.frame);
        depths.push("refused" in result ? result.refused : "evidence");
        expect(both({ ...valid, root: deep.success.identity, key: "lone\uD800" }, deep.success.frame))
          .toEqual("refused" in result ? result : { refused: "invalidValue" });
      }
      expect(new Set(depths)).toEqual(new Set(["evidence", "capacity", "unbound"]));

      // A frame at its own byte ceiling leaves 1024 bytes for the request members.
      const longSource = "s".repeat(200);
      const probe = yield* captureCoreNativeRootIdentity(frameInput({ padding: "" }, longSource));
      const full = yield* captureCoreNativeRootIdentity(frameInput({ padding: "p".repeat(CORE_NATIVE_ROOT_FRAME_BYTES - probe.bytes) }, longSource));
      expect(full.bytes).toBe(CORE_NATIVE_ROOT_FRAME_BYTES);
      const sizes: string[] = [];
      for (let length = 1; length <= 256; length++) {
        const result = both({ key: "k".repeat(length), requestHash, root: full.identity, source: source(longSource) }, full.frame);
        sizes.push("refused" in result ? result.refused : "evidence");
      }
      const firstRefusal = sizes.indexOf("capacity");
      expect(firstRefusal).toBeGreaterThan(0);
      expect(sizes.slice(0, firstRefusal).every(size => size === "evidence")).toBe(true);
      expect(sizes.slice(firstRefusal).every(size => size === "capacity")).toBe(true);
      // Limit refusal precedes the Unicode refusal in both paths.
      expect(both({ key: `${"k".repeat(255)}\uD800`, requestHash, root: full.identity, source: source(longSource) }, full.frame))
        .toEqual({ refused: "capacity" });
    }));
  });
});
