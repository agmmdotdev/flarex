import { WorkerEntrypoint } from "cloudflare:workers";
import {
  createFunctionRuntimeAuthV1,
  createFunctionRuntimePointReaderV1,
  createFunctionRuntimeRunQueryContextV1,
} from "flarex:function-api-core/v1";
import type {
  capturePointQueryInternalCallRuntimeArgumentsV1,
  executePointQueryInternalCallV1,
  inspectPointQueryInternalCallRuntimeFailureV1,
  PointQueryInternalCallFrameV1,
  PointQueryInternalCallRuntimeInputV1,
  PointQueryInternalCallRuntimeInvocationFactoryV1,
  PointQueryInternalCallRuntimeRunQueryV1,
} from "@flarex/function-runtime/point-query-internal-call";
import type { PointQueryInternalCallExactRuntimeResultV1 } from
  "flarex-protocol/point-query-internal-call-exact-runtime";
import type { UserIdentity } from "flarex-protocol/auth";
import { inspectCoreApplicationErrorV1 } from "./_flarex/application-error-platform-v1.js";

import { exactQueryRuntimeConfigurationV1 } from
  "./pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-exact-runtime-config-v1.js";

const REQUEST_FORMAT = exactQueryRuntimeConfigurationV1.requestFormat;
const REQUEST_VERSION = exactQueryRuntimeConfigurationV1.requestVersion;
const RESULT_FORMAT = exactQueryRuntimeConfigurationV1.resultFormat;
const RESULT_VERSION = exactQueryRuntimeConfigurationV1.resultVersion;
const RUNTIME_TARGET_SHA256_HEX =
  exactQueryRuntimeConfigurationV1.runtimeTargetSha256Hex;
const CONFIGURED_ARTIFACT = exactQueryRuntimeConfigurationV1.artifact;
const CONFIGURED_FUNCTION = exactQueryRuntimeConfigurationV1.function;
const CONFIGURED_ROOT_FUNCTION_ORDINAL =
  exactQueryRuntimeConfigurationV1.rootFunctionOrdinal;
const CONFIGURED_INTERNAL_QUERY_CATALOG =
  exactQueryRuntimeConfigurationV1.internalQueryCatalog;
const CONFIGURED_SNAPSHOT_COMMIT_SEQ =
  exactQueryRuntimeConfigurationV1.snapshotCommitSeq;
const MODULE_TIME = exactQueryRuntimeConfigurationV1.moduleEvaluationTime;
const RANDOM_SEED_BYTES = exactQueryRuntimeConfigurationV1.randomSeedBytes;
const nativeStructuredClone = globalThis.structuredClone;
const nativeDate = globalThis.Date;
const nativeMath = globalThis.Math;
const defineProperty = Object.defineProperty;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectConstruct = Reflect.construct;
const freeze = Object.freeze;
const MAX_ARGUMENT_BYTES = 1 << 20;
const MAX_AUTH_BYTES = 1 << 16;
let deterministicTime = MODULE_TIME;
let deterministicRandom = () => 0.5;
let runAdmitted = false;
let activeTerminalFailureRecorder: ((cause: unknown) => void) | undefined;

type UnknownRecord = Readonly<Record<string, unknown>>;
type RuntimeValue = PointQueryInternalCallExactRuntimeResultV1["value"];
type RuntimeObject = Extract<RuntimeValue, Readonly<Record<string, unknown>>>;

interface QueryReadCapability {
  readonly revalidate: () => void | PromiseLike<void>;
  readonly readPointDocument: (
    tableName: string,
    documentId: string,
  ) => unknown | PromiseLike<unknown>;
  readonly [Symbol.dispose]?: () => void;
}

installExactGlobals();
const executionModulePromise = import(
  "./pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-exact-runtime-execution-v1.js"
);
const runtimeKernelModulePath =
  "./pointQueryInternalCallExactRuntimeWorker/flarex-point-query-internal-call-runtime-kernel-v1.js";
