import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  MAX_TASK_REPAIR_POSTGRES_DEADLINE_MILLISECONDS_V1,
  applyTaskRepairPostgresDeadlinePolicyV1,
  createTaskRepairPostgresDeadlinePolicyV1,
} from "../src/taskRepairPostgresDeadlinePolicyV1";

const validInput = Object.freeze({
  connectionTimeoutMilliseconds: 250,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 1_500,
});

describe("DTE05-E2C2 Task repair PostgreSQL deadline policy", () => {
  it("constructs exact startup settings and preserves unrelated pool options", () => {
    const policy = Result.getOrThrow(
      createTaskRepairPostgresDeadlinePolicyV1(validInput),
    );
    const password = () => "secret";
    const configured = Result.getOrThrow(
      applyTaskRepairPostgresDeadlinePolicyV1({
        connectionString: "postgres://example.invalid/flarex",
        max: 1,
        password,
        options: "-c search_path=private",
      }, policy),
    );

    expect(configured).toEqual({
      connectionString: "postgres://example.invalid/flarex",
      max: 1,
      password,
      options:
        "-c search_path=private -c lock_timeout=100ms " +
        "-c statement_timeout=500ms " +
        "-c transaction_timeout=1000ms",
      connectionTimeoutMillis: 250,
      lock_timeout: 100,
      statement_timeout: 500,
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(configured)).toBe(true);
  });

  it.each([
    ["invalidConnectionTimeout", {
      ...validInput,
      connectionTimeoutMilliseconds: 0,
    }],
    ["invalidLockTimeout", { ...validInput, lockTimeoutMilliseconds: 0 }],
    ["invalidStatementTimeout", {
      ...validInput,
      statementTimeoutMilliseconds: Number.NaN,
    }],
    ["invalidTransactionTimeout", {
      ...validInput,
      transactionTimeoutMilliseconds:
        MAX_TASK_REPAIR_POSTGRES_DEADLINE_MILLISECONDS_V1 + 1,
    }],
    ["invalidSettlementReserve", {
      ...validInput,
      settlementReserveMilliseconds: 1.5,
    }],
    ["invalidDeadlineOrder", {
      ...validInput,
      statementTimeoutMilliseconds: 100,
    }],
    ["insufficientSettlementReserve", {
      ...validInput,
      settlementReserveMilliseconds: 1_250,
    }],
  ] as const)("fails closed with %s", (reason, input) => {
    const result = createTaskRepairPostgresDeadlinePolicyV1(input);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe(reason);
  });

  it.each([
    [{ options: "-c transaction_timeout=10ms" }],
    [{ options: "-c statement_TIMEOUT=10ms" }],
    [{ options: "-c idle_in_transaction_session_timeout=10ms" }],
    [{ lock_timeout: 10 }],
    [{ statement_timeout: false }],
    [{ connectionTimeoutMillis: 10 }],
    [{ query_timeout: 10 }],
    [{
      connectionString:
        "postgres://example.invalid/flarex?statement_timeout=0",
    }],
    [{
      connectionString:
        "postgres://example.invalid/flarex?options=-c%20search_path%3Dprivate",
    }],
  ] as const)("rejects an existing PostgreSQL deadline surface", (base) => {
    const policy = Result.getOrThrow(
      createTaskRepairPostgresDeadlinePolicyV1(validInput),
    );
    const result = applyTaskRepairPostgresDeadlinePolicyV1(base, policy);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe(
        "existingPostgresDeadlineConfiguration",
      );
    }
  });

  it("revalidates numeric authority and ignores a forged startup string", () => {
    const forged = Object.freeze({
      ...validInput,
      postgresStartupOptions:
        "-c lock_timeout=0 -c statement_timeout=0 " +
        "-c transaction_timeout=0",
    });
    const configured = Result.getOrThrow(
      applyTaskRepairPostgresDeadlinePolicyV1({}, forged),
    );
    expect(configured.options).toBe(
      "-c lock_timeout=100ms -c statement_timeout=500ms " +
      "-c transaction_timeout=1000ms",
    );

    const invalid = applyTaskRepairPostgresDeadlinePolicyV1({}, {
      ...forged,
      transactionTimeoutMilliseconds: 0,
    });
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure.reason).toBe("invalidTransactionTimeout");
    }
  });
});
