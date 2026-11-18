import { Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "../src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceParticipants } from "../src/frameworks/atomicCommerce/participants";

it("captures only literal recorded-replay selection before source reflection", () => {
  let sourceReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("recorded_replay_capture"), commands: [],
    get logicalStorage(): never { sourceReads++; throw new Error("Source capture reached"); } };
  for (const invalid of [null, false, "true", 1, {}]) {
    const supplied = new Proxy(member, { get(target, key, receiver) {
      return key === "allowRecordedRowReplay" ? invalid : Reflect.get(target, key, receiver);
    } });
    expect(captureAtomicCommerceParticipants([supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
  expect(sourceReads).toBe(0);
});

it("refuses physical recorded-replay selection before installation reflection", () => {
  let installationReads = 0;
  const member = { participant: defineAtomicCommerceParticipant("recorded_replay_physical"), commands: [],
    get logicalStorage(): never { throw new Error("Unexpected source"); } };
  const physical = new Proxy(member, { get(target, key, receiver) {
    if (key === "allowRecordedRowReplay") return true;
    if (key === "logicalStorage") return undefined;
    if (key === "profile" || key === "installation") { installationReads++; throw new Error("Installation reached"); }
    return Reflect.get(target, key, receiver);
  } });
  expect(captureAtomicCommerceParticipants([physical])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(installationReads).toBe(0);
});

it("detaches an accepted true selection from later caller mutation", () => {
  const participant = defineAtomicCommerceParticipant("recorded_replay_owned");
  const member: { participant: typeof participant; commands: []; allowRecordedRowReplay?: true; readonly logicalStorage: never } = {
    participant, commands: [], allowRecordedRowReplay: true,
    get logicalStorage(): never { throw new Error("Source capture must be skipped"); } };
  // Source admission is deferred; this test exercises synchronous ownership only.
  const supplied = new Proxy(member, { get(target, key, receiver) {
    if (key === "logicalStorage") return { ports: {}, source: null, initialization: {
      stepId: "capture.empty", datasetSha256: "0".repeat(64), expectedRowCount: 0 } };
    return Reflect.get(target, key, receiver);
  } });
  const captured = captureAtomicCommerceParticipants([supplied]);
  expect(Result.isSuccess(captured)).toBe(true);
  delete member.allowRecordedRowReplay;
  if (Result.isFailure(captured)) throw new Error("Unexpected capture failure");
  expect(captured.success[0]?.allowRecordedRowReplay).toBe(true);
  expect(Object.isFrozen(captured.success[0])).toBe(true);
});