const runtimeKernelPromise = import(runtimeKernelModulePath) as Promise<Readonly<{
  readonly capturePointQueryInternalCallRuntimeArgumentsV1:
    typeof capturePointQueryInternalCallRuntimeArgumentsV1;
  readonly executePointQueryInternalCallV1: typeof executePointQueryInternalCallV1;
  readonly inspectPointQueryInternalCallRuntimeFailureV1:
    typeof inspectPointQueryInternalCallRuntimeFailureV1;
}>>;

export class FlarexPointQueryInternalCallExactRuntimeV1 extends WorkerEntrypoint {
  async run(
    input: unknown,
    receivedCapability: unknown,
  ): Promise<PointQueryInternalCallExactRuntimeResultV1> {
    let settledFailure: Readonly<{ readonly cause: unknown }> | undefined;
    let capability: QueryReadCapability | undefined;
    try {
      if (runAdmitted) throw new Error("Exact point-query runtime admits one invocation.");
      runAdmitted = true;
      const kernel = await runtimeKernelPromise;
      let request: ReturnType<typeof decodeRequest>;
      try {
        request = decodeRequest(
          input,
          kernel.capturePointQueryInternalCallRuntimeArgumentsV1,
        );
      } catch (cause) {
        throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", cause);
      }
      capability = decodeReadCapability(receivedCapability);
      await Promise.resolve().then(() => capability!.revalidate()).catch(cause => {
        throw namedError("PointQueryInternalCallExactRuntimeReadBoundaryV1Error", cause);
      });
      deterministicTime = request.context.executionTime;
      deterministicRandom = randomFromSeed(request.context.randomSeed);
      const state: {
        closed: boolean;
        pending: Set<Promise<unknown>>;
        callFrames: Array<PointQueryInternalCallFrameV1>;
        failure?: unknown;
      } = { closed: false, pending: new Set(), callFrames: [] };
      activeTerminalFailureRecorder = cause => { state.failure ??= cause; };
      const database = createFunctionRuntimePointReaderV1(
        (documentId: string) => {
          if (state.closed) throw readBoundaryError(new Error("Query read boundary is closed."));
          const pending = Promise.resolve().then(() => {
            const tableName = tableNameForDocument(request.tables, documentId);
            return capability!.readPointDocument(tableName ?? "", documentId);
          }).then(result => decodePointRead(result)).catch(cause => {
            state.failure ??= cause;
            throw readBoundaryError(cause);
          });
          state.pending.add(pending);
          const cleanup = () => { state.pending.delete(pending); };
          void pending.then(cleanup, cleanup);
          return pending;
        },
      );
      const auth = createFunctionRuntimeAuthV1(
        request.auth,
      );
      const invocations: PointQueryInternalCallRuntimeInvocationFactoryV1 = freeze({
        open: () => freeze({
          createContext: (
            runQuery: PointQueryInternalCallRuntimeRunQueryV1,
          ) =>
            createFunctionRuntimeRunQueryContextV1(auth, database, runQuery),
          readBoundary: freeze({
            close: () => { state.closed = true; },
            drain: async () => {
              await Promise.allSettled([...state.pending]);
              if (state.failure !== undefined) throw state.failure;
            },
          }),
          recordCallFrame: (frame: PointQueryInternalCallFrameV1) => {
            state.callFrames.push(frame);
          },
          recordTerminalFailure: (cause: unknown) => { state.failure ??= cause; },
          isCoreApplicationError: inspectCoreApplicationErrorV1,
        }),
      });
      const runtimeInput: PointQueryInternalCallRuntimeInputV1 = freeze({
        executionId: request.context.executionId,
        function: freeze({
          ...request.function,
          ordinal: CONFIGURED_ROOT_FUNCTION_ORDINAL,
        }),
        internalQueryCatalog: CONFIGURED_INTERNAL_QUERY_CATALOG,
        callBudget: freeze({
          maximumCalls: 64,
          maximumDepth: 8,
          maximumArgumentBytes: 8 * 1_048_576,
          maximumResultBytes: 8 * 1_048_576,
        }),
        arguments: request.arguments,
        tables: request.tables,
      });
      let value: RuntimeValue;
      try {
        value = await kernel.executePointQueryInternalCallV1(
          runtimeInput,
          freeze({ resolve: resolveFunction }),
          invocations,
        );
      } catch (cause) {
        const failure = kernel.inspectPointQueryInternalCallRuntimeFailureV1(cause);
        if (failure?.kind === "contract") {
          throw failure.reason === "argumentsInvalid"
            ? namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", cause)
            : namedError("PointQueryInternalCallExactRuntimeWorkerDefinitionV1Error", cause);
        }
        if (failure?.kind === "readBoundary") {
          throw namedError("PointQueryInternalCallExactRuntimeReadBoundaryV1Error", failure.cause);
        }
        if (failure?.kind === "userCode") {
          throw namedError("PointQueryInternalCallExactRuntimeUserCodeV1Error", failure.cause);
        }
        if (failure?.kind === "terminal") {
          throw namedError(
            "PointQueryInternalCallExactRuntimeTerminalV1Error",
            failure.cause ?? cause,
          );
        }
        throw cause;
      }
      return freeze({ format: RESULT_FORMAT, version: RESULT_VERSION, value });
    } catch (cause) {
      settledFailure = { cause };
      throw cause;
    } finally {
      activeTerminalFailureRecorder = undefined;
      try {
        capability?.[Symbol.dispose]?.();
      } catch (cause) {
        if (settledFailure === undefined) {
          throw namedError("PointQueryInternalCallExactRuntimeReadBoundaryV1Error", cause);
        }
      }
    }
  }
}

