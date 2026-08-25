import { Effect } from "effect";

import { runDrizzleStatementEffect } from "./drizzleStatementEffect";

export function runApplicationAdmissionQuery<Row, Failure>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<ReadonlyArray<Row>, Failure> {
  return runDrizzleStatementEffect(statement, mapFailure);
}
