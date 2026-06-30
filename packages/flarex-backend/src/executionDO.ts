import { DurableObject } from "cloudflare:workers";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { Effect } from "effect";
import {
  decodeExecutionFinishRouteRequest,
  type ExecutionFinishRouteError,
} from "./execution/FinishRouteBoundary";
import {
  decodeExecutionStartRouteRequest,
  type ExecutionStartRouteError,
} from "./execution/StartRouteBoundary";
import {
  decodeExecutionSyscallRouteRequest,
  type ExecutionSyscallRouteError,
} from "./execution/SyscallRouteBoundary";
import {
  ExecutionRouteOperationError,
  executionRouteOperationError,
  executionRouteOperationErrorToAdapterError,
  type ExecutionRouteOperation,
} from "./execution/RouteOperationError";
import {
  ExecutionSessionError,
  executionSessionError,
  executionSessionErrorToHttpError,
  requireActiveExecutionSession,
  requireExecutionKindMatch,
  requireMutationExecution,
  requireNoActiveExecutionSession,
} from "./execution/SessionError";
import { HttpError, RequestJsonError, requestJsonErrorToHttpError } from "./http";
import {
  idValidatorForSchema,
  invokeErrorResponse,
  isInvokableKind,
  loadActiveFunctionMetadata,
  readerFor,
  resolveFunctionExecutionScope,
  tableForName,
  validateReturn,
  writerFor,
} from "./invoke";
import { SingleShardTransaction } from "./transaction";
import type {
  BackendFunctionKind,
  DeploymentFunctionMetadata,
  DeploymentSchema,
  Env,
  ExecutionFinishRequest,
  FunctionExecutionScope,
  ExecutionStartRequest,
  ExecutionStartResponse,
  ExecutionSyscallRequest,
  InvokeResponse,
  Json,
} from "./types";
import { validateJsonValueEffect } from "./validation";

type ExecutionSession = {
  deploymentId: string;
  partitionKey: string;
  path: string;
  kind: BackendFunctionKind;
  idempotencyKey?: string;
  scope: FunctionExecutionScope;
  schema: DeploymentSchema;
  metadata: DeploymentFunctionMetadata;
  tx: SingleShardTransaction;
};

