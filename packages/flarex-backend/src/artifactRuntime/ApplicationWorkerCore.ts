import {
  ApplicationFunctionRuntimeBoundaryV1Error,
  executeApplicationFunctionActionRuntimeV1,
  executeApplicationFunctionTransactionRuntimeV1,
  inspectApplicationFunctionRuntimeFailureV1,
  type ApplicationFunctionRuntimeFunctionV1,
  type ApplicationFunctionRuntimeInvocationV1,
  type ApplicationFunctionRuntimeInvocationFactoryV1,
  type ApplicationFunctionRuntimeRunMutationV1,
  type ApplicationFunctionRuntimeRunQueryV1,
  type ApplicationFunctionRuntimeTableV1,
} from "@flarex/function-runtime/internal/application-function-runtime-v1";
import {
  createFunctionRuntimeAuthV1,
  createFunctionRuntimeIndexedPointDatabaseWriterV1,
  createFunctionRuntimePointReaderV1,
  createFunctionRuntimeRunQueryContextV1,
  createMutationFunctionRuntimeContextV1,
} from "@flarex/function-runtime/internal/function-api-core-v1";
import { Effect, Result } from "effect";
import { decodeAppDocumentIdentityV1Result } from
  "flarex-protocol/app-document-id";
import { MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 } from
  "flarex-protocol/commit-protocol";
import {
  APPLICATION_WORKER_RESULT_FORMAT_V1,
  APPLICATION_WORKER_RESULT_VERSION_V1,
  MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
  ApplicationWorkerProtocolV1Error,
  decodeApplicationActionWorkerRequestV1Effect,
  decodeApplicationTransactionWorkerRequestV1Effect,
  type ApplicationActionWorkerRequestV1,
  type ApplicationTransactionWorkerRequestV1,
  type ApplicationWorkerResultV1,
  type ApplicationWorkerSuccessResultV1,
} from "flarex-protocol/internal/application-worker-v1";
import type { EdgeActionHostPolicyFrameV1 } from
  "flarex-protocol/internal/edge-action-host-policy-v1";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import { FlarexError } from "flarex/values";

export * from "flarex/server";
export * from "flarex/values";

const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_FROM = Array.from;
const ARRAY = Array;
const ARRAY_BUFFER = ArrayBuffer;
const BIGINT = BigInt;
const DATE = Date;
const ERROR = Error;
const FUNCTION = Function;
const JSON_OBJECT = JSON;
const MAP = Map;
const MATH = Math;
const MATH_IMUL = Math.imul;
const MATH_MIN = Math.min;
const NUMBER = Number;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT = Object;
const OBJECT_ASSIGN = Object.assign;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const OBJECT_SET_PROTOTYPE_OF = Object.setPrototypeOf;
const PROMISE = Promise;
const PROMISE_ALL = Promise.all;
const PROMISE_ALL_SETTLED = Promise.allSettled;
const PROMISE_REJECT = Promise.reject;
const PROMISE_RESOLVE = Promise.resolve;
const REFLECT = Reflect;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_CONSTRUCT = Reflect.construct;
const REFLECT_GET = Reflect.get;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const REGEXP = RegExp;
const SET = Set;
const STRING = String;
const SYMBOL_DISPOSE: typeof Symbol.dispose = Symbol.dispose;
const TEXT_ENCODER = TextEncoder;
const UINT8_ARRAY = Uint8Array;
const TYPED_ARRAY: object = Object.getPrototypeOf(UINT8_ARRAY);
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  UINT8_ARRAY.prototype,
);
const WEAK_MAP = WeakMap;
const WEAK_SET = WeakSet;
const ARRAY_ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  [][Symbol.iterator](),
);
const SET_ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  new Set()[Symbol.iterator](),
);
const MAP_ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  new Map()[Symbol.iterator](),
);
const STRING_ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  ""[Symbol.iterator](),
);
const ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  ARRAY_ITERATOR_PROTOTYPE,
);
const NATIVE_ABORT_SIGNAL = globalThis.AbortSignal;
const NATIVE_FETCH = globalThis.fetch;
const NATIVE_INTL = globalThis.Intl;
const NATIVE_PERFORMANCE = globalThis.performance;
const NATIVE_SCHEDULER = globalThis.scheduler;
const NATIVE_WEB_ASSEMBLY = globalThis.WebAssembly;
const NAMED_ERRORS = new WeakSet<object>();
const MAXIMUM_INDEX_PAGE_SEMANTIC_BYTES = 8 * 1_048_576;
const APPLICATION_DOCUMENT_VALIDATION_ERROR_NAME:
  typeof import("flarex-protocol/internal/application-revision-syscall-validation-v1")
    .APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1 =
      "ApplicationRevisionSyscallDocumentValidationV1Error";
const APPLICATION_DOCUMENT_VALIDATION_ERROR_MESSAGE:
  typeof import("flarex-protocol/internal/application-revision-syscall-validation-v1")
    .APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 =
      "The resulting document failed the active schema validator.";

const INTERNAL_CALL_BUDGET = OBJECT_FREEZE({
  maximumCalls: 64,
  maximumDepth: 8,
  maximumArgumentBytes: 8 * 1_048_576,
  maximumResultBytes: 8 * 1_048_576,
  maximumRootResultBytes: MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
});

