import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants } from "../src/frameworks/atomicCommerce/participants";
import { MAX_COMMERCE_BINDINGS } from "../src/installation/frameworkSchema/binding/model";

/** The capture owner deliberately defers source/installation authentication.
 * These foreign envelopes exercise that synchronous boundary only; genuine
 * preparation, command execution and replay use the separate database lane. */
function envelope(name: string, physical = false, reflected = { source: 0, installation: 0 }) {
  const member = { participant: defineAtomicCommerceParticipant(name), commands: [],
    get logicalStorage(): never { throw new Error("Foreign getter must be intercepted"); } };
  return new Proxy(member, { get(target, key, receiver) {
    if (key === "logicalStorage") {
      reflected.source++;
      return physical ? undefined : { ports: {}, source: null,
        initialization: { stepId: "capture.empty", datasetSha256: "0".repeat(64), expectedRowCount: 0 } };
    }
    if (key === "profile" || key === "installation") {
      reflected.installation++;
      throw new Error("Physical authority must not be reflected for the logical allowance");
    }
    return Reflect.get(target, key, receiver);
  } });
}
const logical = (count: number) => Array.from({ length: count }, (_, index) => envelope("logical" + index));
const refused = { _tag: "Failure", failure: { reason: "unsupportedProfile" } };

describe("trusted logical participant allowance capture", () => {
  it("preserves default eight and the separate physical binding ceiling", () => {
    expect(MAX_COMMERCE_BINDINGS).toBe(8);
    expect(Result.isSuccess(captureAtomicCommerceParticipants(logical(8)))).toBe(true);
    expect(captureAtomicCommerceParticipants(logical(9))).toMatchObject(refused);
    expect(captureAtomicCommerceParticipants(logical(9), 8)).toMatchObject(refused);
  });
  it("admits exactly the explicit nine-member logical cohort without changing defaults", () => {
    const selected = captureAtomicCommerceParticipants(logical(9), 9);
    expect(Result.isSuccess(selected)).toBe(true);
    if (Result.isFailure(selected)) throw new Error("Unexpected capture refusal");
    expect(selected.success).toHaveLength(9);
    expect(selected.success.every(member => member.kind === "logical")).toBe(true);
    expect(captureAtomicCommerceParticipants(logical(10), 9)).toMatchObject(refused);
    expect(captureAtomicCommerceParticipants(logical(9))).toMatchObject(refused);
  });
  it("honors an explicit smaller allowance before reflecting source selections", () => {
    const reflected = { source: 0, installation: 0 };
    const members = Array.from({ length: 3 }, (_, index) => envelope("bounded" + index, false, reflected));
    expect(captureAtomicCommerceParticipants(members, 2)).toMatchObject(refused);
    expect(reflected.source).toBe(0);
    expect(Result.isSuccess(captureAtomicCommerceParticipants(members.slice(0, 2), 2))).toBe(true);
    expect(captureAtomicCommerceParticipants([], 9)).toMatchObject(refused);
  });
  it.each([null, false, true, "9", {}, [], 0, -1, 1.5, 10, 16, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses malformed or unsupported allowance %s before source reflection", invalid => {
      const reflected = { source: 0, installation: 0 };
      expect(captureAtomicCommerceParticipants([envelope("invalid_limit", false, reflected)], invalid)).toMatchObject(refused);
      expect(reflected.source).toBe(0);
      expect(reflected.installation).toBe(0);
    },
  );
  it.each([0, 4, 8])("refuses a physical member at position %s in the nine-member selection", index => {
    const reflected = { source: 0, installation: 0 }, members = logical(9);
    members[index] = envelope("physical" + index, true, reflected);
    expect(captureAtomicCommerceParticipants(members, 9)).toMatchObject(refused);
    expect(reflected.installation).toBe(0);
  });
  it("refuses the logical-only allowance for a smaller physical cohort too", () => {
    const reflected = { source: 0, installation: 0 };
    expect(captureAtomicCommerceParticipants([envelope("physical_small", true, reflected)], 9)).toMatchObject(refused);
    expect(reflected.installation).toBe(0);
  });
  it("owns the accepted cohort before later caller array mutation", () => {
    const members = logical(9), selected = captureAtomicCommerceParticipants(members, 9);
    if (Result.isFailure(selected)) throw new Error("Unexpected capture refusal");
    members.splice(0, members.length);
    expect(selected.success).toHaveLength(9);
    expect(Object.isFrozen(selected.success)).toBe(true);
    expect(selected.success.every(Object.isFrozen)).toBe(true);
  });
});
