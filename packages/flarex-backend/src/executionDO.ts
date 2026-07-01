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
  requireMutationExecution,
  requireNoActiveExecutionSession,
} from "./execution/SessionError";
import { HttpError, RequestJsonError, requestJsonErrorToHttpError } from "./http";
import {
  deleteDocumentEffect,
  getDocumentEffect,
  insertDocumentEffect,
  invokeErrorResponse,
  InvokeArgumentValidationError,
  InvokeActiveDeploymentLoadError,
  InvokeActiveFunctionMetadataNotFoundError,
  invokeActiveDeploymentLoadErrorToHttpError,
  InvokeDocumentIdParseError,
  InvokeDocumentIdTableMismatchError,
  InvokeDocumentNotFoundError,
  InvokeDocumentPlacementError,
  InvokeDocumentTableNotFoundError,
  InvokeDocumentValidationError,
  InvokeQueryPlanningError,
  InvokeRequestKindMismatchError,
  InvokeUnsupportedFunctionKindError,
  invokeValidationErrorToHttpError,
  InvokePartitionValidationError,
  InvokeReturnValidationError,
  InvokeTableNotFoundError,
  isInvokableKind,
  type InvokeTransactionOperation,
  loadActiveFunctionMetadataEffect,
  patchDocumentEffect,
  queryDocumentsEffect,
  replaceDocumentEffect,
  resolveFunctionExecutionScopeEffect,
  tableForNameEffect,
  validateInvokeArgumentsEffect,
  validateReturnEffect,
} from "./invoke";
import { SingleShardTransaction, type TransactionOperationError } from "./transaction";
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

      const active = yield* loadActiveFunctionMetadataEffect(
        self.env,
        request.deploymentId,
        request.path,
      );
      const schema = active.deployment.analysis.schema;
      const metadata = active.metadata;
      if (!isInvokableKind(metadata.kind)) {
        return yield* Effect.fail(new InvokeUnsupportedFunctionKindError({
          path: request.path,
          kind: metadata.kind,
        }));
      }
      if (request.kind !== undefined && request.kind !== metadata.kind) {
        return yield* Effect.fail(new InvokeRequestKindMismatchError({
          requestKind: request.kind,
          functionKind: metadata.kind,
        }));
      }
      yield* validateInvokeArgumentsEffect(metadata.args, request.args, schema);
      const scope = yield* resolveFunctionExecutionScopeEffect(
        metadata.partition,
        metadata.route,
        request,
        schema,
      );

      yield* routeExecutionOperation("start", () => SingleShardTransaction.ensureSchemaEffect(
        self.env,
        request.deploymentId,
        scope.partitionKey,
        schema,
      ));
      const createRootOptions = scope.kind === "partitionCreateRoot"
        ? {
            createRoot: {
              rootTableId: (yield* tableForNameEffect(schema, scope.table)).tableId,
              preallocatedRootId: scope.preallocatedRootId,
            },
          }
        : {};
      const tx = yield* routeExecutionOperation("start", () => SingleShardTransaction.beginEffect(
        self.env,
        request.deploymentId,
        scope.partitionKey,
        createRootOptions,
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
      const runSyscallTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
        routeExecutionOperation("syscall", () => executionTransactionOperationResult(operation));
      if (request.op === "get") {
        return yield* getDocumentEffect(
          session.tx,
          session.schema,
          request.id,
          runSyscallTransaction,
        );
      }
      if (request.op === "query") {
        return yield* queryDocumentsEffect(
          session.tx,
          session.schema,
          request.request,
          runSyscallTransaction,
        );
      }

      yield* requireMutationExecution("syscall", session.kind, request.op);
      if (request.op === "insert") {
        return yield* insertDocumentEffect(
          session.tx,
          session.schema,
          request.table,
          request.value,
          request.id,
          runSyscallTransaction,
        );
      }
      if (request.op === "patch") {
        yield* patchDocumentEffect(
          session.tx,
          session.schema,
          request.id,
          request.value,
          runSyscallTransaction,
        );
        return null;
      }
      if (request.op === "replace") {
        yield* replaceDocumentEffect(
          session.tx,
          session.schema,
          request.id,
          request.value,
          runSyscallTransaction,
        );
        return null;
      }
      if (request.op === "delete") {
        yield* deleteDocumentEffect(
          session.tx,
          session.schema,
          request.id,
          runSyscallTransaction,
        );
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
      return yield* Effect.gen(function* () {
        yield* validateReturnEffect(session.metadata.returns, request.value, session.schema);

        if (session.kind === "query") {
          return {
            value: request.value,
            readSet: session.tx.currentReadSet(),
            readTs: session.tx.beginTs,
          };
        }

        const commit = yield* routeExecutionOperation("finish", () =>
          session.tx.commitEffect({
            source: `invoke:${session.path}`,
            ...(session.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: session.idempotencyKey }),
          })
        );
        return {
          value: request.value,
          committedTs: commit.committedTs,
          writes: commit.writes,
        };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            self.session = null;
          }),
        ),
      );
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
  execute: () => Promise<A> | Effect.Effect<A, TransactionOperationError>,
): Effect.Effect<A, ExecutionRouteOperationError> {
  return Effect.try({
    try: execute,
    catch: error => executionRouteOperationError(operation, error),
  }).pipe(
    Effect.flatMap(result => {
      if (Effect.isEffect(result)) {
        return result.pipe(
          Effect.mapError(error => executionRouteOperationError(operation, error)),
        );
      }
      return Effect.tryPromise({
        try: () => result,
        catch: error => executionRouteOperationError(operation, error),
      });
    }),
  );
}

