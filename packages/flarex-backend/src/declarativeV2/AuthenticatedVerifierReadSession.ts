import {
  bytesEqualFullScan,
  copyBytes,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import type {
  DeclarativeV2ArtifactModulePathHandleV1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";

import type {
  SemanticArtifactV1CommandInput,
  SemanticArtifactV1FinalizedEvidence,
  SemanticArtifactV1UploadCore,
  SemanticArtifactV1UploadError,
} from "../semanticArtifactV1/UploadCore";
import {
  semanticArtifactV1RootConfigurationsEqual,
  type SemanticArtifactV1RootConfiguration,
} from "../semanticArtifactV1/RootConfiguration";
import type {
  SemanticArtifactV1FinalizedContent,
  SemanticArtifactV1FinalizedContentReader,
  SemanticArtifactV1FinalizedContentReaderError,
} from "../semanticArtifactV1/FinalizedContentReader";
import type {
  SemanticArtifactV1FinalizedSourceProof,
} from "../semanticArtifactV1/FinalizedSourceProof";
import {
  makeDeclarativeV2ContentReadBudgetTracker,
  type DeclarativeV2ContentReadBudgetInput,
  type DeclarativeV2ContentReadBudgetReceipt,
  type SourceArtifactV2FinalizedContent,
  type SourceArtifactV2FinalizedContentReader,
  type SourceArtifactV2FinalizedContentReaderError,
} from "../sourceArtifactV2/FinalizedContentReader";

const SESSION_MARKER = Symbol("DeclarativeV2AuthenticatedReadSession");
const MODULE_MARKER = Symbol("DeclarativeV2AuthenticatedModule");
const CURSOR_MARKER = Symbol("DeclarativeV2AuthenticatedByteCursor");

export interface DeclarativeV2AuthenticatedReadSessionV1 {
  readonly [SESSION_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedModuleV1 {
  readonly [MODULE_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedByteCursorV1 {
  readonly [CURSOR_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedReadSessionInputV1 {
  readonly command: SemanticArtifactV1CommandInput;
  readonly budget: DeclarativeV2ContentReadBudgetInput;
}

export interface DeclarativeV2AuthenticatedReadSessionReceiptV1 {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly semanticUploadId: string;
  readonly semanticGeneration: number;
  readonly semanticMutationFence: number;
  readonly semanticRootSha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly rootConfiguration: SemanticArtifactV1RootConfiguration;
  readonly moduleCount: number;
  readonly semanticByteLength: number;
  readonly budget: DeclarativeV2ContentReadBudgetReceipt;
}

export interface DeclarativeV2AuthenticatedModuleViewV1 {
  readonly ordinal: number;
  readonly roles: number;
  readonly frameSha256: Uint8Array;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: number;
  readonly path: DeclarativeV2ArtifactModulePathHandleV1;
}

export interface DeclarativeV2AuthenticatedCursorReadV1 {
  readonly status: "pending" | "complete";
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export class DeclarativeV2AuthenticatedReadSessionInputError extends Data.TaggedError(
  "DeclarativeV2AuthenticatedReadSessionInputError",
)<{
  readonly operation: "open" | "modules" | "module" | "cursor" | "read" | "close";
  readonly reason:
    | "invalidInput"
    | "invalidAuthority"
    | "wrongRequest"
    | "closed"
    | "legacyAuthority"
    | "packageAuthority"
    | "artifactAuthority";
}> {}

export class DeclarativeV2AuthenticatedReadSessionMismatchError extends Data.TaggedError(
  "DeclarativeV2AuthenticatedReadSessionMismatchError",
)<{
  readonly reason:
    | "sourceRoot"
      | "semanticRoot"
      | "semanticRootConfiguration"
      | "moduleCount"
    | "moduleOrdinal"
    | "modulePath";
  readonly ordinal?: number;
}> {}

export type DeclarativeV2AuthenticatedReadSessionOpenError =
  | DeclarativeV2AuthenticatedReadSessionInputError
  | DeclarativeV2AuthenticatedReadSessionMismatchError
  | SemanticArtifactV1UploadError
  | SourceArtifactV2FinalizedContentReaderError
  | SemanticArtifactV1FinalizedContentReaderError;

export type DeclarativeV2AuthenticatedReadSessionAccessError =
  | DeclarativeV2AuthenticatedReadSessionInputError
  | import("../sourceArtifactV2/FinalizedContentReader").DeclarativeV2ContentReadBudgetError;

export interface DeclarativeV2AuthenticatedReadSessionFactoryV1 {
  readonly open: (
    request: Request,
    proof: SemanticArtifactV1FinalizedSourceProof,
    input: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedReadSessionV1,
    DeclarativeV2AuthenticatedReadSessionOpenError,
    never
  >;
  readonly receipt: (
    request: Request,
    session: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedReadSessionReceiptV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly moduleCount: (
    request: Request,
    session: unknown,
  ) => Result.Result<number, DeclarativeV2AuthenticatedReadSessionAccessError>;
  readonly moduleAt: (
    request: Request,
    session: unknown,
    ordinal: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedModuleV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly moduleView: (
    request: Request,
    module: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedModuleViewV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly sourceCursor: (
    request: Request,
    module: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedByteCursorV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly semanticCursor: (
    request: Request,
    session: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedByteCursorV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly readCursor: (
    request: Request,
    cursor: unknown,
    maximumBytes: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedCursorReadV1,
    DeclarativeV2AuthenticatedReadSessionAccessError
  >;
  readonly close: (
    request: Request,
    session: unknown,
  ) => Result.Result<void, DeclarativeV2AuthenticatedReadSessionAccessError>;
}

interface SessionState {
  readonly request: Request;
  readonly finalized: SemanticArtifactV1FinalizedEvidence;
  readonly source: SourceArtifactV2FinalizedContent;
  readonly semantic: SemanticArtifactV1FinalizedContent;
  readonly budget: ReturnType<typeof makeDeclarativeV2ContentReadBudgetTracker> extends
    Result.Result<infer A, unknown> ? A : never;
  closed: boolean;
}

interface ModuleState {
  readonly session: object;
  readonly request: Request;
  readonly ordinal: number;
}

interface CursorState {
  readonly session: object;
  readonly request: Request;
  readonly bytes: Uint8Array;
  offset: number;
  closed: boolean;
}

function inputError(
  operation: DeclarativeV2AuthenticatedReadSessionInputError["operation"],
  reason: DeclarativeV2AuthenticatedReadSessionInputError["reason"],
): DeclarativeV2AuthenticatedReadSessionInputError {
  return new DeclarativeV2AuthenticatedReadSessionInputError({
    operation,
    reason,
  });
}

function mismatch(
  reason: DeclarativeV2AuthenticatedReadSessionMismatchError["reason"],
  ordinal?: number,
): DeclarativeV2AuthenticatedReadSessionMismatchError {
  return new DeclarativeV2AuthenticatedReadSessionMismatchError({
    reason,
    ...(ordinal === undefined ? {} : { ordinal }),
  });
}

function captureOwnDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isNonArrayRecord(value)) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      !ownKeys.every(key => typeof key === "string" && keys.includes(key))
    ) {
      return undefined;
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return undefined;
      }
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return undefined;
  }
}

function captureCommand(
  value: unknown,
): SemanticArtifactV1CommandInput | undefined {
  const record = captureOwnDataRecord(value, [
    "semanticUploadId",
    "deploymentId",
    "expectedGeneration",
    "expectedMutationFence",
    "commandId",
    "admission",
  ]);
  if (record === undefined) return undefined;
  if (
    typeof record.semanticUploadId !== "string" ||
    record.semanticUploadId.length === 0 ||
    typeof record.deploymentId !== "string" ||
    record.deploymentId.length === 0 ||
    typeof record.expectedGeneration !== "number" ||
    !Number.isSafeInteger(record.expectedGeneration) ||
    record.expectedGeneration < 1 ||
    typeof record.expectedMutationFence !== "number" ||
    !Number.isSafeInteger(record.expectedMutationFence) ||
    record.expectedMutationFence < 1 ||
    typeof record.commandId !== "string" ||
    record.commandId.length === 0
  ) {
    return undefined;
  }
  const admission = captureOwnDataRecord(record.admission, [
    "calls",
    "blockBytes",
    "canonicalBytes",
    "frameBytes",
    "hashBytes",
    "timeMilliseconds",
  ]);
  if (
    admission === undefined ||
    !Object.values(admission).every(isNonNegativeSafeInteger)
  ) {
    return undefined;
  }
  return Object.freeze({
    semanticUploadId: record.semanticUploadId,
    deploymentId: record.deploymentId,
    expectedGeneration: record.expectedGeneration,
    expectedMutationFence: record.expectedMutationFence,
    commandId: record.commandId,
    admission: Object.freeze({
      calls: admission.calls as number,
      blockBytes: admission.blockBytes as number,
      canonicalBytes: admission.canonicalBytes as number,
      frameBytes: admission.frameBytes as number,
      hashBytes: admission.hashBytes as number,
      timeMilliseconds: admission.timeMilliseconds as number,
    }),
  });
}

function captureInput(
  value: unknown,
): Result.Result<
  Readonly<{
    readonly command: SemanticArtifactV1CommandInput;
    readonly budget: unknown;
  }>,
  DeclarativeV2AuthenticatedReadSessionInputError
> {
  const record = captureOwnDataRecord(value, ["command", "budget"]);
  if (record === undefined) {
    try {
      if (isNonArrayRecord(value)) {
        const rejectedAuthorityFields = [
          ["executionArtifactRef", "legacyAuthority"],
          ["packageSha256", "packageAuthority"],
          ["artifactSha256", "artifactAuthority"],
        ] as const;
        for (const [key, reason] of rejectedAuthorityFields) {
          if (Object.getOwnPropertyDescriptor(value, key) !== undefined) {
            return Result.fail(inputError("open", reason));
          }
        }
      }
    } catch {
      return Result.fail(inputError("open", "invalidInput"));
    }
    return Result.fail(inputError("open", "invalidInput"));
  }
  const command = captureCommand(record.command);
  if (command === undefined) {
    return Result.fail(inputError("open", "invalidInput"));
  }
  return Result.succeed(Object.freeze({
    command,
    // The budget tracker owns hostile nested-frame capture and its exact
    // createBudget/invalidInput failure. Carry this own data value without
    // dispatching into it before that boundary.
    budget: record.budget,
  }));
}

export function makeDeclarativeV2AuthenticatedReadSessionFactoryV1(options: {
  readonly finalizedSemantic: Pick<SemanticArtifactV1UploadCore, "readFinalized">;
  readonly source: SourceArtifactV2FinalizedContentReader;
  readonly semantic: SemanticArtifactV1FinalizedContentReader;
}): DeclarativeV2AuthenticatedReadSessionFactoryV1 {
  const sessions = new WeakMap<object, SessionState>();
  const modules = new WeakMap<object, ModuleState>();
  const cursors = new WeakMap<object, CursorState>();

  const getSession = (
    request: Request,
    value: unknown,
    operation: DeclarativeV2AuthenticatedReadSessionInputError["operation"],
  ): Result.Result<SessionState, DeclarativeV2AuthenticatedReadSessionInputError> => {
    const state = value !== null && typeof value === "object"
      ? sessions.get(value)
      : undefined;
    if (state === undefined) {
      return Result.fail(inputError(operation, "invalidAuthority"));
    }
    if (state.request !== request) {
      return Result.fail(inputError(operation, "wrongRequest"));
    }
    if (state.closed) {
      return Result.fail(inputError(operation, "closed"));
    }
    return Result.succeed(state);
  };

  const open: DeclarativeV2AuthenticatedReadSessionFactoryV1["open"] =
    Effect.fn("DeclarativeV2AuthenticatedReadSession.open")(
      (
        request,
        proof,
        rawInput,
      ): Effect.Effect<
        DeclarativeV2AuthenticatedReadSessionV1,
        DeclarativeV2AuthenticatedReadSessionOpenError,
        never
      > =>
        Effect.suspend(() => Effect.fromResult(captureInput(rawInput))).pipe(
          Effect.flatMap(captured =>
          Effect.gen(function* () {
            const budget = yield* Effect.fromResult(
              makeDeclarativeV2ContentReadBudgetTracker(captured.budget),
            );
            const admission = captured.command.admission;
            yield* Effect.fromResult(
              budget.admit("calls", BigInt(admission.calls)),
            );
            yield* Effect.fromResult(budget.admit("objectCalls", 1n));
            yield* Effect.fromResult(
              budget.admit("objectBodyBytes", BigInt(admission.blockBytes)),
            );
            yield* Effect.fromResult(
              budget.admit(
                "canonicalBytes",
                BigInt(admission.canonicalBytes),
              ),
            );
            yield* Effect.fromResult(
              budget.admit("frameBytes", BigInt(admission.frameBytes)),
            );
            yield* Effect.fromResult(
              budget.admit("hashBytes", BigInt(admission.hashBytes)),
            );
            yield* Effect.fromResult(
              budget.admit(
                "elapsedMilliseconds",
                BigInt(admission.timeMilliseconds),
              ),
            );
            // readFinalized synchronously claims the request-bound C2 proof
            // before it performs any ID creation, hashing, SQLite, or R2 work.
            const finalized = yield* options.finalizedSemantic.readFinalized(
              request,
              proof,
              captured.command,
            );
            yield* Effect.fromResult(
              budget.charge("calls", BigInt(finalized.usage.calls)),
            );
            yield* Effect.fromResult(
              budget.charge("objectCalls", 1n),
            );
            yield* Effect.fromResult(
              budget.charge(
                "objectBodyBytes",
                BigInt(finalized.usage.blockBytes),
              ),
            );
            yield* Effect.fromResult(
              budget.charge(
                "canonicalBytes",
                BigInt(finalized.usage.canonicalBytes),
              ),
            );
            yield* Effect.fromResult(
              budget.charge("frameBytes", BigInt(finalized.usage.frameBytes)),
            );
            yield* Effect.fromResult(
              budget.charge("hashBytes", BigInt(finalized.usage.hashBytes)),
            );
            yield* Effect.fromResult(
              budget.charge(
                "elapsedMilliseconds",
                BigInt(finalized.usage.timeMilliseconds),
              ),
            );
            const source = yield* options.source.read(
              finalized.sourceRootSha256,
              budget,
            );
            const semantic = yield* options.semantic.read(
              finalized.semanticRootSha256,
              finalized.sourceRootSha256,
              budget,
            );
            if (
              !semanticArtifactV1RootConfigurationsEqual(
                finalized.rootConfiguration,
                semantic.root,
              )
            ) {
              return yield* Effect.fail(
                mismatch("semanticRootConfiguration"),
              );
            }
            if (source.modules.length !== semantic.modules.length) {
              return yield* Effect.fail(mismatch("moduleCount"));
            }
            for (let ordinal = 0; ordinal < source.modules.length; ordinal += 1) {
              const sourceModule = source.modules[ordinal]!;
              const semanticModule = semantic.modules[ordinal]!;
              if (sourceModule.ordinal !== ordinal) {
                return yield* Effect.fail(mismatch("moduleOrdinal", ordinal));
              }
              if (
                !bytesEqualFullScan(
                  sourceModule.pathBytes,
                  semanticModule.pathBytes,
                )
              ) {
                return yield* Effect.fail(mismatch("modulePath", ordinal));
              }
            }
            const session = Object.freeze(
              Object.defineProperty({}, SESSION_MARKER, {
                value: true,
                enumerable: false,
                configurable: false,
                writable: false,
              }),
            ) as DeclarativeV2AuthenticatedReadSessionV1;
            sessions.set(session, {
              request,
              finalized,
              source,
              semantic,
              budget,
              closed: false,
            });
            return session;
          })
          ),
        ),
    );

  const receipt: DeclarativeV2AuthenticatedReadSessionFactoryV1["receipt"] = (
    request,
    session,
  ) =>
    Result.map(getSession(request, session, "read"), state => {
      const value = state.finalized;
      return Object.freeze({
        projectId: value.projectId,
        deploymentId: value.deploymentId,
        deploymentCreatedAt: value.deploymentCreatedAt,
        sourceUploadId: value.sourceUploadId,
        sourceGeneration: value.sourceGeneration,
        sourceMutationFence: value.sourceMutationFence,
        sourceRootSha256: copyBytes(value.sourceRootSha256),
        sourceSelectorSha256: copyBytes(value.sourceSelectorSha256),
        semanticUploadId: value.semanticUploadId,
        semanticGeneration: value.semanticGeneration,
        semanticMutationFence: value.semanticMutationFence,
        semanticRootSha256: copyBytes(value.semanticRootSha256),
        semanticSelectorSha256: copyBytes(value.semanticSelectorSha256),
        semanticAttemptIdentitySha256: copyBytes(
          value.semanticAttemptIdentitySha256,
        ),
        rootConfiguration: Object.freeze({
          ...value.rootConfiguration,
        }),
        moduleCount: state.source.modules.length,
        semanticByteLength: state.semantic.streamBytes.byteLength,
        budget: state.budget.receipt(),
      });
    });

  const moduleCount: DeclarativeV2AuthenticatedReadSessionFactoryV1["moduleCount"] =
    (request, session) =>
      Result.map(
        getSession(request, session, "modules"),
        state => state.source.modules.length,
      );

  const moduleAt: DeclarativeV2AuthenticatedReadSessionFactoryV1["moduleAt"] = (
    request,
    session,
    ordinal,
  ) =>
    Result.gen(function* () {
      const state = yield* getSession(request, session, "module");
      if (
        !isNonNegativeSafeInteger(ordinal) ||
        ordinal >= state.source.modules.length
      ) {
        return yield* Result.fail(inputError("module", "invalidInput"));
      }
      const handle = Object.freeze(
        Object.defineProperty({}, MODULE_MARKER, {
          value: true,
          enumerable: false,
          configurable: false,
          writable: false,
        }),
      ) as DeclarativeV2AuthenticatedModuleV1;
      modules.set(handle, {
        session: session as object,
        request,
        ordinal,
      });
      return handle;
    });

  const getModule = (
    request: Request,
    value: unknown,
  ): Result.Result<
    Readonly<{
      readonly state: SessionState;
      readonly session: object;
      readonly ordinal: number;
    }>,
    DeclarativeV2AuthenticatedReadSessionAccessError
  > => {
    const moduleState = value !== null && typeof value === "object"
      ? modules.get(value)
      : undefined;
    if (moduleState === undefined) {
      return Result.fail(inputError("module", "invalidAuthority"));
    }
    if (moduleState.request !== request) {
      return Result.fail(inputError("module", "wrongRequest"));
    }
    return Result.map(
      getSession(request, moduleState.session, "module"),
      state => Object.freeze({
        state,
        session: moduleState.session,
        ordinal: moduleState.ordinal,
      }),
    );
  };

  const moduleView: DeclarativeV2AuthenticatedReadSessionFactoryV1["moduleView"] =
    (request, module) =>
      Result.map(getModule(request, module), ({ state, ordinal }) => {
        const value = state.source.modules[ordinal]!;
        return Object.freeze({
          ordinal,
          roles: value.roles,
          frameSha256: copyBytes(value.frameSha256),
          sourceSha256: copyBytes(value.sourceSha256),
          sourceByteLength: value.sourceBytes.byteLength,
          path: value.path,
        });
      });

  const makeCursor = (
    request: Request,
    session: object,
    bytes: Uint8Array,
  ): DeclarativeV2AuthenticatedByteCursorV1 => {
    const cursor = Object.freeze(
      Object.defineProperty({}, CURSOR_MARKER, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      }),
    ) as DeclarativeV2AuthenticatedByteCursorV1;
    cursors.set(cursor, {
      session,
      request,
      bytes,
      offset: 0,
      closed: false,
    });
    return cursor;
  };

  const sourceCursor: DeclarativeV2AuthenticatedReadSessionFactoryV1["sourceCursor"] =
    (request, module) =>
      Result.map(getModule(request, module), ({ state, session, ordinal }) =>
        makeCursor(
          request,
          session,
          state.source.modules[ordinal]!.sourceBytes,
        ));

  const semanticCursor: DeclarativeV2AuthenticatedReadSessionFactoryV1["semanticCursor"] =
    (request, session) =>
      Result.map(
        getSession(request, session, "cursor"),
        state => makeCursor(
          request,
          session as object,
          state.semantic.streamBytes,
        ),
      );

  const readCursor: DeclarativeV2AuthenticatedReadSessionFactoryV1["readCursor"] =
    (request, cursor, maximumBytes) =>
      Result.gen(function* () {
        const state = cursor !== null && typeof cursor === "object"
          ? cursors.get(cursor)
          : undefined;
        if (state === undefined) {
          return yield* Result.fail(inputError("cursor", "invalidAuthority"));
        }
        if (state.request !== request) {
          return yield* Result.fail(inputError("cursor", "wrongRequest"));
        }
        if (state.closed) {
          return yield* Result.fail(inputError("cursor", "closed"));
        }
        const session = yield* getSession(request, state.session, "cursor");
        if (!isNonNegativeSafeInteger(maximumBytes) || maximumBytes === 0) {
          return yield* Result.fail(inputError("read", "invalidInput"));
        }
        const remaining = state.bytes.byteLength - state.offset;
        const length = Math.min(remaining, maximumBytes);
        yield* session.budget.charge("calls", 1n);
        yield* session.budget.charge("outputBytes", BigInt(length));
        const bytes = state.bytes.slice(state.offset, state.offset + length);
        state.offset += length;
        if (state.offset === state.bytes.byteLength) state.closed = true;
        return Object.freeze({
          status: state.closed ? "complete" as const : "pending" as const,
          offset: state.offset,
          bytes,
        });
      });

  const close: DeclarativeV2AuthenticatedReadSessionFactoryV1["close"] = (
    request,
    session,
  ) =>
    Result.map(getSession(request, session, "close"), state => {
      state.closed = true;
    });

  return Object.freeze({
    open,
    receipt,
    moduleCount,
    moduleAt,
    moduleView,
    sourceCursor,
    semanticCursor,
    readCursor,
    close,
  });
}