let runAdmitted = false;
let deterministicTime = 0;
let deterministicRandom = () => 0.5;
let importGuardActive = false;
let importForbiddenAttempted = false;

export interface ApplicationWorkerDefinitionV1 {
  readonly target: ApplicationTransactionWorkerRequestV1["target"];
  readonly rootFunction: ApplicationFunctionRuntimeFunctionV1;
  readonly internalFunctionCatalog: ReadonlyArray<
    ApplicationFunctionRuntimeFunctionV1
  >;
  readonly hostPolicy: EdgeActionHostPolicyFrameV1;
  readonly hostPolicySha256Hex: string;
}

export interface ApplicationWorkerExecutionInputV1 {
  readonly request: unknown;
  readonly capability: unknown;
  readonly definition: ApplicationWorkerDefinitionV1;
  readonly loadExecution: () => Promise<unknown>;
}

interface TransactionCapability {
  readonly receiver: object;
  readonly revalidate: () => unknown | PromiseLike<unknown>;
  readonly readPointDocument: (
    tableName: string,
    documentId: string,
  ) => unknown | PromiseLike<unknown>;
  readonly queryIndexRange: (
    tableName: string,
    indexDescriptor: unknown,
    bounds: unknown,
    limit: number,
  ) => unknown | PromiseLike<unknown>;
  readonly insertPointDocument: ((
    tableName: string,
    value: unknown,
  ) => unknown | PromiseLike<unknown>) | undefined;
  readonly patchPointDocument: ((
    documentId: string,
    value: unknown,
  ) => unknown | PromiseLike<unknown>) | undefined;
  readonly replacePointDocument: ((
    documentId: string,
    value: unknown,
  ) => unknown | PromiseLike<unknown>) | undefined;
  readonly deletePointDocument: ((
    documentId: string,
  ) => unknown | PromiseLike<unknown>) | undefined;
}

interface CallbackCapability {
  readonly receiver: object;
  readonly invoke: (request: unknown) => unknown | PromiseLike<unknown>;
}

type BoundaryKind = "read" | "journal";

interface BoundaryState {
  open: boolean;
  readonly pending: Set<Promise<unknown>>;
  failure?: unknown;
}

export async function executeApplicationTransactionWorkerV1(
  input: ApplicationWorkerExecutionInputV1,
): Promise<ApplicationWorkerResultV1> {
  let capability: TransactionCapability | undefined;
  let settledFailure: Error | undefined;
  let capabilityBoundary = "ApplicationWorkerReadBoundaryV1Error";
  try {
    admitSingleRun();
    const request = await decodeTransactionRequest(input.request);
    requireTarget(request.target, input.definition);
    installRuntimeGlobals(
      request.context.executionTime,
      request.context.randomSeed,
      false,
    );
    capabilityBoundary = request.context.mode === "query"
      ? "ApplicationWorkerReadBoundaryV1Error"
      : "ApplicationWorkerJournalBoundaryV1Error";
    capability = transactionCapability(input.capability, request.context.mode);
    try {
      await invokeCapability(capability.revalidate, capability.receiver, []);
    } catch (cause) {
      throw namedError(capabilityBoundary, cause);
    }
    const registry = await loadRegistry(input.loadExecution);
    const state: BoundaryState = { open: true, pending: new SET() };
    const boundaryKind = request.context.mode === "query" ? "read" : "journal";
    const invocations = transactionInvocations(
      request,
      capability,
      state,
      boundaryKind,
    );
    let value: ApplicationWorkerSuccessResultV1["value"];
    try {
      value = await executeApplicationFunctionTransactionRuntimeV1(
        OBJECT_FREEZE({
          executionId: request.context.executionId,
          function: input.definition.rootFunction,
          internalFunctionCatalog: input.definition.internalFunctionCatalog,
          callBudget: INTERNAL_CALL_BUDGET,
          arguments: request.arguments,
          tables: request.tables,
        }),
        registry,
        invocations,
      );
    } catch (cause) {
      const applicationError = projectApplicationError(cause);
      if (applicationError !== undefined) return applicationError;
      throw translateRuntimeFailure(cause);
    }
    return result(value);
  } catch (cause) {
    settledFailure = namedUnlessNamed(
      "ApplicationWorkerInvalidRequestV1Error",
      cause,
    );
    throw settledFailure;
  } finally {
    try {
      disposeReceivedCapability(input.capability);
    } catch (cause) {
      if (settledFailure === undefined) {
        throw namedError(capabilityBoundary, cause);
      }
    }
  }
}