export class ExecutionDO extends DurableObject<Env> {
  private session: ExecutionSession | null = null;

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && isExecutionJsonRoutePath(url.pathname)) {
        return await runExecutionRoute(
          routeExecutionDurableObject(request, url.pathname, {
            start: body => this.start(body),
            syscall: body => this.syscall(body),
            finish: body => this.finish(body),
            abort: () => Effect.sync(() => {
              this.session = null;
              return { aborted: true as const };
            }),
          }),
        );
      }
      return Response.json({ error: "Execution route not found." }, { status: 404 });
    } catch (error) {
      return invokeErrorResponse(error);
    }
  }

  private start(
    request: ExecutionStartRequest,
  ): Effect.Effect<ExecutionStartResponse, ExecutionServiceError> {
    const self = this;
    return Effect.gen(function* () {
      yield* requireNoActiveExecutionSession("start", self.session);

      const active = yield* routeExecutionOperation("start", () =>
        loadActiveFunctionMetadata(self.env, request.deploymentId, request.path)
      );
      const schema = active.deployment.analysis.schema;
      const metadata = active.metadata;
      if (!isInvokableKind(metadata.kind)) {
        return yield* Effect.fail(executionSessionError(
          "start",
          { _tag: "UnsupportedFunctionKind", functionKind: metadata.kind },
        ));
      }
      yield* requireExecutionKindMatch("start", request.kind, metadata.kind);

      if (metadata.args !== undefined && metadata.args !== null) {
        yield* validateJsonValueEffect(metadata.args, request.args, "$args", {
          validateId: idValidatorForSchema(schema),
        }).pipe(
          Effect.mapError(error =>
            executionSessionError("start", {
              _tag: "ArgumentValidation",
              message: error.message,
            })
          ),
        );
      }
      const scope = yield* Effect.try({
        try: () => resolveFunctionExecutionScope(
          metadata.partition,
          metadata.route,
          request,
          schema,
        ),
        catch: error => executionRouteOperationError("start", error),
      });

      yield* routeExecutionOperation("start", () => SingleShardTransaction.ensureSchema(
        self.env,
        request.deploymentId,
        scope.partitionKey,
        schema,
      ));
      const tx = yield* routeExecutionOperation("start", () => SingleShardTransaction.begin(
        self.env,
        request.deploymentId,
        scope.partitionKey,
        scope.kind === "partitionCreateRoot"
          ? {
              createRoot: {
                rootTableId: tableForName(schema, scope.table).tableId,
                preallocatedRootId: scope.preallocatedRootId,
              },
            }
          : {},
      ));
      self.session = {
        deploymentId: request.deploymentId,
        partitionKey: scope.partitionKey,
        path: request.path,
        kind: metadata.kind,
        ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
        scope,
        schema,
        metadata,
        tx,
      };
      return { beginTs: tx.beginTs, schemaVersion: tx.schemaVersion, kind: metadata.kind };
    });
  }

  private syscall(
    request: ExecutionSyscallRequest,
  ): Effect.Effect<Json, ExecutionServiceError> {
    const self = this;
    return Effect.gen(function* () {
      const session = yield* self.requireSession("syscall");
      const reader = readerFor(session.tx, session.schema);
      if (request.op === "get") {
        return yield* routeExecutionOperation("syscall", () => reader.get(request.id));
      }
      if (request.op === "query") {
        return yield* routeExecutionOperation("syscall", async () => {
          const query = reader.query(request.request.table);
          const ordered =
            request.request.index === undefined
              ? query
              : query.withIndex(request.request.index, () => ({
                  expressions: request.request.range?.expressions ?? [],
                }));
          const orderedQuery =
            request.request.order === undefined ? ordered : ordered.order(request.request.order);
          if (request.request.cursor !== undefined || request.request.limit !== undefined) {
            return orderedQuery.paginate({
              numItems: request.request.limit ?? 100,
              cursor: request.request.cursor ?? null,
            });
          }
          const page = await orderedQuery.collect();
          return {
            page,
            isDone: true,
            continueCursor: String(
              typeof page.at(-1) === "object" && page.at(-1) !== null
                ? (page.at(-1) as { _id?: unknown })._id ?? ""
                : "",
            ),
          };
        });
      }

      yield* requireMutationExecution("syscall", session.kind, request.op);
      const writer = writerFor(session.tx, session.schema);
      if (request.op === "insert") {
        return yield* routeExecutionOperation("syscall", () =>
          writer.insert(request.table, request.value, request.id)
        );
      }
      if (request.op === "patch") {
        yield* routeExecutionOperation("syscall", () => writer.patch(request.id, request.value));
        return null;
      }
      if (request.op === "replace") {
        yield* routeExecutionOperation("syscall", () => writer.replace(request.id, request.value));
        return null;
      }
      if (request.op === "delete") {
        yield* routeExecutionOperation("syscall", () => writer.delete(request.id));
        return null;
      }
      return yield* Effect.fail(executionSessionError(
        "syscall",
        { _tag: "UnsupportedSyscall", syscall: (request as { op: string }).op },
      ));
    });
  }

  private finish(
    request: ExecutionFinishRequest,
  ): Effect.Effect<InvokeResponse, ExecutionServiceError> {
    const self = this;
    return Effect.gen(function* () {
      const session = yield* self.requireSession("finish");
      return yield* routeExecutionOperation("finish", async () => {
        try {
          validateReturn(session.metadata.returns, request.value, session.schema);

          if (session.kind === "query") {
            return {
              value: request.value,
              readSet: session.tx.currentReadSet(),
              readTs: session.tx.beginTs,
            };
          }

          const commit = await session.tx.commit({
            source: `invoke:${session.path}`,
            ...(session.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: session.idempotencyKey }),
          });
          return {
            value: request.value,
            committedTs: commit.committedTs,
            writes: commit.writes,
          };
        } finally {
          self.session = null;
        }
      });
    });
  }

  private requireSession(
    operation: ExecutionRouteOperation,
  ): Effect.Effect<ExecutionSession, ExecutionSessionError> {
    return requireActiveExecutionSession(operation, this.session);
  }
}

interface ExecutionRouteHandlers {
  start(body: ExecutionStartRequest): Effect.Effect<ExecutionStartResponse, ExecutionServiceError>;
  syscall(body: ExecutionSyscallRequest): Effect.Effect<Json, ExecutionServiceError>;
  finish(body: ExecutionFinishRequest): Effect.Effect<InvokeResponse, ExecutionServiceError>;
  abort(): Effect.Effect<{ aborted: true }>;
}

