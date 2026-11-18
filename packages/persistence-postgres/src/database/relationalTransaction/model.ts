import { Data } from "effect";
import type { Effect, Option } from "effect";
import type {
  RelationalTableIdentity,
} from "flarex-protocol/internal/relational-schema";

export class RelationalTransactionError extends Data.TaggedError(
  "RelationalTransactionError",
)<{
  readonly reason:
    | "invalidAuthority"
    | "invalidReceiptAuthority"
    | "incompleteReceiptSet"
    | "receiptAdmissionClosed"
    | "closed"
    | "rollbackOnly"
    | "overlappingOperation"
    | "unsupportedProfile"
    | "invalidInput"
    | "limitExceeded"
    | "unadmittedFinalization"
    | "statementFailure"
    | "deadlineExceeded";
  readonly cause?: unknown;
}> {}
export class RelationalSessionError extends Data.TaggedError(
  "RelationalSessionError",
)<{
  readonly reason: "resourceFailure" | "cleanupFailure" | "decisionUncertain";
  readonly cause: unknown;
}> {}
export const relationalError = (
  reason: RelationalTransactionError["reason"],
  cause?: unknown,
) =>
  new RelationalTransactionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });

declare const transactionBrand: unique symbol;
declare const tableBrand: unique symbol;
export interface RelationalTransaction {
  readonly [transactionBrand]: true;
}
export interface RelationalTable {
  readonly [tableBrand]: true;
}
export type ScalarRow = Readonly<Record<string, string | number | null>>;
export interface ScalarPage {
  readonly rows: readonly ScalarRow[];
  readonly next: Option.Option<string>;
}
export interface ScalarListInput {
  readonly limit: number;
  readonly after?: string;
  readonly equal?: Readonly<{ column: string; value: string | number | null }>;
}
export interface RelationalStore {
  readonly table: (
    transaction: RelationalTransaction,
    identity: RelationalTableIdentity,
  ) => Effect.Effect<RelationalTable, RelationalTransactionError>;
  readonly get: (
    transaction: RelationalTransaction,
    table: RelationalTable,
    key: string,
  ) => Effect.Effect<Option.Option<ScalarRow>, RelationalTransactionError>;
  readonly list: (
    transaction: RelationalTransaction,
    table: RelationalTable,
    input: ScalarListInput,
  ) => Effect.Effect<ScalarPage, RelationalTransactionError>;
  readonly insert: (
    transaction: RelationalTransaction,
    table: RelationalTable,
    row: ScalarRow,
  ) => Effect.Effect<ScalarRow, RelationalTransactionError>;
  readonly update: (
    transaction: RelationalTransaction,
    table: RelationalTable,
    key: string,
    patch: ScalarRow,
  ) => Effect.Effect<Option.Option<ScalarRow>, RelationalTransactionError>;
  readonly delete: (
    transaction: RelationalTransaction,
    table: RelationalTable,
    key: string,
  ) => Effect.Effect<Option.Option<ScalarRow>, RelationalTransactionError>;
}
export { relationalLimits } from "../../execution/preparation/frameworkExecutionPolicy";