export async function executeApplicationActionWorkerV1(
  input: ApplicationWorkerExecutionInputV1,
): Promise<ApplicationWorkerResultV1> {
  let callback: CallbackCapability | undefined;
  let settledFailure: Error | undefined;
  try {
    admitSingleRun();
    const request = await decodeActionRequest(input.request);
    requireTarget(request.target, input.definition);
    if (
      hex(request.context.hostPolicySha256) !==
        input.definition.hostPolicySha256Hex
    ) throw namedError("ApplicationWorkerInvalidRequestV1Error", request);
    installRuntimeGlobals(
      request.context.executionTime,
      request.context.randomSeed,
      true,
    );
    callback = callbackCapability(input.capability);
    if (
      request.argumentSemanticBytes >
        input.definition.hostPolicy.maximumArgumentBytes
    ) throw namedError("ApplicationWorkerInvalidRequestV1Error", request);
    const registry = await loadRegistry(input.loadExecution);
    let value: ApplicationWorkerSuccessResultV1["value"];
    try {
      value = await executeApplicationFunctionActionRuntimeV1(
        OBJECT_FREEZE({
          function: input.definition.rootFunction,
          arguments: request.arguments,
          auth: request.auth.kind === "anonymous" ? null : request.auth.user,
        }),
        registry,
        OBJECT_FREEZE({
          callbackBridge: OBJECT_FREEZE({
            invoke: (operation: unknown) => invokeCapability(
              callback!.invoke,
              callback!.receiver,
              [operation],
            ),
          }),
          limits: OBJECT_FREEZE({
            maximumSyscalls: input.definition.hostPolicy.maximumSyscalls,
            maximumArgumentBytes:
              input.definition.hostPolicy.maximumArgumentBytes,
            maximumResultBytes: MATH_MIN(
              input.definition.hostPolicy.maximumResultBytes,
              MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1,
            ),
            maximumCallbackArgumentBytes:
              input.definition.hostPolicy.maximumCallbackArgumentBytes,
            maximumCallbackResultBytes:
              input.definition.hostPolicy.maximumCallbackResultBytes,
          }),
          isCoreApplicationError,
        }),
      );
    } catch (cause) {
      const applicationError = projectApplicationError(cause);
      if (applicationError !== undefined) return applicationError;
      throw translateRuntimeFailure(cause);
    }
    return result(value);
  } catch (cause) {
    settledFailure = namedUnlessNamed(
      "ApplicationWorkerInvalidRequestV1Error",
      cause,
    );
    throw settledFailure;
  } finally {
    try {
      disposeReceivedCapability(input.capability);
    } catch (cause) {
      if (settledFailure === undefined) {
        throw namedError("ApplicationWorkerCallbackBoundaryV1Error", cause);
      }
    }
  }
}

function transactionInvocations(
  request: ApplicationTransactionWorkerRequestV1,
  capability: TransactionCapability,
  state: BoundaryState,
  boundaryKind: BoundaryKind,
): ApplicationFunctionRuntimeInvocationFactoryV1 {
  let opened = false;
  return OBJECT_FREEZE({
    open: () => {
      if (opened) throw boundaryError(boundaryKind, new ERROR("Boundary already opened."));
      opened = true;
      const auth = createFunctionRuntimeAuthV1(request.auth);
      const reader = createFunctionRuntimePointReaderV1(
        (documentId: string) => trackBoundaryOperation(
          state,
          boundaryKind,
          () => invokeCapability(
            capability.readPointDocument,
            capability.receiver,
            [tableNameForDocument(request.tables, documentId), documentId],
          ).then(decodePointRead),
        ),
      );
      const indexReader = OBJECT_FREEZE({
        queryIndexRange: (
          tableName: string,
          indexDescriptor: unknown,
          bounds: unknown,
          limit: number,
        ) => trackBoundaryOperation(
          state,
          boundaryKind,
          () => invokeCapability(
            capability.queryIndexRange,
            capability.receiver,
            [tableName, indexDescriptor, bounds, limit],
          ).then(decodeIndexPage),
        ),
      });
      const database = createFunctionRuntimeIndexedPointDatabaseWriterV1(
        reader,
        OBJECT_FREEZE({
          insertPointDocument: (tableName: string, value: unknown) =>
            trackBoundaryOperation(state, boundaryKind, () =>
              invokeRequiredCapability(
                capability.insertPointDocument,
                capability.receiver,
                [tableName, value] as const,
              ).then(decodeDocumentId)),
          patchPointDocument: (documentId: string, value: unknown) =>
            trackBoundaryOperation(state, boundaryKind, () =>
              invokeRequiredCapability(
                capability.patchPointDocument,
                capability.receiver,
                [documentId, value] as const,
              ).then(decodeVoid)),
          replacePointDocument: (documentId: string, value: unknown) =>
            trackBoundaryOperation(state, boundaryKind, () =>
              invokeRequiredCapability(
                capability.replacePointDocument,
                capability.receiver,
                [documentId, value] as const,
              ).then(decodeVoid)),
          deletePointDocument: (documentId: string) =>
            trackBoundaryOperation(state, boundaryKind, () =>
              invokeRequiredCapability(
                capability.deletePointDocument,
                capability.receiver,
                [documentId] as const,
              ).then(decodeVoid)),
        }),
        indexReader,
      );
      const invocation: ApplicationFunctionRuntimeInvocationV1 = OBJECT_FREEZE({
        boundary: OBJECT_FREEZE({
          close: () => { state.open = false; },
          drain: async () => {
            await PROMISE.allSettled(ARRAY_FROM(state.pending));
            if (state.failure !== undefined) throw state.failure;
          },
        }),
        createQueryContext: (runQuery: ApplicationFunctionRuntimeRunQueryV1) =>
          createFunctionRuntimeRunQueryContextV1(auth, database, runQuery),
        createMutationContext: (
          runQuery: ApplicationFunctionRuntimeRunQueryV1,
          runMutation: ApplicationFunctionRuntimeRunMutationV1,
        ) =>
          createMutationFunctionRuntimeContextV1(
            auth,
            database,
            runQuery,
            runMutation,
          ),
        recordCallFrame: () => undefined,
        isApplicationError: isCoreApplicationError,
        isCoreApplicationError,
        recordTerminalFailure: (cause: unknown) => {
          state.failure ??= cause;
        },
      });
      return invocation;
    },
  });
}

