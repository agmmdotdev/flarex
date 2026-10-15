import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants } from "../src/frameworks/atomicCommerce/participants";

it("rejects unknown publication profiles synchronously before source capture or preparation", () => {
  let sourceReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("publication_capture"), commands: [],
    get logicalStorage(): never { sourceReads++; throw new Error("Source capture reached"); } };
  for (const invalid of [null, false, "paged", 128, {}]) {
    const supplied = new Proxy(member, { get(target, key, receiver) {
      return key === "logicalPublication" ? invalid : Reflect.get(target, key, receiver);
    } });
    expect(captureAtomicCommerceParticipants([supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
  expect(sourceReads).toBe(0);
});

it("refuses a physical mixed-publication selection before installation reflection", () => {
  let installationReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("publication_physical"), commands: [],
    get logicalStorage(): never { throw new Error("Unexpected logical source"); } };
  // The foreign configuration reports physical selection at the capture seam.
  // Neither a fabricated profile token nor a database is needed for refusal.
  const physical = new Proxy(member, { get(target, key, receiver) {
    if (key === "logicalPublication") return "mixed";
    if (key === "logicalStorage") return undefined;
    if (key === "profile" || key === "installation") { installationReads++; throw new Error("Installation reached"); }
    return Reflect.get(target, key, receiver);
  } });
  expect(captureAtomicCommerceParticipants([physical])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(installationReads).toBe(0);
});
