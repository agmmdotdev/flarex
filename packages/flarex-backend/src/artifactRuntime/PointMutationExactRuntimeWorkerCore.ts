// Authored exact point-mutation runtime core. Built to an embedded JS artifact.
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  createFunctionRuntimeAuthV1,
  createFunctionRuntimeDatabaseContextV1,
  createFunctionRuntimePointDatabaseWriterV1,
  createFunctionRuntimePointReaderV1,
} from "flarex:function-api-core/v1";
import type {
  UserIdentity,
} from "flarex-protocol/auth";
import type {
  PointMutationExactRuntimeResultV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import type {
  inspectPointMutationRuntimeFailureV1,
  PointMutationRuntimeInvocationFactoryV1,
  PointMutationRuntimeInputV1,
  executePointMutationV1,
} from "@flarex/function-runtime/point-mutation";
import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";
import { inspectCoreApplicationErrorV1 } from "./_flarex/application-error-platform-v1.js";

import {
  exactRuntimeConfigurationV1,
} from "./pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-config-v1.js";

const EXECUTION_MODULE = exactRuntimeConfigurationV1.executionModule;
const MODULE_TIME = exactRuntimeConfigurationV1.moduleEvaluationTime;
const MODULE_RANDOM_SEED_HEX =
  exactRuntimeConfigurationV1.pinnedSourcePackageHash;
const REQUEST_FORMAT = exactRuntimeConfigurationV1.requestFormat;
const REQUEST_VERSION = exactRuntimeConfigurationV1.requestVersion;
const RESULT_FORMAT = exactRuntimeConfigurationV1.resultFormat;
const RESULT_VERSION = exactRuntimeConfigurationV1.resultVersion;
const MAX_CONTEXT_TEXT_BYTES =
  exactRuntimeConfigurationV1.maxContextTextBytes;
const MAX_AUTH_SEMANTIC_BYTES =
  exactRuntimeConfigurationV1.maxAuthSemanticBytes;
const RANDOM_SEED_BYTES = exactRuntimeConfigurationV1.randomSeedBytes;
const MAX_ARGUMENT_ARRAY_SEMANTIC_BYTES =
  exactRuntimeConfigurationV1.maxArgumentArraySemanticBytes;
const MAX_VALUE_BYTES = 1 << 25;
const MAX_VALUE_NESTING = 64;
const MAX_APP_DOCUMENT_BYTES = 1 << 20;
const MAX_APP_DOCUMENT_NESTING = 16;
const MAX_ARRAY_ITEMS = 8192;
const MAX_OBJECT_FIELDS = 1024;
const MAX_OBJECT_FIELD_BYTES = 1024;
const MAX_CATALOG_TABLE_ID = 2147483647;
const MAX_VALIDATOR_NODES:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_NODES_V1 = 65_536;
const MAX_VALIDATOR_DEPTH:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_DEPTH_V1 = 128;
const MAX_VALIDATOR_OBJECT_FIELDS:
  typeof import("flarex-protocol/validator-json")
    .MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1 = 1_024;
const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;
const textEncoder = new TextEncoder();
const nativeDate = globalThis.Date;
const nativeMath = globalThis.Math;
const nativeCrypto = globalThis.crypto;
const nativePerformance = globalThis.performance;
const nativeIntl = globalThis.Intl;
const nativeScheduler = globalThis.scheduler;
const nativeAbortSignal = globalThis.AbortSignal;
const nativeStructuredClone = globalThis.structuredClone;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
const reflectConstruct = Reflect.construct;
const reflectOwnKeys = Reflect.ownKeys;
const stringIsWellFormed = Reflect.get(String.prototype, "isWellFormed");
let deterministicTime = MODULE_TIME;
let deterministicRandom = randomFromSeed(hexSeed(MODULE_RANDOM_SEED_HEX));
let runAdmitted = false;

type UnknownRecord = Readonly<Record<string, unknown>>;

interface NormalizedRuntimeValue {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly semanticBytes: number;
  readonly nestingDepth: number;
}

interface DecodedExactRuntimeTable {
  readonly tableId: number;
  readonly logicalName: string;
}

type DecodedExactRuntimeAuth =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{ readonly kind: "user"; readonly user: UserIdentity }>;

interface DecodedExactRuntimeRequest {
  readonly format: typeof REQUEST_FORMAT;
  readonly version: typeof REQUEST_VERSION;
  readonly artifact: Readonly<{
    readonly runtime: "dynamic-worker";
    readonly artifactId: string;
    readonly sourcePackageHash: string;
    readonly executionModule: string;
  }>;
  readonly function: Readonly<{
    readonly path: string;
    readonly executionModule: string;
    readonly kind: "mutation";
    readonly visibility: "public";
    readonly argsValidator:
      | ObjectValidatorJsonV1
      | Readonly<{ readonly type: "any" }>;
    readonly returnsValidator: ValidatorJsonV1 | null;
  }>;
  readonly auth: DecodedExactRuntimeAuth;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentArraySemanticBytes: number;
  readonly tables: ReadonlyArray<DecodedExactRuntimeTable>;
  readonly context: Readonly<{
    readonly executionId: string;
    readonly logScopeId: string;
    readonly randomSeed: Uint8Array;
    readonly executionTime: number;
    readonly initialCreationTimeCursor: number;
  }>;
}

interface JournalCapability {
  readonly resolvePointTable: (
    name: string,
  ) => unknown | PromiseLike<unknown>;
  readonly [Symbol.dispose]?: () => void;
}

interface TableJournalCapability {
  readonly runPointOperation: (
    operation: JournalOperationWithSequence,
  ) => unknown | PromiseLike<unknown>;
  readonly [Symbol.dispose]?: () => void;
}

type GetOperation = Readonly<{
  readonly kind: "get";
  readonly documentId: string;
}>;
type InsertOperation = Readonly<{
  readonly kind: "insert";
  readonly fields: CanonicalFlarexRuntimeObjectV1;
}>;
type PatchOperation = Readonly<{
  readonly kind: "patch";
  readonly documentId: string;
  readonly patch: Readonly<
    Record<string, CanonicalFlarexRuntimeValueV1 | undefined>
  >;
}>;
type ReplaceOperation = Readonly<{
  readonly kind: "replace";
  readonly documentId: string;
  readonly fields: CanonicalFlarexRuntimeObjectV1;
}>;
type DeleteOperation = Readonly<{
  readonly kind: "delete";
  readonly documentId: string;
}>;
type JournalOperation =
  | GetOperation
  | InsertOperation
  | PatchOperation
  | ReplaceOperation
  | DeleteOperation;
type JournalOperationWithSequence = JournalOperation & Readonly<{
  readonly syscallSequence: bigint;
}>;

type AppDocument = CanonicalFlarexRuntimeObjectV1 & Readonly<{
  readonly _id: string;
  readonly _creationTime: number;
}>;
type GetOutcome =
  | Readonly<{ readonly kind: "missing"; readonly document: null }>
  | Readonly<{ readonly kind: "present"; readonly document: AppDocument }>;
type InsertOutcome = Readonly<{
  readonly kind: "inserted";
  readonly documentId: string;
  readonly document: AppDocument;
}>;
type UnitOutcome = Readonly<{
  readonly kind: "unit";
  readonly operation: "patch" | "replace" | "delete";
}>;
type JournalOutcome = GetOutcome | InsertOutcome | UnitOutcome;

interface ExactRuntimeDatabase {
  readonly get: (documentId: string) => Promise<AppDocument | null>;
  readonly insert: (tableName: string, fields: unknown) => Promise<string>;
  readonly patch: (documentId: string, patch: unknown) => Promise<void>;
  readonly replace: (documentId: string, fields: unknown) => Promise<void>;
  readonly delete: (documentId: string) => Promise<void>;
}

interface ExactRuntimeJournal {
  readonly database: ExactRuntimeDatabase;
  readonly close: () => void;
  readonly drain: () => Promise<void>;
  readonly dispose: () => void;
}

function ExactRuntimeDate(...args: ReadonlyArray<unknown>): string | Date {
  if (new.target === undefined) {
    return new nativeDate(deterministicTime).toString();
  }
  return args.length === 0
    ? reflectConstruct(nativeDate, [deterministicTime], new.target)
    : reflectConstruct(nativeDate, args, new.target);
}

installExactRuntimeIntrinsics();

function installExactRuntimeIntrinsics(): void {
  ExactRuntimeDate.prototype = nativeDate.prototype;
  defineProperty(nativeDate.prototype, "constructor", {
    value: ExactRuntimeDate,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  defineProperty(ExactRuntimeDate, "now", {
    value: () => deterministicTime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  defineProperty(ExactRuntimeDate, "parse", {
    value: (value: string) => reflectApply(nativeDate.parse, nativeDate, [value]),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  defineProperty(ExactRuntimeDate, "UTC", {
    value: (...args: ReadonlyArray<number>) =>
      reflectApply(nativeDate.UTC, nativeDate, args),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  defineProperty(nativeMath, "random", {
    value: () => deterministicRandom(),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  installExactGlobal("Date", ExactRuntimeDate);
  installExactGlobal("Math", nativeMath);
  if (nativeCrypto !== undefined) {
    const unavailableRandom = () => {
      throw new Error("Nondeterministic crypto randomness is unavailable in exact mutation runtime.");
    };
    const exactCrypto = createObject(null);
    defineProperty(exactCrypto, "getRandomValues", {
      value: unavailableRandom,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    if (typeof nativeCrypto.randomUUID === "function") {
      defineProperty(exactCrypto, "randomUUID", {
        value: unavailableRandom,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    if (nativeCrypto.subtle !== undefined) {
      const unavailableSubtle = () => {
        throw new Error(
          "Asynchronous crypto operations are unavailable in exact mutation runtime.",
        );
      };
      const exactSubtle = createObject(null);
      for (const name of [
        "decrypt",
        "deriveBits",
        "deriveKey",
        "digest",
        "encrypt",
        "exportKey",
        "generateKey",
        "importKey",
        "sign",
        "unwrapKey",
        "verify",
        "wrapKey",
      ]) {
        defineProperty(exactSubtle, name, {
          value: unavailableSubtle,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      defineProperty(exactCrypto, "subtle", {
        value: freeze(exactSubtle),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    installExactGlobal("crypto", freeze(exactCrypto));
  }
  const unavailableCache = () => {
    throw new Error("Cloudflare Cache API is unavailable in exact mutation runtime.");
  };
  const exactDefaultCache = createObject(null);
  for (const name of ["delete", "match", "put"]) {
    defineProperty(exactDefaultCache, name, {
      value: unavailableCache,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  const exactCaches = createObject(null);
  defineProperty(exactCaches, "default", {
    value: freeze(exactDefaultCache),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  defineProperty(exactCaches, "open", {
    value: unavailableCache,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  installExactGlobal("caches", freeze(exactCaches));
  if (nativePerformance !== undefined) {
    const exactPerformance = createObject(null);
    defineProperty(exactPerformance, "now", {
      value: () => 0,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    defineProperty(exactPerformance, "timeOrigin", {
      value: MODULE_TIME,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    installExactGlobal("performance", freeze(exactPerformance));
  }
  const unavailableTimer = () => {
    throw new Error("Timers are unavailable in exact mutation runtime.");
  };
  for (const name of ["setTimeout", "setInterval", "setImmediate"]) {
    if (typeof Reflect.get(globalThis, name) === "function") {
      installExactGlobal(name, unavailableTimer);
    }
  }
  if (nativeScheduler !== undefined) {
    const exactScheduler = createObject(null);
    for (const name of ["wait", "yield", "postTask"]) {
      defineProperty(exactScheduler, name, {
        value: unavailableTimer,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    installExactGlobal("scheduler", freeze(exactScheduler));
  }
  if (
    nativeAbortSignal !== undefined &&
    typeof nativeAbortSignal.timeout === "function"
  ) {
    defineProperty(nativeAbortSignal, "timeout", {
      value: unavailableTimer,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  if (nativeIntl !== undefined) {
    const exactIntl = createObject(null);
    for (const key of reflectOwnKeys(nativeIntl)) {
      if (key === "DateTimeFormat") continue;
      const descriptor = getOwnPropertyDescriptor(nativeIntl, key);
      if (descriptor !== undefined && "value" in descriptor) {
        defineProperty(exactIntl, key, {
          value: descriptor.value,
          enumerable: descriptor.enumerable ?? false,
          configurable: false,
          writable: false,
        });
      }
    }
    defineProperty(ExactRuntimeDateTimeFormat, "supportedLocalesOf", {
      value: (
        locales: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) =>
        reflectApply(
          nativeIntl.DateTimeFormat.supportedLocalesOf,
          nativeIntl.DateTimeFormat,
          [locales, options],
        ),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    defineProperty(exactIntl, "DateTimeFormat", {
      value: freeze(ExactRuntimeDateTimeFormat),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    installExactGlobal("Intl", freeze(exactIntl));
  }

  installUnavailableAsyncGlobal("fetch");
  installUnavailableAsyncGlobal("MessageChannel");
  installUnavailableAsyncGlobal("BroadcastChannel");
  installUnavailableAsyncGlobal("WebSocketPair");
  installUnavailableAsyncGlobal("File");
  if (globalThis.WebAssembly !== undefined) {
    const exactWebAssembly = createObject(null);
    const blocked = new Set([
      "compile",
      "compileStreaming",
      "instantiate",
      "instantiateStreaming",
    ]);
    for (const key of reflectOwnKeys(globalThis.WebAssembly)) {
      const descriptor = getOwnPropertyDescriptor(globalThis.WebAssembly, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      defineProperty(exactWebAssembly, key, {
        value: blocked.has(String(key))
          ? unavailableAsyncCapability
          : descriptor.value,
        enumerable: descriptor.enumerable ?? false,
        configurable: false,
        writable: false,
      });
    }
    installExactGlobal("WebAssembly", freeze(exactWebAssembly));
  }

  hardenIntrinsic("Object", Object);
  hardenIntrinsic("Function", Function);
  hardenIntrinsic("Array", Array);
  hardenIntrinsic("ArrayBuffer", ArrayBuffer);
  hardenIntrinsic("BigInt", BigInt);
  freeze(nativeDate.prototype);
  freeze(nativeDate);
  hardenIntrinsic("Date", ExactRuntimeDate);
  hardenIntrinsic("Error", Error);
  hardenIntrinsic("Map", Map);
  hardenIntrinsic("Number", Number);
  hardenIntrinsic("Promise", Promise);
  hardenIntrinsic("Reflect", Reflect);
  hardenIntrinsic("RegExp", RegExp);
  hardenIntrinsic("Set", Set);
  hardenIntrinsic("String", String);
  hardenIntrinsic("TextEncoder", TextEncoder);
  hardenIntrinsic("Uint8Array", Uint8Array);
  hardenIntrinsic("WeakSet", WeakSet);
  if (nativeAbortSignal !== undefined) {
    hardenIntrinsic("AbortSignal", nativeAbortSignal);
  }
  freeze(nativeMath);
}

function ExactRuntimeDateTimeFormat(
  ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
): Readonly<Record<string, unknown>> {
  const formatter = reflectConstruct(nativeIntl.DateTimeFormat, args);
  const exactFormatter = createObject(null);
  const requireTime = (
    value: number | Date | undefined,
  ): number | Date => {
    if (value === undefined) {
      throw new Error(
        "Intl.DateTimeFormat requires an explicit time in exact mutation runtime.",
      );
    }
    return value;
  };
  const format = formatter.format;
  defineProperty(exactFormatter, "format", {
    value: (value?: number | Date) => format(requireTime(value)),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  defineProperty(exactFormatter, "formatToParts", {
    value: (value?: number | Date) =>
      reflectApply(formatter.formatToParts, formatter, [requireTime(value)]),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  defineProperty(exactFormatter, "resolvedOptions", {
    value: () => reflectApply(formatter.resolvedOptions, formatter, []),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  if (typeof formatter.formatRange === "function") {
    defineProperty(exactFormatter, "formatRange", {
      value: (start?: number | Date, end?: number | Date) =>
        reflectApply(
          formatter.formatRange,
          formatter,
          [requireTime(start), requireTime(end)],
        ),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (typeof formatter.formatRangeToParts === "function") {
    defineProperty(exactFormatter, "formatRangeToParts", {
      value: (start?: number | Date, end?: number | Date) =>
        reflectApply(
          formatter.formatRangeToParts,
          formatter,
          [requireTime(start), requireTime(end)],
        ),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return freeze(exactFormatter);
}

const executionModulePromise = import(
  "./pointMutationExactRuntimeWorker/flarex-point-mutation-exact-runtime-execution-v1.js"
);
const runtimeKernelModulePath =
  "./pointMutationExactRuntimeWorker/flarex-point-mutation-runtime-kernel-v1.js";
const runtimeKernelPromise = (
  import(runtimeKernelModulePath) as Promise<unknown>
).then(decodeRuntimeKernelModule);

// This generated Worker must remain self-contained. These literal witnesses
// are type-checked against the package-neutral serialized projection owner.
const APPLICATION_DOCUMENT_VALIDATION_ERROR_NAME:
  typeof import("flarex-protocol/internal/application-revision-syscall-validation-v1")
    .APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1 =
      "ApplicationRevisionSyscallDocumentValidationV1Error";
const APPLICATION_DOCUMENT_VALIDATION_ERROR_MESSAGE:
  typeof import("flarex-protocol/internal/application-revision-syscall-validation-v1")
    .APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 =
      "The resulting document failed the active schema validator.";

export class FlarexPointMutationExactRuntimeV1 extends WorkerEntrypoint {
  async run(
    input: unknown,
    journal: unknown,
  ): Promise<PointMutationExactRuntimeResultV1> {
    let journalRuntime: ExactRuntimeJournal | undefined;
    let capability: JournalCapability | undefined;
    let settledFailure:
      | Readonly<{ readonly cause: unknown }>
      | undefined;
    try {
      if (runAdmitted) {
        throw new Error("Exact point-mutation runtime admits one invocation.");
      }
      runAdmitted = true;
      const request = decodeRequest(input);
      const admittedCapability = decodeJournalCapability(journal);
      capability = admittedCapability;
      deterministicTime = request.context.executionTime;
      deterministicRandom = randomFromSeed(request.context.randomSeed);
      const kernel = await runtimeKernelPromise;
      const runtimeInput: PointMutationRuntimeInputV1 = Object.freeze({
        function: request.function,
        arguments: request.arguments,
        tables: request.tables,
      });
      const invocations: PointMutationRuntimeInvocationFactoryV1 =
        Object.freeze({
          open: () => {
            journalRuntime = databaseForJournal(
              request.tables,
              admittedCapability,
            );
            return Object.freeze({
              context: executionContext(request, journalRuntime.database),
              journal: journalRuntime,
              isCoreApplicationError: inspectCoreApplicationErrorV1,
            });
          },
        });
      let result: CanonicalFlarexRuntimeValueV1;
      try {
        result = await kernel.executePointMutationV1(
          runtimeInput,
          Object.freeze({ resolve: resolveFunction }),
          invocations,
        );
      } catch (cause) {
        const runtimeFailure =
          kernel.inspectPointMutationRuntimeFailureV1(cause);
        if (runtimeFailure?.kind === "userCode") {
          throw new ExactRuntimeUserCodeError(runtimeFailure.cause);
        }
        if (runtimeFailure?.kind === "journalBoundary") {
          throw journalBoundaryError(runtimeFailure.cause);
        }
        if (runtimeFailure?.kind === "contract") {
          throw runtimeFailure.reason === "argumentsInvalid"
            ? new ExactRuntimeInvalidRequestError(cause)
            : new ExactRuntimeWorkerDefinitionError(cause);
        }
        throw cause;
      }
      return Object.freeze({
        format: RESULT_FORMAT,
        version: RESULT_VERSION,
        value: result,
      });
    } catch (cause) {
      settledFailure = { cause };
      throw cause;
    } finally {
      journalRuntime?.close();
      let disposalFailure:
        | Readonly<{ readonly cause: unknown }>
        | undefined;
      try {
        journalRuntime?.dispose();
      } catch (cause) {
        disposalFailure = { cause };
      }
      try {
        disposeReceivedRpcStub(capability ?? journal);
      } catch (cause) {
        disposalFailure ??= { cause };
      }
      if (
        disposalFailure !== undefined &&
        settledFailure === undefined
      ) {
        throw journalBoundaryError(disposalFailure.cause);
      }
    }
  }
}

function hardenIntrinsic(name: string, value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    const prototype = Reflect.get(value, "prototype");
    if (
      prototype !== null &&
      (typeof prototype === "object" || typeof prototype === "function")
    ) {
      freeze(prototype);
    }
    freeze(value);
  }
  installExactGlobal(name, value);
}

function installExactGlobal(name: string, value: unknown): void {
  const exactDescriptor = {
    value,
    enumerable: false,
    configurable: false,
    writable: false,
  };
  defineProperty(globalThis, name, exactDescriptor);
  let prototype = getPrototypeOf(globalThis);
  while (prototype !== null) {
    if (getOwnPropertyDescriptor(prototype, name) !== undefined) {
      try {
        defineProperty(prototype, name, exactDescriptor);
      } catch (cause) {
        throw new Error(
          `Exact mutation runtime cannot neutralize inherited global ${name}.`,
          { cause },
        );
      }
    }
    prototype = getPrototypeOf(prototype);
  }
}

function unavailableAsyncCapability(): never {
  throw new Error(
    "Ambient asynchronous capabilities are unavailable in exact mutation runtime.",
  );
}

function installUnavailableAsyncGlobal(name: string): void {
  if (typeof Reflect.get(globalThis, name) === "function") {
    installExactGlobal(name, unavailableAsyncCapability);
  }
}

function hexSeed(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Exact-runtime module seed is invalid.");
  }
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) {
    seed[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return seed;
}

function randomFromSeed(seed: Uint8Array): () => number {
  if (!(seed instanceof Uint8Array) || seed.byteLength !== RANDOM_SEED_BYTES) {
    throw new Error("Exact-runtime random seed is invalid.");
  }
  const word = (offset: number): number =>
    (
      seed[offset] |
      (seed[offset + 1] << 8) |
      (seed[offset + 2] << 16) |
      (seed[offset + 3] << 24)
    ) >>> 0;
  let a = (word(0) + ((word(16) << 1) | (word(16) >>> 31)) + 0x9e3779b9) >>> 0;
  let b = (word(4) + ((word(20) << 7) | (word(20) >>> 25)) + 0x243f6a88) >>> 0;
  let c = (word(8) + ((word(24) << 13) | (word(24) >>> 19)) + 0xb7e15162) >>> 0;
  let d = (word(12) + ((word(28) << 19) | (word(28) >>> 13)) + 0xdeadbeef) >>> 0;
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const result = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = ((c << 21) | (c >>> 11));
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };
}

class ExactRuntimeJournalBoundaryError extends Error {
  constructor(cause: unknown) {
    super("Exact point-mutation journal boundary failed.");
    defineErrorName(
      this,
      "PointMutationExactRuntimeJournalBoundaryV1Error",
    );
    this.cause = cause;
  }
}

class ExactRuntimeUserCodeError extends Error {
  constructor(cause: unknown) {
    super("Exact point-mutation user code failed.");
    defineErrorName(this, "PointMutationExactRuntimeUserCodeV1Error");
    this.cause = cause;
  }
}

class ExactRuntimeInvalidRequestError extends Error {
  constructor(cause: unknown) {
    super("Exact point-mutation request violates its runtime contract.");
    defineErrorName(
      this,
      "PointMutationExactRuntimeInvalidRequestV1Error",
    );
    this.cause = cause;
  }
}

class ExactRuntimeWorkerDefinitionError extends Error {
  constructor(cause: unknown) {
    super("Exact point-mutation Worker definition is inconsistent.");
    defineErrorName(
      this,
      "PointMutationExactRuntimeWorkerDefinitionV1Error",
    );
    this.cause = cause;
  }
}

function defineErrorName(error: Error, name: string): void {
  defineProperty(error, "name", {
    value: name,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function journalBoundaryError(cause: unknown): ExactRuntimeJournalBoundaryError {
  return cause instanceof ExactRuntimeJournalBoundaryError
    ? cause
    : new ExactRuntimeJournalBoundaryError(cause);
}

interface RuntimeKernelModule {
  readonly executePointMutationV1: typeof executePointMutationV1;
  readonly inspectPointMutationRuntimeFailureV1:
    typeof inspectPointMutationRuntimeFailureV1;
}

function decodeRuntimeKernelModule(value: unknown): RuntimeKernelModule {
  if (value === null || typeof value !== "object") {
    throw new Error("Point-mutation runtime kernel module is unavailable.");
  }
  const descriptor = getOwnPropertyDescriptor(
    value,
    "executePointMutationV1",
  );
  const failureInspectorDescriptor = getOwnPropertyDescriptor(
    value,
    "inspectPointMutationRuntimeFailureV1",
  );
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function" ||
    failureInspectorDescriptor === undefined ||
    !("value" in failureInspectorDescriptor) ||
    typeof failureInspectorDescriptor.value !== "function"
  ) {
    throw new Error("Point-mutation runtime kernel export is unavailable.");
  }
  return freeze({
    executePointMutationV1:
      descriptor.value as typeof executePointMutationV1,
    inspectPointMutationRuntimeFailureV1:
      failureInspectorDescriptor.value as
        typeof inspectPointMutationRuntimeFailureV1,
  });
}

interface ValidatorDecodeBudget {
  nodes: number;
}

function decodeArgsValidator(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidatorDecodeBudget,
): DecodedExactRuntimeRequest["function"]["argsValidator"] {
  const validator = decodeValidator(value, path, depth, budget);
  if (validator.type === "object") return validator;
  if (validator.type === "any") return freeze({ type: "any" });
  throw new Error("Exact-runtime argument validator must be object or any.");
}

function decodeValidator(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidatorDecodeBudget,
): ValidatorJsonV1 {
  if (depth > MAX_VALIDATOR_DEPTH) {
    throw new Error("Exact-runtime validator nesting exceeds its limit.");
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_VALIDATOR_NODES) {
    throw new Error("Exact-runtime validator node count exceeds its limit.");
  }
  if (!isPlainRecord(value) || typeof value.type !== "string") {
    throw new Error(`Invalid exact-runtime validator at ${path}.`);
  }
  switch (value.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any": {
      exactKeys(value, ["type"], "exact-runtime validator");
      return freeze({ type: value.type });
    }
    case "id": {
      exactKeys(value, ["type", "tableName"], "exact-runtime ID validator");
      if (
        typeof value.tableName !== "string" ||
        value.tableName.length === 0
      ) {
        throw new Error(`Invalid exact-runtime ID validator at ${path}.`);
      }
      return freeze({ type: "id", tableName: value.tableName });
    }
    case "literal": {
      exactKeys(
        value,
        ["type", "value"],
        "exact-runtime literal validator",
      );
      if (
        !(
          typeof value.value === "string" ||
          typeof value.value === "boolean" ||
          (typeof value.value === "number" &&
            Number.isFinite(value.value) &&
            !Object.is(value.value, -0))
        )
      ) {
        throw new Error(`Invalid exact-runtime literal validator at ${path}.`);
      }
      return freeze({ type: "literal", value: value.value });
    }
    case "array": {
      exactKeys(
        value,
        ["type", "value"],
        "exact-runtime array validator",
      );
      return freeze({
        type: "array",
        value: decodeValidator(
          value.value,
          `${path}.value`,
          depth + 1,
          budget,
        ),
      });
    }
    case "object": {
      exactKeys(
        value,
        ["type", "value"],
        "exact-runtime object validator",
      );
      if (!isPlainRecord(value.value)) {
        throw new Error(`Invalid exact-runtime object validator at ${path}.`);
      }
      const entries = ownEnumerableDataEntries(
        value.value,
        "exact-runtime object validator fields",
      );
      if (entries.length > MAX_VALIDATOR_OBJECT_FIELDS) {
        throw new Error("Exact-runtime object validator has too many fields.");
      }
      const fields: Record<
        string,
        Readonly<{ readonly fieldType: ValidatorJsonV1; readonly optional: boolean }>
      > = {};
      for (const [fieldName, fieldValue] of entries) {
        const field = exactRecord(
          fieldValue,
          ["fieldType", "optional"],
          "exact-runtime object validator field",
        );
        if (typeof field.optional !== "boolean") {
          throw new Error(
            `Invalid exact-runtime object validator field at ${path}.`,
          );
        }
        defineProperty(fields, fieldName, {
          value: freeze({
            fieldType: decodeValidator(
              field.fieldType,
              `${path}.value.${fieldName}.fieldType`,
              depth + 1,
              budget,
            ),
            optional: field.optional,
          }),
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return freeze({ type: "object", value: freeze(fields) });
    }
    case "record": {
      exactKeys(
        value,
        ["type", "keys", "values"],
        "exact-runtime record validator",
      );
      return freeze({
        type: "record",
        keys: decodeValidator(
          value.keys,
          `${path}.keys`,
          depth + 1,
          budget,
        ),
        values: decodeValidator(
          value.values,
          `${path}.values`,
          depth + 1,
          budget,
        ),
      });
    }
    case "union": {
      exactKeys(
        value,
        ["type", "value"],
        "exact-runtime union validator",
      );
      if (!Array.isArray(value.value)) {
        throw new Error(`Invalid exact-runtime union validator at ${path}.`);
      }
      validateArrayShape(value.value, "exact-runtime union validator");
      if (value.value.length > MAX_VALIDATOR_NODES - budget.nodes) {
        throw new Error(
          "Exact-runtime union validator exceeds its remaining node budget.",
        );
      }
      return freeze({
        type: "union",
        value: freeze(value.value.map((member, index) =>
          decodeValidator(
            member,
            `${path}.value[${index}]`,
            depth + 1,
            budget,
          )
        )),
      });
    }
    default:
      throw new Error(`Unknown exact-runtime validator type at ${path}.`);
  }
}

function decodeRequest(value: unknown): DecodedExactRuntimeRequest {
  const request = exactRecord(value, [
    "format",
    "version",
    "artifact",
    "function",
    "auth",
    "arguments",
    "argumentArraySemanticBytes",
    "tables",
    "context",
  ], "exact-runtime request");
  if (request.format !== REQUEST_FORMAT || request.version !== REQUEST_VERSION) {
    throw new Error("Unsupported exact-runtime protocol format or version.");
  }
  const artifact = exactRecord(
    request.artifact,
    ["runtime", "artifactId", "sourcePackageHash", "executionModule"],
    "exact-runtime artifact",
  );
  if (
    artifact.runtime !== "dynamic-worker" ||
    typeof artifact.artifactId !== "string" ||
    !/^artifact_[a-f0-9]{32}$/.test(artifact.artifactId) ||
    typeof artifact.sourcePackageHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.sourcePackageHash) ||
    artifact.sourcePackageHash !== MODULE_RANDOM_SEED_HEX ||
    artifact.artifactId !== `artifact_${artifact.sourcePackageHash.slice(0, 32)}` ||
    typeof artifact.executionModule !== "string" ||
    artifact.executionModule !== EXECUTION_MODULE
  ) {
    throw new Error("Invalid exact-runtime artifact pin.");
  }
  const fn = exactRecord(
    request.function,
    [
      "path",
      "executionModule",
      "kind",
      "visibility",
      "argsValidator",
      "returnsValidator",
    ],
    "exact-runtime function",
  );
  if (
    !nonblankPostgresText(fn.path) ||
    typeof fn.executionModule !== "string" ||
    fn.executionModule !== EXECUTION_MODULE ||
    fn.kind !== "mutation" ||
    fn.visibility !== "public"
  ) {
    throw new Error("Invalid exact-runtime function pin.");
  }
  const argsValidator = decodeArgsValidator(
    fn.argsValidator,
    "$.function.argsValidator",
    1,
    { nodes: 0 },
  );
  const returnsValidator = fn.returnsValidator === null
    ? null
    : decodeValidator(
        fn.returnsValidator,
        "$.function.returnsValidator",
        1,
        { nodes: 0 },
      );
  const auth = decodeAuth(request.auth);
  const context = decodeContext(request.context);
  const tables = decodeTables(request.tables);
  const normalizedArguments = normalizeValue(
    request.arguments,
    "$.arguments",
    0,
    new WeakSet(),
  );
  if (!isPlainRecord(normalizedArguments.value)) {
    throw new Error("Exact-runtime arguments must be an object.");
  }
  if (
    typeof request.argumentArraySemanticBytes !== "number" ||
    !Number.isSafeInteger(request.argumentArraySemanticBytes) ||
    request.argumentArraySemanticBytes < 2 ||
    request.argumentArraySemanticBytes > MAX_ARGUMENT_ARRAY_SEMANTIC_BYTES ||
    request.argumentArraySemanticBytes !== normalizedArguments.semanticBytes + 2
  ) {
    throw new Error("Exact-runtime argument semantic size mismatch.");
  }
  return Object.freeze({
    format: request.format,
    version: request.version,
    artifact: Object.freeze({
      runtime: artifact.runtime,
      artifactId: artifact.artifactId,
      sourcePackageHash: artifact.sourcePackageHash,
      executionModule: artifact.executionModule,
    }),
    function: Object.freeze({
      path: fn.path,
      executionModule: fn.executionModule,
      kind: fn.kind,
      visibility: fn.visibility,
      argsValidator,
      returnsValidator,
    }),
    auth,
    arguments: normalizedArguments.value,
    argumentArraySemanticBytes: request.argumentArraySemanticBytes,
    tables,
    context,
  });
}

function decodeAuth(value: unknown): DecodedExactRuntimeAuth {
  if (!isPlainRecord(value)) {
    throw new Error("Invalid exact-runtime auth projection.");
  }
  if (value.kind === "anonymous") {
    exactKeys(value, ["kind"], "exact-runtime anonymous auth");
    return Object.freeze({ kind: "anonymous" });
  }
  if (value.kind === "user") {
    exactKeys(
      value,
      ["kind", "user"],
      "exact-runtime user auth",
    );
    const ownedUser = reflectApply(
      nativeStructuredClone,
      globalThis,
      [value.user],
    );
    const normalized = normalizeValue(
      ownedUser,
      "$.auth.user",
      0,
      new WeakSet(),
    );
    if (
      normalized.semanticBytes > MAX_AUTH_SEMANTIC_BYTES ||
      !isUserIdentity(ownedUser)
    ) {
      throw new Error("Invalid exact-runtime user auth.");
    }
    freezeJsonValue(ownedUser);
    return Object.freeze({
      kind: "user",
      user: freeze(ownedUser),
    });
  }
  throw new Error("Invalid exact-runtime auth kind.");
}

function decodeContext(
  value: unknown,
): DecodedExactRuntimeRequest["context"] {
  const context = exactRecord(value, [
    "executionId",
    "logScopeId",
    "randomSeed",
    "executionTime",
    "initialCreationTimeCursor",
  ], "exact-runtime context");
  if (
    !nonblankBoundedText(context.executionId) ||
    !nonblankBoundedText(context.logScopeId) ||
    !(context.randomSeed instanceof Uint8Array) ||
    context.randomSeed.byteLength !== RANDOM_SEED_BYTES ||
    !creationTime(context.executionTime) ||
    !creationTime(context.initialCreationTimeCursor)
  ) {
    throw new Error("Invalid exact-runtime execution context.");
  }
  return Object.freeze({
    executionId: context.executionId,
    logScopeId: context.logScopeId,
    randomSeed: context.randomSeed.slice(),
    executionTime: context.executionTime,
    initialCreationTimeCursor: context.initialCreationTimeCursor,
  });
}

function decodeTables(value: unknown): ReadonlyArray<DecodedExactRuntimeTable> {
  if (!Array.isArray(value) || value.length > MAX_OBJECT_FIELDS) {
    throw new Error("Invalid exact-runtime table projection.");
  }
  validateArrayShape(value, "exact-runtime table projection");
  const ids = new Set<number>();
  const names = new Set<string>();
  const tables = value.map((item) => {
    const table = exactRecord(
      item,
      ["tableId", "logicalName"],
      "exact-runtime table",
    );
    if (
      typeof table.tableId !== "number" ||
      !Number.isSafeInteger(table.tableId) ||
      table.tableId < 1 ||
      table.tableId > MAX_CATALOG_TABLE_ID ||
      typeof table.logicalName !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(table.logicalName) ||
      ids.has(table.tableId) ||
      names.has(table.logicalName)
    ) {
      throw new Error("Invalid exact-runtime table projection.");
    }
    ids.add(table.tableId);
    names.add(table.logicalName);
    return Object.freeze({
      tableId: table.tableId,
      logicalName: table.logicalName,
    });
  });
  return Object.freeze(tables);
}

function decodeJournalCapability(value: unknown): JournalCapability {
  if (!isJournalCapability(value)) {
    throw new Error("Exact-runtime journal RPC capability is unavailable.");
  }
  return value;
}

function isJournalCapability(value: unknown): value is JournalCapability {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "resolvePointTable" in value &&
    typeof value.resolvePointTable === "function"
  );
}

function isTableJournalCapability(
  value: unknown,
): value is TableJournalCapability {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "runPointOperation" in value &&
    typeof value.runPointOperation === "function"
  );
}

function executionContext(
  request: DecodedExactRuntimeRequest,
  database: ExactRuntimeDatabase,
) {
  return createFunctionRuntimeDatabaseContextV1(
    createFunctionRuntimeAuthV1(
      request.auth,
      cloneUserIdentityV1,
    ),
    database,
  );
}

function cloneUserIdentityV1(identity: UserIdentity): UserIdentity {
  return nativeStructuredClone(identity);
}

function isUserIdentity(value: unknown): value is UserIdentity {
  if (!isPlainRecord(value)) return false;
  if (
    typeof value.tokenIdentifier !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.issuer !== "string"
  ) {
    return false;
  }
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    if (isKnownStringIdentityClaim(key)) {
      if (typeof field !== "string") return false;
      continue;
    }
    if (isKnownBooleanIdentityClaim(key)) {
      if (typeof field !== "boolean") return false;
      continue;
    }
    if (!isJsonValue(field)) return false;
  }
  return true;
}

function isKnownStringIdentityClaim(key: string): boolean {
  return (
    key === "tokenIdentifier" ||
    key === "subject" ||
    key === "issuer" ||
    key === "name" ||
    key === "givenName" ||
    key === "familyName" ||
    key === "nickname" ||
    key === "preferredUsername" ||
    key === "profileUrl" ||
    key === "pictureUrl" ||
    key === "email" ||
    key === "gender" ||
    key === "birthday" ||
    key === "timezone" ||
    key === "language" ||
    key === "phoneNumber" ||
    key === "address" ||
    key === "updatedAt"
  );
}

function isKnownBooleanIdentityClaim(key: string): boolean {
  return key === "emailVerified" || key === "phoneNumberVerified";
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function freezeJsonValue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) freezeJsonValue(item);
    freeze(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freezeJsonValue(item);
    freeze(value);
  }
}

function databaseForJournal(
  tables: ReadonlyArray<DecodedExactRuntimeTable>,
  journal: JournalCapability,
): ExactRuntimeJournal {
  const namesById = new Map<string, string>(
    tables.map((table) => [String(table.tableId), table.logicalName]),
  );
  const idsByName = new Map<string, string>(
    tables.map((table) => [table.logicalName, String(table.tableId)]),
  );
  const tableCapabilities = new Map<
    string,
    Promise<TableJournalCapability>
  >();
  const receivedTableStubs = new Set<TableJournalCapability>();
  let syscallSequence = 0n;
  let operationTail: Promise<void> = Promise.resolve();
  let firstOperationFailure:
    | Readonly<{ readonly cause: ExactRuntimeJournalBoundaryError }>
    | undefined;
  let acceptingOperations = true;
  const requireTableName = (name: string): string => {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("A nonempty app table name is required.");
    }
    const known = tables.some((table) => table.logicalName === name);
    if (!known) throw new Error(`Unknown app table: ${name}`);
    return name;
  };
  const resolveTableCapability = async (
    name: string,
  ): Promise<TableJournalCapability> => {
    let capabilityPromise = tableCapabilities.get(name);
    if (capabilityPromise === undefined) {
      capabilityPromise = Promise.resolve(journal.resolvePointTable(name))
        .then((capability) => {
          if (!isTableJournalCapability(capability)) {
            throw new Error(
              "Resolved exact-runtime table capability is invalid.",
            );
          }
          receivedTableStubs.add(capability);
          return capability;
        });
      tableCapabilities.set(name, capabilityPromise);
    }
    return capabilityPromise;
  };
  const tableNameForDocumentId = (documentId: string): string => {
    if (!isAppDocumentId(documentId)) {
      throw new Error("A Flarex document ID string is required.");
    }
    const separator = documentId.indexOf(":");
    const name = separator > 0
      ? namesById.get(documentId.slice(0, separator))
      : undefined;
    if (name === undefined) {
      throw new Error("Document ID does not belong to a projected app table.");
    }
    return name;
  };
  function run(
    tableName: string,
    operation: GetOperation,
  ): Promise<GetOutcome>;
  function run(
    tableName: string,
    operation: InsertOperation,
  ): Promise<InsertOutcome>;
  function run(
    tableName: string,
    operation: PatchOperation | ReplaceOperation | DeleteOperation,
  ): Promise<UnitOutcome>;
  function run(
    tableName: string,
    operation: JournalOperation,
  ): Promise<JournalOutcome> {
    if (!acceptingOperations) {
      const failure = journalBoundaryError(
        new Error(
          "Exact-runtime database operation started after handler settlement.",
        ),
      );
      firstOperationFailure ??= { cause: failure };
      throw failure;
    }
    const execution = operationTail.then(async () => {
      if (firstOperationFailure !== undefined) {
        throw firstOperationFailure.cause;
      }
      try {
        const table = await resolveTableCapability(tableName);
        const operationSequence = syscallSequence + 1n;
        const outcome = await table.runPointOperation(
          Object.freeze({
            ...operation,
            syscallSequence: operationSequence,
          }),
        );
        syscallSequence = operationSequence;
        if (operation.kind === "get") {
          return decodeJournalOutcome(
            outcome,
            operation,
            idsByName.get(tableName),
          );
        }
        if (operation.kind === "insert") {
          return decodeJournalOutcome(
            outcome,
            operation,
            idsByName.get(tableName),
          );
        }
        return decodeJournalOutcome(
          outcome,
          operation,
          idsByName.get(tableName),
        );
      } catch (cause) {
        if (isApplicationDocumentValidationFailure(cause)) {
          throw cause;
        }
        const failure = journalBoundaryError(cause);
        firstOperationFailure ??= { cause: failure };
        throw failure;
      }
    });
    operationTail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
  const pointReader = createFunctionRuntimePointReaderV1(
    (documentId: string) =>
      trackCallerPromise(run(
        tableNameForDocumentId(documentId),
        { kind: "get", documentId },
      ).then((outcome) =>
        outcome.kind === "missing" ? null : outcome.document
      )),
  );
  const database = createFunctionRuntimePointDatabaseWriterV1(
    pointReader,
    Object.freeze({
      insertPointDocument: (tableName: string, fields: unknown) => {
        const capturedFields = captureDeveloperFields(fields, "insert fields");
        return trackCallerPromise(run(
          requireTableName(tableName),
          { kind: "insert", fields: capturedFields },
        ).then((outcome) => outcome.documentId));
      },
      patchPointDocument: (documentId: string, patch: unknown) =>
        trackCallerPromise(run(
          tableNameForDocumentId(documentId),
          {
            kind: "patch",
            documentId,
            patch: capturePatch(patch),
          },
        ).then(() => undefined)),
      replacePointDocument: (documentId: string, fields: unknown) =>
        trackCallerPromise(run(
          tableNameForDocumentId(documentId),
          {
            kind: "replace",
            documentId,
            fields: captureDeveloperFields(fields, "replacement fields"),
          },
        ).then(() => undefined)),
      deletePointDocument: (documentId: string) =>
        trackCallerPromise(run(
          tableNameForDocumentId(documentId),
          { kind: "delete", documentId },
        ).then(() => undefined)),
    }),
  );
  return Object.freeze({
    database,
    close: () => {
      acceptingOperations = false;
    },
    drain: async () => {
      let observedTail: Promise<void>;
      do {
        observedTail = operationTail;
        await observedTail;
        await Promise.resolve();
      } while (operationTail !== observedTail);
      if (firstOperationFailure !== undefined) {
        throw firstOperationFailure.cause;
      }
    },
    dispose: () => {
      let disposalFailure:
        | Readonly<{ readonly cause: unknown }>
        | undefined;
      for (const table of receivedTableStubs) {
        try {
          disposeReceivedRpcStub(table);
        } catch (cause) {
          disposalFailure ??= { cause };
        }
      }
      receivedTableStubs.clear();
      if (disposalFailure !== undefined) {
        throw disposalFailure.cause;
      }
    },
  });
}

function isApplicationDocumentValidationFailure(cause: unknown): boolean {
  // The trusted executor RPC owner admits only the exact C03-V error class.
  // This Worker sees its serialized private projection, so it matches the
  // pinned name/message and treats every other projection as host-owned.
  try {
    return cause instanceof Error &&
      cause.name === APPLICATION_DOCUMENT_VALIDATION_ERROR_NAME &&
      cause.message === APPLICATION_DOCUMENT_VALIDATION_ERROR_MESSAGE;
  } catch {
    return false;
  }
}

function disposeReceivedRpcStub(
  value: unknown,
): void {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return;
  }
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") {
    Reflect.apply(dispose, value, []);
  }
}

function trackCallerPromise<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => undefined);
  return promise;
}

function decodeJournalOutcome(
  value: unknown,
  operation: GetOperation,
  expectedTableId: string | undefined,
): GetOutcome;
function decodeJournalOutcome(
  value: unknown,
  operation: InsertOperation,
  expectedTableId: string | undefined,
): InsertOutcome;
function decodeJournalOutcome(
  value: unknown,
  operation: PatchOperation | ReplaceOperation | DeleteOperation,
  expectedTableId: string | undefined,
): UnitOutcome;
function decodeJournalOutcome(
  value: unknown,
  operation: JournalOperation,
  expectedTableId: string | undefined,
): JournalOutcome {
  if (!isPlainRecord(value)) {
    throw new Error("Exact-runtime journal returned an invalid outcome.");
  }
  switch (operation.kind) {
    case "get":
      if (value.kind === "missing" && value.document === null) {
        exactKeys(value, ["kind", "document"], "exact-runtime missing outcome");
        return Object.freeze({ kind: "missing", document: null });
      }
      if (value.kind === "present" && "document" in value) {
        exactKeys(value, ["kind", "document"], "exact-runtime present outcome");
        return Object.freeze({
          kind: "present",
          document: normalizeJournalDocument(
            value.document,
            operation.documentId,
            expectedTableId,
          ),
        });
      }
      break;
    case "insert":
      if (
        value.kind === "inserted" &&
        isAppDocumentId(value.documentId) &&
        "document" in value
      ) {
        exactKeys(
          value,
          ["kind", "documentId", "document"],
          "exact-runtime inserted outcome",
        );
        return Object.freeze({
          kind: "inserted",
          documentId: value.documentId,
          document: normalizeJournalDocument(
            value.document,
            value.documentId,
            expectedTableId,
          ),
        });
      }
      break;
    case "patch":
    case "replace":
    case "delete":
      if (value.kind === "unit" && value.operation === operation.kind) {
        exactKeys(value, ["kind", "operation"], "exact-runtime unit outcome");
        return Object.freeze({ kind: "unit", operation: operation.kind });
      }
      break;
  }
  throw new Error("Exact-runtime journal returned an invalid outcome.");
}

async function resolveFunction(path: string): Promise<unknown> {
  const separator = path.indexOf(":");
  const moduleName = separator === -1 ? path : path.slice(0, separator);
  const exportName = separator === -1 ? "default" : path.slice(separator + 1);
  const executionModule = await executionModulePromise;
  const module = executionModule.default?.[moduleName];
  return module?.[exportName];
}

function normalizeValue(
  value: unknown,
  path: string,
  parentNesting: number,
  ancestors: WeakSet<object>,
): NormalizedRuntimeValue {
  if (value === null || typeof value === "boolean") {
    return { value, semanticBytes: 1, nestingDepth: 0 };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { value, semanticBytes: 9, nestingDepth: 0 };
    }
    return { value, semanticBytes: 9, nestingDepth: 0 };
  }
  if (typeof value === "bigint") {
    if (value < MIN_INT64 || value > MAX_INT64) {
      throw new Error(`${path} bigint must fit signed int64.`);
    }
    return { value, semanticBytes: 9, nestingDepth: 0 };
  }
  if (typeof value === "string") {
    if (
      typeof stringIsWellFormed !== "function" ||
      reflectApply(stringIsWellFormed, value, []) !== true
    ) {
      throw new Error(`${path} must be well-formed Unicode.`);
    }
    const semanticBytes = 2 + textEncoder.encode(value).byteLength;
    assertValueSize(semanticBytes, path);
    return { value, semanticBytes, nestingDepth: 0 };
  }
  if (value instanceof ArrayBuffer) {
    const semanticBytes = 2 + value.byteLength;
    assertValueSize(semanticBytes, path);
    return { value: value.slice(0), semanticBytes, nestingDepth: 0 };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`${path} has too many array items.`);
    }
    const nesting = parentNesting + 1;
    assertNesting(nesting, path);
    validateArrayShape(value, path);
    return withAncestor(value, path, ancestors, () => {
      let semanticBytes = 2;
      let childNestingDepth = 0;
      const normalized: CanonicalFlarexRuntimeValueV1[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.value === undefined
        ) {
          throw new Error(`${path} must be a dense data-property array.`);
        }
        const child = normalizeValue(
          descriptor.value,
          `${path}[${index}]`,
          nesting,
          ancestors,
        );
        semanticBytes += child.semanticBytes;
        assertValueSize(semanticBytes, path);
        childNestingDepth = Math.max(
          childNestingDepth,
          child.nestingDepth,
        );
        normalized.push(child.value);
      }
      return {
        value: Object.freeze(normalized),
        semanticBytes,
        nestingDepth: 1 + childNestingDepth,
      };
    });
  }
  if (typeof value === "object" && value !== null) {
    if (!isPlainRecord(value)) {
      throw new Error(`${path} must be a plain data object.`);
    }
    const entries = ownEnumerableDataEntries(value, path)
      .filter((entry) => entry[1] !== undefined);
    if (entries.length > MAX_OBJECT_FIELDS) {
      throw new Error(`${path} has too many object fields.`);
    }
    const nesting = parentNesting + 1;
    assertNesting(nesting, path);
    return withAncestor(value, path, ancestors, () => {
      let semanticBytes = 2;
      let childNestingDepth = 0;
      const normalized: Record<string, CanonicalFlarexRuntimeValueV1> = {};
      for (const [key, item] of entries.sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )) {
        if (!isValidObjectField(key)) {
          throw new Error(`${path} has an invalid object field.`);
        }
        const child = normalizeValue(
          item,
          `${path}.${key}`,
          nesting,
          ancestors,
        );
        semanticBytes += key.length + 1 + child.semanticBytes;
        assertValueSize(semanticBytes, path);
        childNestingDepth = Math.max(
          childNestingDepth,
          child.nestingDepth,
        );
        Object.defineProperty(normalized, key, {
          value: child.value,
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      return {
        value: Object.freeze(normalized),
        semanticBytes,
        nestingDepth: 1 + childNestingDepth,
      };
    });
  }
  throw new Error(`${path} is not a Flarex runtime value.`);
}

function normalizeJournalDocument(
  value: unknown,
  expectedDocumentId: string,
  expectedTableId: string | undefined,
): AppDocument {
  const normalized = requireAppDocumentBounds(normalizeValue(
    value,
    "$.journal.document",
    0,
    new WeakSet(),
  ));
  if (!isPlainRecord(normalized.value)) {
    throw new Error("Exact-runtime journal document must be an object.");
  }
  if (!isExpectedAppDocument(
    normalized.value,
    expectedDocumentId,
    expectedTableId,
  )) {
    throw new Error("Exact-runtime journal document system fields are invalid.");
  }
  return normalized.value;
}

function isExpectedAppDocument(
  value: CanonicalFlarexRuntimeObjectV1,
  expectedDocumentId: string,
  expectedTableId: string | undefined,
): value is AppDocument {
  return (
    Object.hasOwn(value, "_id") &&
    value._id === expectedDocumentId &&
    isAppDocumentId(value._id) &&
    value._id.slice(0, value._id.indexOf(":")) ===
      expectedTableId &&
    Object.hasOwn(value, "_creationTime") &&
    creationTime(value._creationTime)
  );
}

function captureDeveloperFields(
  value: unknown,
  label: string,
): CanonicalFlarexRuntimeObjectV1 {
  const normalized = requireAppDocumentBounds(normalizeValue(
    value,
    `$.${label}`,
    0,
    new WeakSet(),
  ));
  if (!isPlainRecord(normalized.value)) {
    throw new Error(`${label} must be an object.`);
  }
  if (
    Object.hasOwn(normalized.value, "_id") ||
    Object.hasOwn(normalized.value, "_creationTime")
  ) {
    throw new Error(`${label} must not contain reserved system fields.`);
  }
  return normalized.value;
}

function capturePatch(
  value: unknown,
): Readonly<Record<string, CanonicalFlarexRuntimeValueV1 | undefined>> {
  if (!isPlainRecord(value)) {
    throw new Error("Patch must be a plain object.");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error("Patch must not contain symbol fields.");
  }
  const fields = Object.keys(value).sort();
  if (fields.length > MAX_OBJECT_FIELDS) {
    throw new Error("Patch has too many fields.");
  }
  const captured: Record<
    string,
    CanonicalFlarexRuntimeValueV1 | undefined
  > = {};
  let semanticBytes = 2;
  let nestingDepth = 1;
  for (const field of fields) {
    if (
      !isValidObjectField(field) ||
      field === "_id" ||
      field === "_creationTime"
    ) {
      throw new Error(`Patch field ${field} is invalid.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(`Patch field ${field} must be an enumerable data field.`);
    }
    if (descriptor.value === undefined) {
      semanticBytes += field.length + 2;
      assertValueSize(semanticBytes, "$.patch");
      Object.defineProperty(captured, field, {
        value: undefined,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      continue;
    }
    const child = normalizeValue(
      descriptor.value,
      `$.patch.${field}`,
      1,
      new WeakSet(),
    );
    semanticBytes += field.length + 1 + child.semanticBytes;
    assertValueSize(semanticBytes, "$.patch");
    nestingDepth = Math.max(nestingDepth, 1 + child.nestingDepth);
    if (nestingDepth > MAX_VALUE_NESTING) {
      throw new Error("Patch exceeds the exact-runtime nesting limit.");
    }
    Object.defineProperty(captured, field, {
      value: child.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(captured);
}

function requireAppDocumentBounds(
  normalized: NormalizedRuntimeValue,
): NormalizedRuntimeValue {
  assertAppDocumentSize(normalized.semanticBytes, "$.appDocument");
  if (normalized.nestingDepth > MAX_APP_DOCUMENT_NESTING) {
    throw new Error("Value exceeds the app-document nesting limit.");
  }
  return normalized;
}

function assertAppDocumentSize(size: number, path: string): void {
  if (size > MAX_APP_DOCUMENT_BYTES) {
    throw new Error(`${path} exceeds the app-document value byte limit.`);
  }
}

function isValidObjectField(field: unknown): field is string {
  if (
    typeof field !== "string" ||
    field.length > MAX_OBJECT_FIELD_BYTES ||
    field.startsWith("$")
  ) {
    return false;
  }
  for (let index = 0; index < field.length; index += 1) {
    const codeUnit = field.charCodeAt(index);
    if (codeUnit < 0x20 || codeUnit >= 0x7f) return false;
  }
  return true;
}

function ownEnumerableDataEntries(
  value: object,
  label: string,
): ReadonlyArray<readonly [string, unknown]> {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      throw new Error(`${label} must not contain symbol properties.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(`${label} must contain only enumerable data properties.`);
    }
    return [key, descriptor.value];
  });
}

function validateArrayShape(
  value: ReadonlyArray<unknown>,
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    throw new Error(`${label} must be dense and have no extra properties.`);
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new Error(`${label} contains a non-index array property.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(`${label} must contain enumerable data array items.`);
    }
  }
}

function exactRecord(
  value: unknown,
  fields: ReadonlyArray<string>,
  label: string,
): UnknownRecord {
  if (!isPlainRecord(value)) throw new Error(`Invalid ${label}.`);
  exactKeys(value, fields, label);
  return value;
}

function exactKeys(
  value: UnknownRecord,
  fields: ReadonlyArray<string>,
  label: string,
): void {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    throw new Error(`Invalid ${label} fields.`);
  }
  ownEnumerableDataEntries(value, label);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function withAncestor<T>(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
  body: () => T,
): T {
  if (ancestors.has(value)) throw new Error(`${path} must be acyclic.`);
  ancestors.add(value);
  try {
    return body();
  } finally {
    ancestors.delete(value);
  }
}

function assertValueSize(size: number, path: string): void {
  if (size > MAX_VALUE_BYTES) {
    throw new Error(`${path} exceeds the exact-runtime value byte limit.`);
  }
}

function assertNesting(nesting: number, path: string): void {
  if (nesting > MAX_VALUE_NESTING) {
    throw new Error(`${path} exceeds the exact-runtime nesting limit.`);
  }
}

function nonblankBoundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    textEncoder.encode(value).byteLength <= MAX_CONTEXT_TEXT_BYTES
  );
}

function nonblankPostgresText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\u0000")
  );
}

function creationTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 2 ** 53
  );
}

function isAppDocumentId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const separator = value.indexOf(":");
  if (
    separator <= 0 ||
    separator !== value.lastIndexOf(":") ||
    separator === value.length - 1
  ) {
    return false;
  }
  const tableText = value.slice(0, separator);
  if (!/^[1-9][0-9]*$/.test(tableText)) return false;
  const tableId = Number(tableText);
  if (
    !Number.isSafeInteger(tableId) ||
    tableId < 1 ||
    tableId > MAX_CATALOG_TABLE_ID
  ) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    .test(value.slice(separator + 1));
}
