import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants } from "../src/frameworks/atomicCommerce/participants";

it("refuses malformed reconstitution admission before inspecting the source", () => {
  let sourceReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("reconstitution_capture"), commands: [],
    get logicalStorage(): never { sourceReads++; throw new Error("Source capture reached"); } };
  for (const invalid of [null, false, "true", 1, {}]) {
    const supplied = new Proxy(member, { get(target, key, receiver) {
      return key === "allowReconstitution" ? invalid : Reflect.get(target, key, receiver);
    } });
    expect(captureAtomicCommerceParticipants([supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
  expect(sourceReads).toBe(0);
});

it("refuses physical reconstitution admission before installation reflection", () => {
  let installationReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("reconstitution_physical"), commands: [],
    get logicalStorage(): never { throw new Error("Unexpected source"); } };
  const physical = new Proxy(member, { get(target, key, receiver) {
    if (key === "allowReconstitution") return true;
    if (key === "logicalStorage") return undefined;
    if (key === "profile" || key === "installation") { installationReads++; throw new Error("Installation reached"); }
    return Reflect.get(target, key, receiver);
  } });
  expect(captureAtomicCommerceParticipants([physical])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(installationReads).toBe(0);
});