const EXECUTION_JSON_ROUTE_PATHS = [
  "/start",
  "/syscall",
  "/finish",
  "/abort",
] as const;

type ExecutionJsonRoutePath = typeof EXECUTION_JSON_ROUTE_PATHS[number];

function isExecutionJsonRoutePath(pathname: string): pathname is ExecutionJsonRoutePath {
  return (EXECUTION_JSON_ROUTE_PATHS as readonly string[]).includes(pathname);
}

const routeExecutionDurableObject = Effect.fn("ExecutionDO.route")(
  function* (
    request: Request,
    pathname: ExecutionJsonRoutePath,
    handlers: ExecutionRouteHandlers,
  ): Effect.fn.Return<Response, ExecutionInternalRouteError> {
    switch (pathname) {
      case "/start":
        return yield* routeExecutionStart(request, handlers.start);
      case "/syscall":
        return yield* routeExecutionSyscall(request, handlers.syscall);
      case "/finish":
        return yield* routeExecutionFinish(request, handlers.finish);
      case "/abort":
        return yield* routeExecutionJsonResult(handlers.abort);
    }
  },
);

const routeExecutionStart = Effect.fn("ExecutionDO.routeStart")(
  function* (
    request: Request,
    start: (body: ExecutionStartRequest) => Effect.Effect<ExecutionStartResponse, ExecutionServiceError>,
  ) {
    const body = yield* decodeExecutionStartRouteRequest(request);
    return yield* routeExecutionJsonResult(() => start(body));
  },
);

const routeExecutionSyscall = Effect.fn("ExecutionDO.routeSyscall")(
  function* (
    request: Request,
    syscall: (body: ExecutionSyscallRequest) => Effect.Effect<Json, ExecutionServiceError>,
  ) {
    const body = yield* decodeExecutionSyscallRouteRequest(request);
    return yield* routeExecutionJsonResult(() => syscall(body));
  },
);

const routeExecutionFinish = Effect.fn("ExecutionDO.routeFinish")(
  function* (
    request: Request,
    finish: (body: ExecutionFinishRequest) => Effect.Effect<InvokeResponse, ExecutionServiceError>,
  ) {
    const body = yield* decodeExecutionFinishRouteRequest(request);
    return yield* routeExecutionJsonResult(() => finish(body));
  },
);

function routeExecutionJsonResult<A extends Json | object>(
  execute: () => Effect.Effect<A, ExecutionServiceError>,
): Effect.Effect<Response, ExecutionServiceError> {
  return execute().pipe(
    Effect.map(result => Response.json(result)),
  );
}

function routeExecutionOperation<A>(
  operation: ExecutionRouteOperation,
  execute: () => Promise<A>,
): Effect.Effect<A, ExecutionRouteOperationError> {
  return Effect.tryPromise({
    try: execute,
    catch: error => executionRouteOperationError(operation, error),
  });
}

type ExecutionServiceError =
  | ExecutionSessionError
  | ExecutionRouteOperationError;

type ExecutionInternalRouteError =
  | ExecutionStartRouteError
  | ExecutionSyscallRouteError
  | ExecutionFinishRouteError
  | ExecutionServiceError;

function runExecutionRoute(
  effect: Effect.Effect<Response, ExecutionInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        RequestJsonError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        ExecutionProtocolValidationError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        ExecutionSessionError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        ExecutionRouteOperationError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
      }),
    ),
  );
}

type ExecutionRouteDecodeError =
  | ExecutionStartRouteError
  | ExecutionSyscallRouteError
  | ExecutionFinishRouteError;

function executionInternalRouteErrorToResponse(
  error: ExecutionInternalRouteError,
): Response {
  if (error instanceof ExecutionRouteOperationError) {
    return invokeErrorResponse(executionRouteOperationErrorToAdapterError(error));
  }
  if (error instanceof ExecutionSessionError) {
    return invokeErrorResponse(executionSessionErrorToHttpError(error));
  }
  return invokeErrorResponse(executionRouteDecodeErrorToHttpError(error));
}

function executionRouteDecodeErrorToHttpError(
  error: ExecutionRouteDecodeError,
): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  if (error instanceof ExecutionProtocolValidationError) {
    return new HttpError(400, error.message);
  }
  return new HttpError(500, "Unexpected execution route error.");
}
