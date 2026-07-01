import { Data } from "effect";

export type ElysiaSet = { status?: number | string };

export type BadRequestBody = {
  error: "bad_request";
  message: string;
};

export type ExecutorErrorResponse = {
  status: number;
  body: object;
};

export class ExecutorHttpJsonBodyError extends Data.TaggedError("ExecutorHttpJsonBodyError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class ExecutorHttpBodyValidationError extends Data.TaggedError(
  "ExecutorHttpBodyValidationError",
)<{
  readonly body: BadRequestBody;
}> {}

export class ExecutorHttpOperationError extends Data.TaggedError("ExecutorHttpOperationError")<{
  readonly response: ExecutorErrorResponse;
  readonly cause: unknown;
}> {}

export class ExecutorHttpUnauthorizedError extends Data.TaggedError(
  "ExecutorHttpUnauthorizedError",
)<{
  readonly body: {
    readonly error: "unauthorized";
    readonly message: string;
  };
}> {}

export class ExecutorHttpRoutePreconditionError extends Data.TaggedError(
  "ExecutorHttpRoutePreconditionError",
)<{
  readonly response: ExecutorErrorResponse;
}> {}

export type ExecutorHttpRouteError =
  | ExecutorHttpUnauthorizedError
  | ExecutorHttpRoutePreconditionError
  | ExecutorHttpJsonBodyError
  | ExecutorHttpBodyValidationError
  | ExecutorHttpOperationError;
