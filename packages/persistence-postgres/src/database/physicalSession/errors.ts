import { Data } from "effect";
import type {
  PhysicalDeadlineFields,
  PhysicalResourceFields,
  PhysicalSessionErrors,
} from "./model";
export class PhysicalSessionResourceIssue extends Data.TaggedError(
  "PhysicalSessionResourceIssue",
)<PhysicalResourceFields> {}
export class PhysicalSessionDeadlineIssue extends Data.TaggedError(
  "PhysicalSessionDeadlineIssue",
)<PhysicalDeadlineFields> {}
export class PhysicalSessionInvariantDefect extends Data.TaggedError(
  "PhysicalSessionInvariantDefect",
)<{ readonly reason: "invalidDeadline" | "invalidDeadlineDuration" }> {}
export class PhysicalSessionCleanupDefect extends Data.TaggedError(
  "PhysicalSessionCleanupDefect",
)<{
  readonly phase: "rollback" | "release" | "quarantine";
  readonly cause: unknown;
}> {}
export const physicalSessionErrors: PhysicalSessionErrors<
  PhysicalSessionResourceIssue,
  PhysicalSessionDeadlineIssue
> = {
  resource: (fields) => new PhysicalSessionResourceIssue(fields),
  deadline: (fields) => new PhysicalSessionDeadlineIssue(fields),
  invariant: (fields) => new PhysicalSessionInvariantDefect(fields),
  cleanup: (fields) => new PhysicalSessionCleanupDefect(fields),
};
