import { Effect } from "effect";

export function runApplicationAdmissionQuery<Row, Failure>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<ReadonlyArray<Row>, Failure> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: mapFailure,
  });
}
