import { DurableObject } from "cloudflare:workers";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
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
import { HttpError, RequestJsonError, requestJsonErrorToHttpError } from "./http";
import { Effect } from "effect";
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
import { BackendValidationError, validateJsonValue } from "./validation";

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
      if (url.pathname === "/start" && request.method === "POST") {
        return await runExecutionRoute(
          routeExecutionStart(request, body => this.start(body)),
        );
      }
      if (url.pathname === "/syscall" && request.method === "POST") {
        return await runExecutionRoute(
          routeExecutionSyscall(request, body => this.syscall(body)),
        );
      }
      if (url.pathname === "/finish" && request.method === "POST") {
        return await runExecutionRoute(
          routeExecutionFinish(request, body => this.finish(body)),
        );
      }
      if (url.pathname === "/abort" && request.method === "POST") {
        this.session = null;
        return Response.json({ aborted: true });
      }
      return Response.json({ error: "Execution route not found." }, { status: 404 });
    } catch (error) {
      return invokeErrorResponse(error);
    }
  }

  private async start(request: ExecutionStartRequest): Promise<ExecutionStartResponse> {
    if (this.session !== null) {
      throw new HttpError(409, "Execution session is already active.");
    }

    const active = await loadActiveFunctionMetadata(this.env, request.deploymentId, request.path);
    const schema = active.deployment.analysis.schema;
    const metadata = active.metadata;
    if (!isInvokableKind(metadata.kind)) {
      throw new HttpError(400, `${metadata.kind} execution is not implemented by execution sessions.`);
    }
    if (request.kind !== undefined && request.kind !== metadata.kind) {
      throw new HttpError(
        400,
        `Function kind mismatch. Request has ${request.kind}, function is ${metadata.kind}.`,
      );
    }

    try {
      if (metadata.args !== undefined && metadata.args !== null) {
        validateJsonValue(metadata.args, request.args, "$args", {
          validateId: idValidatorForSchema(schema),
        });
      }
    } catch (error) {
      if (error instanceof BackendValidationError) {
        throw new HttpError(400, `ArgumentValidationError: ${error.message}`);
      }
      throw error;
    }
    const scope = resolveFunctionExecutionScope(metadata.partition, metadata.route, request, schema);

    await SingleShardTransaction.ensureSchema(
      this.env,
      request.deploymentId,
      scope.partitionKey,
      schema,
    );
    const tx = await SingleShardTransaction.begin(
      this.env,
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
    );
    this.session = {
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
  }

  private async syscall(request: ExecutionSyscallRequest): Promise<Json> {
    const session = this.requireSession();
    const reader = readerFor(session.tx, session.schema);
    if (request.op === "get") return reader.get(request.id);
    if (request.op === "query") {
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
    }

    if (session.kind !== "mutation") {
      throw new HttpError(400, `Cannot run ${request.op} during ${session.kind} execution.`);
    }
    const writer = writerFor(session.tx, session.schema);
    if (request.op === "insert") return writer.insert(request.table, request.value, request.id);
    if (request.op === "patch") {
      await writer.patch(request.id, request.value);
      return null;
    }
    if (request.op === "replace") {
      await writer.replace(request.id, request.value);
      return null;
    }
    if (request.op === "delete") {
      await writer.delete(request.id);
      return null;
    }
    throw new HttpError(400, `Unsupported execution syscall: ${(request as { op: string }).op}.`);
  }

  private async finish(request: ExecutionFinishRequest): Promise<InvokeResponse> {
    const session = this.requireSession();
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
        ...(session.idempotencyKey === undefined ? {} : { idempotencyKey: session.idempotencyKey }),
      });
      return {
        value: request.value,
        committedTs: commit.committedTs,
        writes: commit.writes,
      };
    } finally {
      this.session = null;
    }
  }

  private requireSession(): ExecutionSession {
    if (this.session === null) throw new HttpError(409, "Execution session has not started.");
    return this.session;
  }
}

const routeExecutionStart = Effect.fn("ExecutionDO.routeStart")(
  function* (
    request: Request,
    start: (body: ExecutionStartRequest) => Promise<ExecutionStartResponse>,
  ) {
    const body = yield* decodeExecutionStartRouteRequest(request);
    return yield* routeExecutionJsonResult("start", () => start(body));
  },
);

const routeExecutionSyscall = Effect.fn("ExecutionDO.routeSyscall")(
  function* (
    request: Request,
    syscall: (body: ExecutionSyscallRequest) => Promise<Json>,
  ) {
    const body = yield* decodeExecutionSyscallRouteRequest(request);
    return yield* routeExecutionJsonResult("syscall", () => syscall(body));
  },
);

const routeExecutionFinish = Effect.fn("ExecutionDO.routeFinish")(
  function* (
    request: Request,
    finish: (body: ExecutionFinishRequest) => Promise<InvokeResponse>,
  ) {
    const body = yield* decodeExecutionFinishRouteRequest(request);
    return yield* routeExecutionJsonResult("finish", () => finish(body));
  },
);

function routeExecutionJsonResult<A extends Json | object>(
  operation: ExecutionRouteOperation,
  execute: () => Promise<A>,
): Effect.Effect<Response, ExecutionRouteOperationError> {
  return Effect.tryPromise({
    try: execute,
    catch: error => executionRouteOperationError(operation, error),
  }).pipe(
    Effect.map(result => Response.json(result)),
  );
}

type ExecutionInternalRouteError =
  | ExecutionStartRouteError
  | ExecutionSyscallRouteError
  | ExecutionFinishRouteError
  | ExecutionRouteOperationError;

function runExecutionRoute(
  effect: Effect.Effect<Response, ExecutionInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(error =>
        Effect.succeed(executionInternalRouteErrorToResponse(error))
      ),
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
