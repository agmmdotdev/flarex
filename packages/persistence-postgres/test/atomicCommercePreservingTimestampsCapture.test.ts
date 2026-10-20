import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants } from "../src/frameworks/atomicCommerce/participants";

it("rejects unknown preserving-deletion timestamp modes before reading logical storage", () => {
  let sourceReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("timestamp_mode_capture"), commands: [],
    get logicalStorage(): never { sourceReads++; throw new Error("Logical source reached"); } };
  for (const invalid of ["preserve", "preserveTimestamp", "advance", false, null, [], {}]) {
    const supplied = new Proxy(member, { get(target, key, receiver) {
      return key === "allowPreservingDeletionUpsert" ? invalid : Reflect.get(target, key, receiver);
    } });
    expect(captureAtomicCommerceParticipants([supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
  expect(sourceReads).toBe(0);
});

it("rejects preserving timestamps on physical participants before installation reflection", () => {
  let installationReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("timestamp_mode_physical"), commands: [],
    get logicalStorage(): never { throw new Error("Unexpected logical source"); } };
  const supplied = new Proxy(member, { get(target, key, receiver) {
    if (key === "allowPreservingDeletionUpsert") return "preserveTimestamps";
    if (key === "logicalStorage") return undefined;
    if (key === "profile" || key === "installation") { installationReads++; throw new Error("Physical installation reached"); }
    return Reflect.get(target, key, receiver);
  } });
  expect(captureAtomicCommerceParticipants([supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(installationReads).toBe(0);
});