function executionTransactionOperationResult<A>(
  operation: InvokeTransactionOperation<A>,
): Promise<A> | Effect.Effect<A, TransactionOperationError> {
  return Effect.isEffect(operation) ? operation : operation();
}

type ExecutionServiceError =
  | ExecutionSessionError
  | InvokeArgumentValidationError
  | InvokeActiveDeploymentLoadError
  | InvokeActiveFunctionMetadataNotFoundError
  | InvokeDocumentIdParseError
  | InvokeDocumentIdTableMismatchError
  | InvokeDocumentNotFoundError
  | InvokeDocumentPlacementError
  | InvokeDocumentTableNotFoundError
  | InvokeDocumentValidationError
  | InvokePartitionValidationError
  | InvokeQueryPlanningError
  | InvokeRequestKindMismatchError
  | InvokeTableNotFoundError
  | InvokeUnsupportedFunctionKindError
  | InvokeReturnValidationError
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
        InvokeArgumentValidationError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeActiveDeploymentLoadError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeActiveFunctionMetadataNotFoundError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentIdParseError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentIdTableMismatchError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentNotFoundError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentPlacementError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentTableNotFoundError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeDocumentValidationError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokePartitionValidationError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeQueryPlanningError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeRequestKindMismatchError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeTableNotFoundError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeUnsupportedFunctionKindError: error =>
          Effect.succeed(executionInternalRouteErrorToResponse(error)),
        InvokeReturnValidationError: error =>
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
  if (error instanceof InvokeUnsupportedFunctionKindError) {
    return invokeErrorResponse(
      new HttpError(400, `${error.kind} execution is not implemented by execution sessions.`),
    );
  }
  if (error instanceof InvokeArgumentValidationError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeActiveDeploymentLoadError) {
    return invokeErrorResponse(invokeActiveDeploymentLoadErrorToHttpError(error));
  }
  if (error instanceof InvokeActiveFunctionMetadataNotFoundError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentIdParseError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentIdTableMismatchError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentNotFoundError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentPlacementError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentTableNotFoundError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeDocumentValidationError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokePartitionValidationError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeQueryPlanningError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeRequestKindMismatchError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeTableNotFoundError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
  }
  if (error instanceof InvokeReturnValidationError) {
    return invokeErrorResponse(invokeValidationErrorToHttpError(error));
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