function trackBoundaryOperation<Value>(
  state: BoundaryState,
  kind: BoundaryKind,
  operation: () => Promise<Value>,
): Promise<Value> {
  if (!state.open) {
    const failure = boundaryError(kind, new ERROR("Boundary is closed."));
    state.failure ??= failure;
    const rejected = PROMISE.reject(failure);
    void rejected.catch(() => undefined);
    return rejected;
  }
  const pending = PROMISE.resolve().then(operation).catch(cause => {
    if (kind === "journal" && isApplicationDocumentValidationFailure(cause)) {
      throw cause;
    }
    const failure = boundaryError(kind, cause);
    state.failure ??= failure;
    throw failure;
  });
  state.pending.add(pending);
  const cleanup = () => state.pending.delete(pending);
  void pending.then(cleanup, cleanup);
  return pending;
}

function isApplicationDocumentValidationFailure(cause: unknown): boolean {
  try {
    return cause instanceof ERROR &&
      cause.name === APPLICATION_DOCUMENT_VALIDATION_ERROR_NAME &&
      cause.message === APPLICATION_DOCUMENT_VALIDATION_ERROR_MESSAGE;
  } catch {
    return false;
  }
}

async function decodeTransactionRequest(
  input: unknown,
): Promise<ApplicationTransactionWorkerRequestV1> {
  try {
    return await runWorkerProtocolDecoder(
      decodeApplicationTransactionWorkerRequestV1Effect(input),
    );
  } catch (cause) {
    throw cause instanceof ApplicationWorkerProtocolV1Error
      ? namedError("ApplicationWorkerInvalidRequestV1Error", cause)
      : namedError("ApplicationWorkerDefectV1Error", cause);
  }
}

async function decodeActionRequest(
  input: unknown,
): Promise<ApplicationActionWorkerRequestV1> {
  try {
    return await runWorkerProtocolDecoder(
      decodeApplicationActionWorkerRequestV1Effect(input),
    );
  } catch (cause) {
    throw cause instanceof ApplicationWorkerProtocolV1Error
      ? namedError("ApplicationWorkerInvalidRequestV1Error", cause)
      : namedError("ApplicationWorkerDefectV1Error", cause);
  }
}

function runWorkerProtocolDecoder<Value, Failure>(
  decoder: Effect.Effect<Value, Failure>,
): Promise<Value> {
  return Effect.runPromise(decoder);
}

async function loadRegistry(
  loadExecution: () => Promise<unknown>,
): Promise<Readonly<{ readonly resolve: (path: string) => unknown }>> {
  importGuardActive = true;
  importForbiddenAttempted = false;
  let loaded: unknown;
  try {
    loaded = await loadExecution();
    if (importForbiddenAttempted) {
      throw new ERROR("Application import attempted a forbidden capability.");
    }
  } catch (cause) {
    throw namedError("ApplicationWorkerDefinitionV1Error", cause);
  } finally {
    importGuardActive = false;
  }
  if (!runtimeIntrinsicsIntact()) {
    throw namedError(
      "ApplicationWorkerDefinitionV1Error",
      new ERROR("Application module modified runtime intrinsics."),
    );
  }
  const moduleRecord = asRecord(loaded);
  const defaultExport = moduleRecord === undefined
    ? undefined
    : ownDataValue(moduleRecord, "default");
  const registry = defaultExport?.kind === "value"
    ? asRecord(defaultExport.value)
    : undefined;
  if (registry === undefined) {
    throw namedError("ApplicationWorkerDefinitionV1Error", loaded);
  }
  const registryOutput = OBJECT_FREEZE({
    resolve: (path: string): unknown => {
      const separator = path.indexOf(":");
      if (separator <= 0 || separator !== path.lastIndexOf(":")) return undefined;
      const module = ownDataValue(registry, path.slice(0, separator));
      if (module?.kind !== "value") return undefined;
      const moduleFunctions = asRecord(module.value);
      if (moduleFunctions === undefined) return undefined;
      const member = ownDataValue(moduleFunctions, path.slice(separator + 1));
      return member.kind === "value" ? member.value : undefined;
    },
  });
  return registryOutput;
}

function runtimeIntrinsicsIntact(): boolean {
  return ARRAY.isArray === ARRAY_IS_ARRAY && ARRAY.from === ARRAY_FROM &&
    NUMBER.isSafeInteger === NUMBER_IS_SAFE_INTEGER &&
    OBJECT.assign === OBJECT_ASSIGN && OBJECT.create === OBJECT_CREATE &&
    OBJECT.defineProperty === OBJECT_DEFINE_PROPERTY &&
    OBJECT.freeze === OBJECT_FREEZE &&
    OBJECT.getOwnPropertyDescriptor === OBJECT_GET_OWN_PROPERTY_DESCRIPTOR &&
    OBJECT.getPrototypeOf === OBJECT_GET_PROTOTYPE_OF &&
    OBJECT.prototype === OBJECT_PROTOTYPE &&
    PROMISE.all === PROMISE_ALL &&
    PROMISE.allSettled === PROMISE_ALL_SETTLED &&
    PROMISE.reject === PROMISE_REJECT &&
    PROMISE.resolve === PROMISE_RESOLVE &&
    REFLECT.apply === REFLECT_APPLY &&
    REFLECT.construct === REFLECT_CONSTRUCT && REFLECT.get === REFLECT_GET &&
    REFLECT.ownKeys === REFLECT_OWN_KEYS && MATH.imul === MATH_IMUL &&
    MATH.min === MATH_MIN;
}

