import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { decodeLinkCascade } from "../src/links/cascade-result";

const reported = { serviceName: "native_link_service", method: "softDelete",
  args: { stock_location_id: ["location-a"] }, error: { name: "Error", message: "Native cascade refused after partial work" } };
const partial = { native_link_service: { id: ["link-a"], stock_location_id: ["location-a"] } };

describe("atomic native Link cascade result boundary", () => {
  it("preserves successful complete native maps, order and duplicate scalar IDs", () => {
    for (const map of [{}, partial, { fulfillment: { fulfillment_set_id: ["é", "😀", "é"] } }])
      expect(decodeLinkCascade([null, map])).toEqual(Result.succeed([null, map]));
  });

  it("refuses valid nonempty native errors while retaining the whole partial result as cause", () => {
    const errors = [reported, { ...reported, serviceName: "next_service", method: "restore", args: ["location-b"],
      error: { name: "Error", message: "Second native refusal", code: "native-code" } }];
    for (const selected of [[reported], errors]) {
      const tuple = [selected, partial], result = decodeLinkCascade(tuple);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: tuple } });
      expect(tuple).toEqual([selected, partial]);
    }
  });

  it("validates the whole tuple before classifying a valid native cascade refusal", () => {
    for (const map of [{ native_link_service: { id: [""] } },
      { native_link_service: { id: [undefined] } }, { native_link_service: { id: ["a".repeat(257)] } }])
      expect(decodeLinkCascade([[reported], map])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("rejects malformed error envelopes, tuple shape and out-of-profile maps", () => {
    for (const value of [[], [null], [null, {}, null], [[], partial], [[{ ...reported, extra: true }], partial],
      [[{ ...reported, error: "not-an-error-object" }], partial], [[{ ...reported, args: undefined }], partial],
      [Array.from({ length: 9 }, () => reported), partial], [null, { service: { id: Array.from({ length: 17 }, () => "id") } }],
      [null, { service: { id: [""] } }], [null, { service: { id: 1 } }]])
      expect(decodeLinkCascade(value)).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