async function resolveFunction(path: string): Promise<unknown> {
  const registry = await executionModulePromise;
  const separator = path.indexOf(":");
  if (separator <= 0 || separator !== path.lastIndexOf(":")) return undefined;
  return Reflect.get(
    Reflect.get(registry.default, path.slice(0, separator)) ?? {},
    path.slice(separator + 1),
  );
}

function decodeRequest(
  input: unknown,
  captureArguments: typeof capturePointQueryInternalCallRuntimeArgumentsV1,
): Readonly<{
  readonly runtimeTargetSha256: Uint8Array;
  readonly function: Omit<
    PointQueryInternalCallRuntimeInputV1["function"],
    "ordinal"
  >;
  readonly auth: Readonly<
    { readonly kind: "anonymous" } |
    { readonly kind: "user"; readonly user: UserIdentity }
  >;
  readonly arguments: RuntimeObject;
  readonly tables: PointQueryInternalCallRuntimeInputV1["tables"];
  readonly context: Readonly<{
    readonly executionId: string;
    readonly executionTime: number;
    readonly randomSeed: Uint8Array;
  }>;
}> {
  if (!hasExactKeys(input, ["format", "version", "runtimeTargetSha256",
    "artifact", "function", "auth", "arguments", "argumentSemanticBytes",
    "tables", "context"]) || input.format !== REQUEST_FORMAT ||
    input.version !== REQUEST_VERSION ||
    !isBytes(input.runtimeTargetSha256, 32) ||
    hex(input.runtimeTargetSha256) !== RUNTIME_TARGET_SHA256_HEX ||
    !hasExactKeys(input.artifact, ["runtime", "artifactId", "sourcePackageHash",
      "executionModule"]) || !plainDataEqual(input.artifact, CONFIGURED_ARTIFACT) ||
    !hasExactKeys(input.function, ["path", "executionModule", "kind", "visibility",
      "argsValidator", "returnsValidator"]) ||
    !plainDataEqual(input.function, CONFIGURED_FUNCTION) ||
    !Number.isSafeInteger(input.argumentSemanticBytes) ||
    Number(input.argumentSemanticBytes) < 0 ||
    Number(input.argumentSemanticBytes) > MAX_ARGUMENT_BYTES ||
    !Array.isArray(input.tables) || input.tables.length > 1_024 ||
    !hasExactKeys(input.context, ["executionId", "randomSeed", "executionTime",
      "snapshotCommitSeq"]) || !isBoundedText(input.context.executionId) ||
    typeof input.context.executionTime !== "number" ||
    !Number.isFinite(input.context.executionTime) ||
    !isBytes(input.context.randomSeed, RANDOM_SEED_BYTES) ||
    input.context.snapshotCommitSeq !== CONFIGURED_SNAPSHOT_COMMIT_SEQ) {
    throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", input);
  }
  let capturedArguments: ReturnType<typeof captureArguments>;
  try { capturedArguments = captureArguments(input.arguments); }
  catch (cause) {
    throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", cause);
  }
  if (capturedArguments.semanticSizeBytes !== input.argumentSemanticBytes) {
    throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", input);
  }
  const auth = captureAuth(input.auth, captureArguments);
  const tables: Array<Readonly<{
    readonly tableId: number;
    readonly logicalName: string;
  }>> = [];
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const table of input.tables) {
    if (!hasExactKeys(table, ["tableId", "logicalName"]) ||
      !Number.isSafeInteger(table.tableId) || Number(table.tableId) < 1 ||
      !isBoundedText(table.logicalName) || ids.has(Number(table.tableId)) ||
      names.has(String(table.logicalName))) {
      throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", table);
    }
    ids.add(Number(table.tableId));
    names.add(String(table.logicalName));
    tables.push(freeze({
      tableId: Number(table.tableId),
      logicalName: String(table.logicalName),
    }));
  }
  return freeze({
    runtimeTargetSha256: new Uint8Array(input.runtimeTargetSha256),
    function: CONFIGURED_FUNCTION,
    auth,
    arguments: capturedArguments.value,
    tables: freeze(tables),
    context: freeze({
      executionId: input.context.executionId,
      executionTime: input.context.executionTime,
      randomSeed: new Uint8Array(input.context.randomSeed),
    }),
  });
}