function transactionCapability(
  input: unknown,
  mode: "query" | "write",
): TransactionCapability {
  const boundary = mode === "query"
    ? "ApplicationWorkerReadBoundaryV1Error"
    : "ApplicationWorkerJournalBoundaryV1Error";
  try {
    const record = asObject(input);
    if (record === undefined) throw namedError(boundary, input);
    const revalidate = method(record, "revalidate");
    const readPointDocument = method(record, "readPointDocument");
    const queryIndexRange = method(record, "queryIndexRange");
    const insertPointDocument = mode === "write"
      ? method(record, "insertPointDocument")
      : undefined;
    const patchPointDocument = mode === "write"
      ? method(record, "patchPointDocument")
      : undefined;
    const replacePointDocument = mode === "write"
      ? method(record, "replacePointDocument")
      : undefined;
    const deletePointDocument = mode === "write"
      ? method(record, "deletePointDocument")
      : undefined;
    if (
      revalidate === undefined || readPointDocument === undefined ||
      queryIndexRange === undefined ||
      (mode === "write" && (
        insertPointDocument === undefined || patchPointDocument === undefined ||
        replacePointDocument === undefined || deletePointDocument === undefined
      ))
    ) throw namedError(boundary, input);
    return OBJECT_FREEZE({
      receiver: record,
      revalidate,
      readPointDocument,
      queryIndexRange,
      insertPointDocument,
      patchPointDocument,
      replacePointDocument,
      deletePointDocument,
    });
  } catch (cause) {
    throw namedUnlessNamed(boundary, cause);
  }
}

function callbackCapability(input: unknown): CallbackCapability {
  try {
    const record = asObject(input);
    const invoke = record === undefined ? undefined : method(record, "invoke");
    if (record === undefined || invoke === undefined) {
      throw namedError("ApplicationWorkerCallbackBoundaryV1Error", input);
    }
    return OBJECT_FREEZE({ receiver: record, invoke });
  } catch (cause) {
    throw namedUnlessNamed("ApplicationWorkerCallbackBoundaryV1Error", cause);
  }
}

function method(
  value: object,
  key: string,
): ((...argumentsValue: ReadonlyArray<unknown>) => unknown) | undefined {
  const candidate = REFLECT_GET(value, key);
  return typeof candidate === "function"
    ? candidate as (...argumentsValue: ReadonlyArray<unknown>) => unknown
    : undefined;
}

function invokeCapability<Arguments extends ReadonlyArray<unknown>>(
  operation: (...argumentsValue: Arguments) => unknown,
  receiver: object,
  argumentsValue: Arguments,
): Promise<unknown> {
  return PROMISE.resolve(REFLECT_APPLY(operation, receiver, argumentsValue));
}

function invokeRequiredCapability<Arguments extends ReadonlyArray<unknown>>(
  operation: ((...argumentsValue: Arguments) => unknown) | undefined,
  receiver: object,
  argumentsValue: Arguments,
): Promise<unknown> {
  return operation === undefined
    ? PROMISE.reject(new ERROR("Required journal operation is unavailable."))
    : invokeCapability(operation, receiver, argumentsValue);
}

function decodePointRead(value: unknown): CanonicalFlarexRuntimeObjectV1 | null {
  const record = asRecord(value);
  if (record === undefined) {
    throw new ERROR("Read capability returned an invalid point result.");
  }
  const kind = ownDataValue(record, "kind");
  if (kind.kind === "value" && kind.value === "missing") return null;
  const document = ownDataValue(record, "document");
  if (
    kind.kind === "value" && kind.value === "present" &&
    document.kind === "value"
  ) {
    const normalized = normalizeFlarexValueV1(document.value, "appDocument");
    if (isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
      return normalized.value;
    }
  }
  throw new ERROR("Read capability returned an invalid point result.");
}

function decodeIndexPage(value: unknown): Readonly<{
  readonly documents: ReadonlyArray<CanonicalFlarexRuntimeObjectV1>;
  readonly isDone: boolean;
}> {
  const record = asRecord(value);
  const documents = record === undefined
    ? { kind: "missing" } as const
    : ownDataValue(record, "documents");
  const isDone = record === undefined
    ? { kind: "missing" } as const
    : ownDataValue(record, "isDone");
  if (
    record === undefined ||
    documents.kind !== "value" || !ARRAY_IS_ARRAY(documents.value) ||
    documents.value.length > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 ||
    isDone.kind !== "value" || typeof isDone.value !== "boolean"
  ) throw new ERROR("Read capability returned an invalid index page.");
  const normalized = normalizeFlarexValueV1(documents.value);
  if (
    normalized.semanticSizeBytes > MAXIMUM_INDEX_PAGE_SEMANTIC_BYTES ||
    !ARRAY_IS_ARRAY(normalized.value) ||
    !normalized.value.every(isCanonicalFlarexRuntimeObjectV1)
  ) throw new ERROR("Read capability returned an invalid index page.");
  return OBJECT_FREEZE({
    documents: OBJECT_FREEZE(normalized.value),
    isDone: isDone.value,
  });
}

