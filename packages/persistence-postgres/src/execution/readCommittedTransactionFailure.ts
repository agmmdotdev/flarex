export type LocatedReadCommittedTransactionFailureIssueV1 =
  | Readonly<{
      readonly kind: "infrastructureFailure";
      readonly phase: "acquire" | "beginOrConfigure";
      readonly cause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>
  | Readonly<{
      readonly kind: "callbackRolledBack";
      readonly callbackCause: unknown;
    }>
  | Readonly<{
      readonly kind: "callbackCleanupFailed";
      readonly callbackCause: unknown;
      readonly transactionCause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>
  | Readonly<{
      readonly kind: "decisionUncertain";
      readonly settlementCause: unknown;
      readonly releaseCause?: unknown;
      readonly quarantineCause?: unknown;
    }>;

export class LocatedReadCommittedTransactionFailureV1 extends Error {
  readonly name = "LocatedReadCommittedTransactionFailureV1";

  constructor(readonly issue: LocatedReadCommittedTransactionFailureIssueV1,) {
    super("Located READ COMMITTED transaction settlement failed.", {
      cause: locatedReadCommittedFailureCause(issue)
    },);
  }
}

export function locatedReadCommittedFailureCause(
  issue: LocatedReadCommittedTransactionFailureIssueV1,
): unknown {
  switch (issue.kind) {
    case "infrastructureFailure":
      return issue.cause;
    case "callbackRolledBack":
      return issue.callbackCause;
    case "callbackCleanupFailed":
      return issue.callbackCause;
    case "decisionUncertain":
      return issue.settlementCause;
  }
}