function captureAuth(
  input: unknown,
  captureArguments: typeof capturePointQueryInternalCallRuntimeArgumentsV1,
) {
  if (hasExactKeys(input, ["kind"]) && input.kind === "anonymous") {
    return freeze({ kind: "anonymous" as const });
  }
  if (!hasExactKeys(input, ["kind", "user"]) || input.kind !== "user" ||
    !isRecord(input.user)) {
    throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", input);
  }
  return freeze({
    kind: "user" as const,
    user: captureUserIdentity(input.user, captureArguments),
  });
}

function captureUserIdentity(
  input: UnknownRecord,
  captureArguments: typeof capturePointQueryInternalCallRuntimeArgumentsV1,
): UserIdentity {
  const captured = captureArguments(input);
  if (captured.semanticSizeBytes > MAX_AUTH_BYTES ||
    typeof captured.value.tokenIdentifier !== "string" ||
    typeof captured.value.subject !== "string" ||
    typeof captured.value.issuer !== "string") {
    throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", input);
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      output[key] = undefined;
      continue;
    }
    if (isKnownStringClaim(key) ? typeof value !== "string"
      : isKnownBooleanClaim(key) ? typeof value !== "boolean"
      : !isJsonValue(value, new WeakSet())) {
      throw namedError("PointQueryInternalCallExactRuntimeInvalidRequestV1Error", input);
    }
    output[key] = nativeStructuredClone(value);
  }
  return deepFreeze(output) as UserIdentity;
}

function isKnownStringClaim(key: string): boolean {
  return ["tokenIdentifier", "subject", "issuer", "name", "givenName",
    "familyName", "nickname", "preferredUsername", "profileUrl", "pictureUrl",
    "email", "gender", "birthday", "timezone", "language", "phoneNumber",
    "address", "updatedAt"].includes(key);
}
function isKnownBooleanClaim(key: string): boolean {
  return key === "emailVerified" || key === "phoneNumberVerified";
}
function isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every(member => isJsonValue(member, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every(member => isJsonValue(member, ancestors));
  ancestors.delete(value);
  return valid;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) deepFreeze(member);
    freeze(value);
  }
  return value;
}

function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" ||
    typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length ||
    leftKeys.some(key => typeof key !== "string") ||
    rightKeys.some(key => typeof key !== "string")) return false;
  const rightKeySet = new Set(rightKeys);
  return leftKeys.every(key => rightKeySet.has(key) &&
    plainDataEqual(Reflect.get(left, key), Reflect.get(right, key)));
}

