import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCmsRequestBudget, defaultCmsRequestBudget } from "../src/frameworkExecutionPolicy";
import { capturePostgresMigrationPolicy, decodeFrameworkInstallerPolicy, isMigrationStepBatch,
  postgresMigrationDefaults, postgresMigrationCeilings } from "../src/migrationCoordination/policy";

describe("trusted execution selections", () => {
  it("rejects malformed CMS budgets without coercion or silently dropping fields", () => {
    for (const input of [null, {}, { calls: 1 }, { ...defaultCmsRequestBudget, extra: 1 },
      ...[0, -1, 1.5, NaN, Infinity, "64"].map(calls => ({ ...defaultCmsRequestBudget, calls })),
      { ...defaultCmsRequestBudget, commandBytes: defaultCmsRequestBudget.commandBytes + 1 }]) {
      expect(Result.isFailure(decodeCmsRequestBudget(input))).toBe(true);
    }
  });

  it("captures migration defaults and validates each distinct phase ceiling", () => {
    expect(Result.getOrThrow(capturePostgresMigrationPolicy({}))).toEqual(postgresMigrationDefaults);
    const input = { ...postgresMigrationDefaults, cleanupTimeoutMilliseconds: 5000 };
    const captured = Result.getOrThrow(capturePostgresMigrationPolicy(input));
    input.cleanupTimeoutMilliseconds = 1;
    expect(captured.cleanupTimeoutMilliseconds).toBe(5000);
    expect(Object.isFrozen(captured)).toBe(true);
    for (const [field, maximum] of Object.entries(postgresMigrationCeilings)) {
      for (const value of [0, -1, 1.5, NaN, Infinity, maximum + 1]) {
        expect(Result.isFailure(capturePostgresMigrationPolicy({ [field]: value }))).toBe(true);
      }
      expect(Result.isSuccess(capturePostgresMigrationPolicy({ [field]: maximum }))).toBe(true);
    }
  });

  it("retains coordinator claim-only calls and bounded installer runs", () => {
    expect(isMigrationStepBatch(0)).toBe(true);
    expect(isMigrationStepBatch(16)).toBe(true);
    expect(isMigrationStepBatch(17)).toBe(false);
    const policy = { leaseDurationMilliseconds: 600000, lockTimeoutMilliseconds: 1,
      statementTimeoutMilliseconds: 600000, runTimeoutMilliseconds: 300000, maximumStepsPerCall: 128 };
    expect(Result.isSuccess(decodeFrameworkInstallerPolicy(policy))).toBe(true);
    for (const change of [{ maximumStepsPerCall: 0 }, { maximumStepsPerCall: 129 },
      { leaseDurationMilliseconds: 600001 }, { runTimeoutMilliseconds: 300001 }]) {
      expect(Result.isFailure(decodeFrameworkInstallerPolicy({ ...policy, ...change }))).toBe(true);
    }
  });
});
