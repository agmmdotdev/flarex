import { Data, Result, Schema, type Cause } from "effect";

export class CoreError extends Data.TaggedError("CoreError")<{
  readonly reason: "denied" | "expired" | "conflict" | "unique" | "identity" | "busy" |
    "closed" | "limit" | "unsupported" | "invalid" | "storage" | "uncertain";
  readonly cause?: unknown;
  readonly phase?: string;
}> {}

export class NativeFailure extends Data.TaggedError("NativeFailure")<{
  readonly cause: unknown;
}> {}
export class NativeOperationFailure extends Data.TaggedError("NativeOperationFailure")<{
  readonly cause: Cause.Cause<CoreError>;
}> {}
export class DocumentValidationFailure extends Data.TaggedError("DocumentValidationFailure")<{ readonly cause: unknown }> {}
export class ApplicationFailure extends Data.TaggedError("ApplicationFailure")<{ readonly cause: unknown }> {}
export class ApplicationOperationFailure extends Data.TaggedError("ApplicationOperationFailure")<{
  readonly cause: Cause.Cause<CoreError | DocumentValidationFailure | ApplicationFailure>;
}> {}

const DatabaseError = Schema.Struct({ code: Schema.String, constraint: Schema.optionalKey(Schema.String) });
const ForeignDatabaseError = Schema.Union([DatabaseError, Schema.Struct({ cause: DatabaseError })]);

/** Only the foreign database rejection boundary classifies SQLSTATE. */
export function databaseFailure(cause: unknown): CoreError {
  return Schema.decodeUnknownResult(ForeignDatabaseError)(cause).pipe(Result.match({
    onFailure: () => new CoreError({ reason: "storage", cause }),
    onSuccess: foreign => {
      const error = "code" in foreign ? foreign : foreign.cause;
      const reason = error.code === "23505" && error.constraint === "unique_claim" ? "unique" :
        error.code === "40001" || error.code === "40P01" ? "conflict" : "storage";
      return new CoreError({ reason, cause });
    },
  }));
}