function hasExactKeys(
  value: unknown,
  keys: ReadonlyArray<string>,
): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !value.includes("\0") && new TextEncoder().encode(value).byteLength <= 4_096;
}

function decodeReadCapability(input: unknown): QueryReadCapability {
  if (!isRecord(input) || typeof input.revalidate !== "function" ||
    typeof input.readPointDocument !== "function") {
    throw namedError("PointQueryInternalCallExactRuntimeReadBoundaryV1Error", input);
  }
  return input as unknown as QueryReadCapability;
}

function decodePointRead(input: unknown): RuntimeObject | null {
  if (!isRecord(input) || (input.kind !== "missing" && input.kind !== "present")) {
    throw new Error("Query read capability returned an invalid result.");
  }
  if (input.kind === "missing") return null;
  if (!isRecord(input.document)) {
    throw new Error("Query read capability returned a non-document value.");
  }
  return input.document as RuntimeObject;
}

function tableNameForDocument(
  tables: PointQueryInternalCallRuntimeInputV1["tables"],
  documentId: unknown,
): string | null {
  if (typeof documentId !== "string") return null;
  const separator = documentId.indexOf(":");
  const tableId = Number(documentId.slice(0, separator));
  const table = tables.find(candidate => candidate.tableId === tableId);
  return separator > 0 && table !== undefined ? table.logicalName : null;
}

function unavailableOperation(): never {
  return terminalUnavailable("Operation is unavailable in exact point-query runtime.");
}
function terminalUnavailable(message: string): never {
  const cause = new Error(message);
  activeTerminalFailureRecorder?.(cause);
  throw namedError("PointQueryInternalCallRuntimeTerminalV1Error", cause);
}
function readBoundaryError(cause: unknown): Error {
  return namedError("PointQueryInternalCallRuntimeReadBoundaryV1Error", cause);
}
function namedError(name: string, cause: unknown): Error {
  const error = new Error(name);
  defineProperty(error, "name", { value: name });
  defineProperty(error, "cause", { value: cause });
  return error;
}
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBytes(value: unknown, length: number): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === length;
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function ExactRuntimeDate(...args: ReadonlyArray<unknown>): string | Date {
  if (new.target === undefined) return new nativeDate(deterministicTime).toString();
  return args.length === 0
    ? reflectConstruct(nativeDate, [deterministicTime], new.target)
    : reflectConstruct(nativeDate, args, new.target);
}

function installExactGlobals(): void {
  ExactRuntimeDate.prototype = nativeDate.prototype;
  defineProperty(ExactRuntimeDate, "now", { value: () => deterministicTime });
  defineProperty(globalThis, "Date", { value: ExactRuntimeDate });
  defineProperty(globalThis, "Math", {
    value: freeze(Object.assign(Object.create(nativeMath), {
      random: () => deterministicRandom(),
    })),
  });
  defineProperty(globalThis, "crypto", {
    value: freeze({
      getRandomValues: unavailableOperation,
      randomUUID: unavailableOperation,
      subtle: freeze({ digest: unavailableOperation }),
    }),
  });
  for (const name of ["setTimeout", "setInterval", "fetch", "WebSocketPair",
    "MessageChannel", "File"] as const) {
    if (Reflect.get(globalThis, name) !== undefined) {
      defineProperty(globalThis, name, { value: unavailableOperation });
    }
  }
  let prototype = getPrototypeOf(globalThis);
  while (prototype !== null) {
    for (const name of ["setTimeout", "setInterval", "fetch"] as const) {
      if (getOwnPropertyDescriptor(prototype, name) !== undefined) {
        defineProperty(prototype, name, { value: unavailableOperation });
      }
    }
    prototype = getPrototypeOf(prototype);
  }
}

function randomFromSeed(seed: Uint8Array): () => number {
  if (!isBytes(seed, RANDOM_SEED_BYTES)) throw new Error("Invalid query seed.");
  let state = 0x9e3779b9;
  for (const byte of seed) state = Math.imul(state ^ byte, 0x85ebca6b) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
