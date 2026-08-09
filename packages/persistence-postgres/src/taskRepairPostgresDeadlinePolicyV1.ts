import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Result } from "effect";
import type { PoolConfig } from "pg";

export const MAX_TASK_REPAIR_POSTGRES_DEADLINE_MILLISECONDS_V1 =
  2_147_483_647;

export interface TaskRepairPostgresDeadlinePolicyInputV1 {
  readonly connectionTimeoutMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
  readonly transactionTimeoutMilliseconds: number;
  readonly settlementReserveMilliseconds: number;
}

export interface TaskRepairPostgresDeadlinePolicyV1
  extends TaskRepairPostgresDeadlinePolicyInputV1 {
  readonly dispositionReserveMilliseconds: number;
  readonly postgresStartupOptions: string;
}

export class TaskRepairPostgresDeadlineConfigurationV1Error
  extends Data.TaggedError("TaskRepairPostgresDeadlineConfigurationV1Error")<{
    readonly reason:
      | "invalidConnectionTimeout"
      | "invalidLockTimeout"
      | "invalidStatementTimeout"
      | "invalidTransactionTimeout"
      | "invalidSettlementReserve"
      | "invalidDeadlineOrder"
      | "insufficientSettlementReserve"
      | "existingPostgresDeadlineConfiguration";
  }> {}

export function createTaskRepairPostgresDeadlinePolicyV1(
  input: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  TaskRepairPostgresDeadlinePolicyV1,
  TaskRepairPostgresDeadlineConfigurationV1Error
> {
  const connectionTimeoutMilliseconds = input.connectionTimeoutMilliseconds;
  if (!isPostgresDeadlineMilliseconds(connectionTimeoutMilliseconds)) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidConnectionTimeout",
    }));
  }
  const lockTimeoutMilliseconds = input.lockTimeoutMilliseconds;
  if (!isPostgresDeadlineMilliseconds(lockTimeoutMilliseconds)) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidLockTimeout",
    }));
  }
  const statementTimeoutMilliseconds = input.statementTimeoutMilliseconds;
  if (!isPostgresDeadlineMilliseconds(statementTimeoutMilliseconds)) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidStatementTimeout",
    }));
  }
  const transactionTimeoutMilliseconds = input.transactionTimeoutMilliseconds;
  if (!isPostgresDeadlineMilliseconds(transactionTimeoutMilliseconds)) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidTransactionTimeout",
    }));
  }
  const settlementReserveMilliseconds = input.settlementReserveMilliseconds;
  if (!isPositiveSafeInteger(settlementReserveMilliseconds)) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidSettlementReserve",
    }));
  }
  if (
    lockTimeoutMilliseconds >= statementTimeoutMilliseconds ||
    statementTimeoutMilliseconds >= transactionTimeoutMilliseconds
  ) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "invalidDeadlineOrder",
    }));
  }
  if (
    transactionTimeoutMilliseconds >= settlementReserveMilliseconds ||
    connectionTimeoutMilliseconds >=
      settlementReserveMilliseconds - transactionTimeoutMilliseconds
  ) {
    return Result.fail(new TaskRepairPostgresDeadlineConfigurationV1Error({
      reason: "insufficientSettlementReserve",
    }));
  }

  return Result.succeed(Object.freeze({
    connectionTimeoutMilliseconds,
    lockTimeoutMilliseconds,
    statementTimeoutMilliseconds,
    transactionTimeoutMilliseconds,
    settlementReserveMilliseconds,
    dispositionReserveMilliseconds:
      settlementReserveMilliseconds - transactionTimeoutMilliseconds -
      connectionTimeoutMilliseconds,
    postgresStartupOptions:
      `-c lock_timeout=${lockTimeoutMilliseconds}ms ` +
      `-c statement_timeout=${statementTimeoutMilliseconds}ms ` +
      `-c transaction_timeout=${transactionTimeoutMilliseconds}ms`,
  }));
}

/**
 * Apply to the complete final PoolConfig and pass the returned snapshot
 * directly to pg.Pool. Adding a separate connectionString afterward would
 * bypass the connection-string precedence checks owned here.
 */
export function applyTaskRepairPostgresDeadlinePolicyV1(
  base: Readonly<PoolConfig>,
  policy: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  Readonly<PoolConfig>,
  TaskRepairPostgresDeadlineConfigurationV1Error
> {
  return createTaskRepairPostgresDeadlinePolicyV1(policy).pipe(
    Result.flatMap((capturedPolicy) => {
      const capturedBase = { ...base };
      const options = capturedBase.options;
      const connectionString = capturedBase.connectionString;
      const connectionTimeout = capturedBase.connectionTimeoutMillis;
      const lockTimeout = capturedBase.lock_timeout;
      const statementTimeout = capturedBase.statement_timeout;
      const queryTimeout = capturedBase.query_timeout;
      const idleInTransactionTimeout =
        capturedBase.idle_in_transaction_session_timeout;
      if (
        (connectionString !== undefined &&
          connectionStringContainsCompetingConfiguration(connectionString)) ||
        (options !== undefined && containsDeadlineOption(options)) ||
        connectionTimeout !== undefined ||
        lockTimeout !== undefined ||
        statementTimeout !== undefined ||
        queryTimeout !== undefined ||
        idleInTransactionTimeout !== undefined
      ) {
        return Result.fail(
          new TaskRepairPostgresDeadlineConfigurationV1Error({
            reason: "existingPostgresDeadlineConfiguration",
          }),
        );
      }
      return Result.succeed(Object.freeze({
        ...capturedBase,
        connectionTimeoutMillis:
          capturedPolicy.connectionTimeoutMilliseconds,
        lock_timeout: capturedPolicy.lockTimeoutMilliseconds,
        statement_timeout: capturedPolicy.statementTimeoutMilliseconds,
        options: options === undefined || options.trim().length === 0
          ? capturedPolicy.postgresStartupOptions
          : `${options} ${capturedPolicy.postgresStartupOptions}`,
      }));
    }),
  );
}

function isPostgresDeadlineMilliseconds(value: unknown): value is number {
  return isPositiveSafeInteger(value) &&
    value <= MAX_TASK_REPAIR_POSTGRES_DEADLINE_MILLISECONDS_V1;
}

function containsDeadlineOption(options: string): boolean {
  const lower = options.toLowerCase();
  return lower.includes("lock_timeout") ||
    lower.includes("statement_timeout") ||
    lower.includes("transaction_timeout") ||
    lower.includes("idle_in_transaction_session_timeout") ||
    lower.includes("query_timeout");
}

function connectionStringContainsCompetingConfiguration(
  connectionString: string,
): boolean {
  try {
    const parsed = new URL(connectionString, "postgres://flarex.invalid");
    for (const [rawName] of parsed.searchParams) {
      const name = rawName.toLowerCase();
      if (
        name === "options" ||
        name === "lock_timeout" ||
        name === "statement_timeout" ||
        name === "transaction_timeout" ||
        name === "query_timeout" ||
        name === "idle_in_transaction_session_timeout" ||
        name === "connectiontimeoutmillis" ||
        name === "connection_timeout" ||
        name === "connect_timeout"
      ) return true;
    }
    return false;
  } catch {
    return true;
  }
}
