import { Result, Schema } from "effect";

/** Migration connection phases have separate deadlines and recovery ownership. */
export const postgresMigrationDefaults = Object.freeze({
  acquisitionTimeoutMilliseconds: 5_000,
  transactionTimeoutMilliseconds: 60_000,
  cleanupTimeoutMilliseconds: 5_000,
  maximumStatementsPerTransaction: 8_192,
});
export const postgresMigrationCeilings = Object.freeze({
  acquisitionTimeoutMilliseconds: 60_000,
  transactionTimeoutMilliseconds: 300_000,
  cleanupTimeoutMilliseconds: 60_000,
  maximumStatementsPerTransaction: 65_536,
});
const positive = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));
const PostgresMigrationPolicy = Schema.Struct({
  acquisitionTimeoutMilliseconds: positive(postgresMigrationCeilings.acquisitionTimeoutMilliseconds),
  transactionTimeoutMilliseconds: positive(postgresMigrationCeilings.transactionTimeoutMilliseconds),
  cleanupTimeoutMilliseconds: positive(postgresMigrationCeilings.cleanupTimeoutMilliseconds),
  maximumStatementsPerTransaction: positive(postgresMigrationCeilings.maximumStatementsPerTransaction),
});
export type PostgresMigrationPolicy = typeof PostgresMigrationPolicy.Type;
const decodePostgresMigrationPolicy = Schema.decodeUnknownResult(PostgresMigrationPolicy);
export const capturePostgresMigrationPolicy = (input: Partial<PostgresMigrationPolicy>) =>
  decodePostgresMigrationPolicy({
    acquisitionTimeoutMilliseconds: input.acquisitionTimeoutMilliseconds ?? postgresMigrationDefaults.acquisitionTimeoutMilliseconds,
    transactionTimeoutMilliseconds: input.transactionTimeoutMilliseconds ?? postgresMigrationDefaults.transactionTimeoutMilliseconds,
    cleanupTimeoutMilliseconds: input.cleanupTimeoutMilliseconds ?? postgresMigrationDefaults.cleanupTimeoutMilliseconds,
    maximumStatementsPerTransaction: input.maximumStatementsPerTransaction ?? postgresMigrationDefaults.maximumStatementsPerTransaction,
  }).pipe(Result.map(value => Object.freeze(value)));

export const migrationCoordinatorLimits = Object.freeze({
  timeoutMilliseconds: 600_000, runTimeoutMilliseconds: 300_000,
  defaultRunTimeoutMilliseconds: 120_000, stepsPerBatch: 16, stepsPerCall: 128,
});
const MigrationTimeout = positive(migrationCoordinatorLimits.timeoutMilliseconds);
const MigrationRunTimeout = positive(migrationCoordinatorLimits.runTimeoutMilliseconds);
export const isMigrationTimeout = Schema.is(MigrationTimeout);
export const isMigrationRunTimeout = Schema.is(MigrationRunTimeout);
// Zero is an intentional claim-only coordinator call, but not an installer run.
export const isMigrationStepBatch = Schema.is(Schema.Int.check(Schema.isBetween({
  minimum: 0, maximum: migrationCoordinatorLimits.stepsPerBatch,
})));
const FrameworkInstallerPolicy = Schema.Struct({
  leaseDurationMilliseconds: MigrationTimeout,
  lockTimeoutMilliseconds: MigrationTimeout,
  statementTimeoutMilliseconds: MigrationTimeout,
  runTimeoutMilliseconds: MigrationRunTimeout,
  maximumStepsPerCall: positive(migrationCoordinatorLimits.stepsPerCall),
});
export type FrameworkInstallerPolicy = typeof FrameworkInstallerPolicy.Type;
export const decodeFrameworkInstallerPolicy = Schema.decodeUnknownResult(FrameworkInstallerPolicy);
