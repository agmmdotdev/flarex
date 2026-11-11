import { Cause, Effect, Exit } from "effect";
import { MedusaError } from "@medusajs/utils/common/errors";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { describe, expect, it } from "vitest";
import { makeStoreRegionRemoteQuery } from "../src/http/store-region-read";
import { defineGraphReadCommand } from "../src/local-graph/commands";

const command = defineGraphReadCommand("regionBoundaryWitness", () => Effect.succeed([]));
const query = { __value: { region: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: "reg_witness" } } } } };

describe("Store Region remote failure boundary", () => {
  it.each(["invalidInput", "unsupportedProfile", "limitExceeded"] as const)("presents %s as native invalid data", async reason => {
    const refusal = commerceError(reason);
    const read = makeStoreRegionRemoteQuery({ commands: { list: command, count: command }, read: () => Effect.fail(refusal) });
    const result = await Effect.runPromiseExit(read(query));
    if (Exit.isSuccess(result)) throw new Error("Expected native invalid-data presentation");
    const failure = result.cause.reasons.find(Cause.isFailReason)?.error;
    expect(failure?.reason).toBe("adapterFailure");
    const native = failure?.cause;
    if (!(native instanceof MedusaError)) throw new Error("Expected a native MedusaError");
    expect(native.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(native.cause).toBe(refusal);
  });

  it("keeps resource/corruption failures, defects and interruption alongside an expected refusal", async () => {
    const resource = commerceError("resourceFailure"), corruption = commerceError("storedCorruption"), defect = new Error("Region defect");
    const original = Cause.combine(Cause.combine(Cause.fail(commerceError("unsupportedProfile")), Cause.fail(resource)),
      Cause.combine(Cause.fail(corruption), Cause.combine(Cause.die(defect), Cause.interrupt(731))));
    const read = makeStoreRegionRemoteQuery({ commands: { list: command, count: command }, read: () => Effect.failCause(original) });
    const result = await Effect.runPromiseExit(read(query));
    if (Exit.isSuccess(result)) throw new Error("Expected the complete mixed Cause");
    expect(result.cause.reasons.map(reason => reason._tag)).toEqual(original.reasons.map(reason => reason._tag));
    const failures = result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
    expect(failures.map(error => error.reason)).toEqual(["adapterFailure", "resourceFailure", "storedCorruption"]);
    expect(failures[1]).toBe(resource);
    expect(failures[2]).toBe(corruption);
    expect(result.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
    expect(result.cause.reasons.find(Cause.isInterruptReason)?.fiberId).toBe(731);
  });
});