function decodeDocumentId(value: unknown): string {
  return decodeAppDocumentIdentityV1Result(value).pipe(
    Result.map(identity => identity.id),
    Result.mapError(() =>
      new ERROR("Journal capability returned an invalid document id.")
    ),
    Result.getOrThrow,
  );
}

function decodeVoid(value: unknown): void {
  if (value !== undefined && value !== null) {
    throw new ERROR("Journal capability returned an invalid void result.");
  }
}

function tableNameForDocument(
  tables: ReadonlyArray<ApplicationFunctionRuntimeTableV1>,
  documentId: string,
): string {
  const separator = documentId.indexOf(":");
  const tableId = NUMBER(documentId.slice(0, separator));
  const table = tables.find(candidate => candidate.tableId === tableId);
  return separator > 0 && table !== undefined ? table.logicalName : "";
}

function requireTarget(
  target: ApplicationTransactionWorkerRequestV1["target"],
  definition: ApplicationWorkerDefinitionV1,
): void {
  if (!plainDataEqual(target, definition.target)) {
    throw namedError("ApplicationWorkerInvalidRequestV1Error", target);
  }
}

function translateRuntimeFailure(cause: unknown): Error {
  const failure = inspectApplicationFunctionRuntimeFailureV1(cause);
  switch (failure?.kind) {
    case "contract":
      return namedError(
        failure.reason === "argumentsInvalid"
          ? "ApplicationWorkerInvalidRequestV1Error"
          : failure.reason === "resourceExceeded"
          ? "ApplicationWorkerUserCodeV1Error"
          : "ApplicationWorkerDefinitionV1Error",
        cause,
      );
    case "boundary":
      return namedError(
        failure.boundary === "read"
          ? "ApplicationWorkerReadBoundaryV1Error"
          : failure.boundary === "journal"
          ? "ApplicationWorkerJournalBoundaryV1Error"
          : "ApplicationWorkerCallbackBoundaryV1Error",
        failure.cause,
      );
    case "terminal":
      return namedError("ApplicationWorkerTerminalV1Error", cause);
    case "applicationError":
    case "userCode":
      return namedError("ApplicationWorkerUserCodeV1Error", failure.cause);
    case undefined:
      return namedError("ApplicationWorkerDefectV1Error", cause);
  }
}

function projectApplicationError(
  cause: unknown,
): ApplicationWorkerResultV1 | undefined {
  const failure = inspectApplicationFunctionRuntimeFailureV1(cause);
  if (failure?.kind !== "applicationError" ||
    failure.reason !== "applicationError" ||
    !isCoreApplicationError(failure.cause)) return undefined;
  const applicationError = failure.cause as FlarexError;
  const normalizedData = applicationError.data === undefined
    ? undefined
    : normalizeFlarexValueV1(applicationError.data);
  if (normalizedData !== undefined &&
    normalizedData.semanticSizeBytes >
      MAX_APPLICATION_WORKER_RESULT_SEMANTIC_BYTES_V1) {
    throw namedError("ApplicationWorkerUserCodeV1Error", cause);
  }
  const data = normalizedData?.value;
  return OBJECT_FREEZE({
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    kind: "applicationError",
    error: OBJECT_FREEZE(data === undefined
      ? {
          code: applicationError.code,
          message: applicationError.message,
        }
      : {
          code: applicationError.code,
          message: applicationError.message,
          data,
        }),
  });
}

function isCoreApplicationError(cause: unknown): boolean {
  return cause instanceof FlarexError;
}

function result(
  value: ApplicationWorkerSuccessResultV1["value"],
): ApplicationWorkerResultV1 {
  return OBJECT_FREEZE({
    format: APPLICATION_WORKER_RESULT_FORMAT_V1,
    version: APPLICATION_WORKER_RESULT_VERSION_V1,
    value,
  });
}

function admitSingleRun(): void {
  if (runAdmitted) {
    throw namedError(
      "ApplicationWorkerInvalidRequestV1Error",
      new ERROR("Application worker admits one invocation."),
    );
  }
  runAdmitted = true;
}

function installRuntimeGlobals(
  time: number,
  seed: Uint8Array,
  allowFetch: boolean,
): void {
  deterministicTime = time;
  deterministicRandom = randomFromSeed(seed);
  function RuntimeDate(...argumentsValue: ReadonlyArray<unknown>): string | Date {
    if (new.target === undefined) return new DATE(deterministicTime).toString();
    return argumentsValue.length === 0
      ? REFLECT_CONSTRUCT(DATE, [deterministicTime], new.target)
      : REFLECT_CONSTRUCT(DATE, argumentsValue, new.target);
  }
  OBJECT_SET_PROTOTYPE_OF(RuntimeDate, DATE);
  const datePrototype = OBJECT_CREATE(DATE.prototype);
  OBJECT_DEFINE_PROPERTY(datePrototype, "constructor", {
    value: RuntimeDate,
    configurable: false,
    writable: false,
  });
  OBJECT_DEFINE_PROPERTY(RuntimeDate, "prototype", {
    value: datePrototype,
  });
  OBJECT_DEFINE_PROPERTY(RuntimeDate, "now", {
    value: () => deterministicTime,
  });
  installExactGlobal("Date", OBJECT_FREEZE(RuntimeDate));

  const exactMath = OBJECT_CREATE(MATH) as Record<PropertyKey, unknown>;
  OBJECT_DEFINE_PROPERTY(exactMath, "random", {
    value: () => deterministicRandom(),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  installExactGlobal("Math", OBJECT_FREEZE(exactMath));

  const exactCrypto = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
  for (const name of ["getRandomValues", "randomUUID"]) {
    OBJECT_DEFINE_PROPERTY(exactCrypto, name, {
      value: unavailable,
      enumerable: true,
    });
  }
  const exactSubtle = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
  for (const name of [
    "decrypt", "deriveBits", "deriveKey", "digest", "encrypt", "exportKey",
    "generateKey", "importKey", "sign", "unwrapKey", "verify", "wrapKey",
  ]) OBJECT_DEFINE_PROPERTY(exactSubtle, name, {
    value: unavailable,
    enumerable: true,
  });
  OBJECT_DEFINE_PROPERTY(exactCrypto, "subtle", {
    value: OBJECT_FREEZE(exactSubtle),
    enumerable: true,
  });
  installExactGlobal("crypto", OBJECT_FREEZE(exactCrypto));

  const exactCaches = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
  const exactDefaultCache = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
  for (const name of ["delete", "match", "put"]) {
    OBJECT_DEFINE_PROPERTY(exactDefaultCache, name, {
      value: unavailable,
      enumerable: true,
    });
  }
  OBJECT_DEFINE_PROPERTY(exactCaches, "default", {
    value: OBJECT_FREEZE(exactDefaultCache),
    enumerable: true,
  });
  OBJECT_DEFINE_PROPERTY(exactCaches, "open", {
    value: unavailable,
    enumerable: true,
  });
  installExactGlobal("caches", OBJECT_FREEZE(exactCaches));

  if (NATIVE_PERFORMANCE !== undefined) {
    installExactGlobal("performance", OBJECT_FREEZE({
      now: () => 0,
      timeOrigin: deterministicTime,
    }));
  }
  for (const name of ["setTimeout", "setInterval", "setImmediate"] as const) {
    if (REFLECT_GET(globalThis, name) !== undefined) {
      installExactGlobal(name, unavailable);
    }
  }
  if (NATIVE_SCHEDULER !== undefined) {
    installExactGlobal("scheduler", OBJECT_FREEZE({
      wait: unavailable,
      yield: unavailable,
      postTask: unavailable,
    }));
  }
  if (
    NATIVE_ABORT_SIGNAL !== undefined &&
    typeof NATIVE_ABORT_SIGNAL.timeout === "function"
  ) OBJECT_DEFINE_PROPERTY(NATIVE_ABORT_SIGNAL, "timeout", {
    value: unavailable,
    configurable: false,
    writable: false,
  });
  for (const name of [
    "MessageChannel",
    "BroadcastChannel",
    "WebSocketPair",
    "File",
  ] as const) {
    if (REFLECT_GET(globalThis, name) !== undefined) {
      installExactGlobal(name, unavailable);
    }
  }
  installExactGlobal("fetch", allowFetch && NATIVE_FETCH !== undefined
    ? (...argumentsValue: Parameters<typeof fetch>) => {
        if (importGuardActive) return unavailable();
        return REFLECT_APPLY(NATIVE_FETCH, globalThis, argumentsValue);
      }
    : unavailable);

  if (NATIVE_WEB_ASSEMBLY !== undefined) {
    const exactWebAssembly = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
    const blocked = new SET<PropertyKey>([
      "compile", "compileStreaming", "instantiate", "instantiateStreaming",
    ]);
    for (const key of REFLECT_OWN_KEYS(NATIVE_WEB_ASSEMBLY)) {
      const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
        NATIVE_WEB_ASSEMBLY,
        key,
      );
      if (descriptor === undefined || !("value" in descriptor)) continue;
      OBJECT_DEFINE_PROPERTY(exactWebAssembly, key, {
        value: blocked.has(key) ? unavailable : descriptor.value,
        enumerable: descriptor.enumerable ?? false,
      });
    }
    installExactGlobal("WebAssembly", OBJECT_FREEZE(exactWebAssembly));
  }
  if (NATIVE_INTL !== undefined) {
    const exactIntl = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
    for (const key of REFLECT_OWN_KEYS(NATIVE_INTL)) {
      const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(NATIVE_INTL, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      OBJECT_DEFINE_PROPERTY(exactIntl, key, {
        value: key === "DateTimeFormat" ? unavailable : descriptor.value,
        enumerable: descriptor.enumerable ?? false,
      });
    }
    installExactGlobal("Intl", OBJECT_FREEZE(exactIntl));
  }

  hardenIntrinsic("Object", OBJECT);
  hardenIntrinsic("Function", FUNCTION);
  hardenIntrinsic("Array", ARRAY);
  hardenIntrinsic("ArrayBuffer", ARRAY_BUFFER);
  hardenIntrinsic("BigInt", BIGINT);
  hardenIntrinsic("Error", ERROR);
  hardenIntrinsic("Map", MAP);
  hardenIntrinsic("Number", NUMBER);
  hardenIntrinsic("Promise", PROMISE);
  hardenIntrinsic("Reflect", REFLECT);
  hardenIntrinsic("RegExp", REGEXP);
  hardenIntrinsic("Set", SET);
  hardenIntrinsic("String", STRING);
  hardenIntrinsic("TextEncoder", TEXT_ENCODER);
  OBJECT_FREEZE(TYPED_ARRAY_PROTOTYPE);
  OBJECT_FREEZE(TYPED_ARRAY);
  hardenIntrinsic("Uint8Array", UINT8_ARRAY);
  hardenIntrinsic("WeakMap", WEAK_MAP);
  hardenIntrinsic("WeakSet", WEAK_SET);
  for (const prototype of [
    ITERATOR_PROTOTYPE,
    ARRAY_ITERATOR_PROTOTYPE,
    SET_ITERATOR_PROTOTYPE,
    MAP_ITERATOR_PROTOTYPE,
    STRING_ITERATOR_PROTOTYPE,
  ]) OBJECT_FREEZE(prototype);
  OBJECT_FREEZE(FlarexError.prototype);
  OBJECT_FREEZE(FlarexError);
  OBJECT_FREEZE(DATE.prototype);
  OBJECT_FREEZE(DATE);
  hardenIntrinsic("Date", RuntimeDate);
  if (NATIVE_ABORT_SIGNAL !== undefined) {
    hardenIntrinsic("AbortSignal", NATIVE_ABORT_SIGNAL);
  }
  OBJECT_FREEZE(JSON_OBJECT);
  OBJECT_FREEZE(MATH);
}

function installExactGlobal(name: string, value: unknown): void {
  OBJECT_DEFINE_PROPERTY(globalThis, name, {
    value,
    configurable: false,
    writable: false,
  });
}

function hardenIntrinsic(name: string, value: object): void {
  const prototype = REFLECT_GET(value, "prototype");
  if ((typeof prototype === "object" && prototype !== null) ||
      typeof prototype === "function") OBJECT_FREEZE(prototype);
  OBJECT_FREEZE(value);
  installExactGlobal(name, value);
}

function randomFromSeed(seed: Uint8Array): () => number {
  let state = 0x9e3779b9;
  for (const byte of seed) state = MATH_IMUL(state ^ byte, 0x85ebca6b) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function unavailable(): never {
  if (importGuardActive) importForbiddenAttempted = true;
  throw new ERROR("Capability is unavailable in Application worker runtime.");
}

function boundaryError(kind: BoundaryKind, cause: unknown): Error {
  return new ApplicationFunctionRuntimeBoundaryV1Error(kind, cause);
}

function asRecord(
  value: unknown,
): Readonly<Record<PropertyKey, unknown>> | undefined {
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    return undefined;
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  return prototype === OBJECT_PROTOTYPE || prototype === null
    ? value as Readonly<Record<PropertyKey, unknown>>
    : undefined;
}

function asObject(value: unknown): object | undefined {
  return (typeof value === "object" && value !== null) ||
      typeof value === "function"
    ? value as object
    : undefined;
}

type OwnDataValue = Readonly<{ readonly kind: "missing" }> |
  Readonly<{ readonly kind: "value"; readonly value: unknown }>;

function ownDataValue(value: object, key: string): OwnDataValue {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? { kind: "value", value: descriptor.value }
    : { kind: "missing" };
}

function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    left === null || right === null || typeof left !== "object" ||
    typeof right !== "object" || ARRAY_IS_ARRAY(left) !== ARRAY_IS_ARRAY(right)
  ) return false;
  if (ARRAY_IS_ARRAY(left) && ARRAY_IS_ARRAY(right)) {
    return left.length === right.length &&
      left.every((value, index) => plainDataEqual(value, right[index]));
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord === undefined || rightRecord === undefined) return false;
  const leftKeys = REFLECT_OWN_KEYS(leftRecord);
  const rightKeys = REFLECT_OWN_KEYS(rightRecord);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some(key => typeof key !== "string") ||
    rightKeys.some(key => typeof key !== "string")
  ) return false;
  const rightSet = new SET(rightKeys);
  return leftKeys.every(key => {
    if (typeof key !== "string" || !rightSet.has(key)) return false;
    const leftValue = ownDataValue(leftRecord, key);
    const rightValue = ownDataValue(rightRecord, key);
    return leftValue.kind === "value" && rightValue.kind === "value" &&
      plainDataEqual(leftValue.value, rightValue.value);
  });
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

function namedUnlessNamed(fallback: string, cause: unknown): Error {
  return isNamedError(cause)
    ? cause
    : namedError(fallback, cause);
}

function isNamedError(value: unknown): value is Error {
  const object = asObject(value);
  return object !== undefined && NAMED_ERRORS.has(object);
}

function namedError(name: string, cause: unknown): Error {
  const error = new ERROR(name);
  OBJECT_DEFINE_PROPERTY(error, "name", { value: name });
  OBJECT_DEFINE_PROPERTY(error, "cause", { value: cause });
  NAMED_ERRORS.add(error);
  return error;
}

function disposeReceivedCapability(value: unknown): void {
  const object = asObject(value);
  if (object === undefined) return;
  const dispose = REFLECT_GET(object, SYMBOL_DISPOSE);
  if (typeof dispose === "function") REFLECT_APPLY(dispose, object, []);
}
