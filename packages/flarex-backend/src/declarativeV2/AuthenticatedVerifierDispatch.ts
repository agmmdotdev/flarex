import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import {
  canonicalPrivateAnalyzerHandshakeRequestV1,
  decodePrivateAnalyzerHandshakeResponseV1,
  type PrivateAnalyzerReleaseTupleV1,
} from "@flarex/analysis/internal/private-analyzer-release-v1";
import {
  canonicalPrivateAnalyzerVerificationModuleHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1,
  canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1,
  decodePrivateAnalyzerVerificationFrameV1,
  decodePrivateAnalyzerVerificationResponseHeaderV1,
  encodePrivateAnalyzerVerificationFrameV1,
  PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
  PRIVATE_ANALYZER_VERIFICATION_PATH_V1,
  sha256HexFromBytesV1,
  installedPrivateAnalyzerVerifierIdentitiesV1,
  type PrivateAnalyzerVerificationFrameKindV1,
  type PrivateAnalyzerVerificationModuleHeaderV1,
  type PrivateAnalyzerVerificationRequestHeaderV1,
  type PrivateAnalyzerVerificationResponseHeaderV1,
} from "@flarex/analysis/internal/private-analyzer-verification-v1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";
import { Data, Effect, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import type {
  SemanticArtifactV1FinalizedSourceProof,
} from "../semanticArtifactV1/FinalizedSourceProof";
import type {
  DeclarativeV2AuthenticatedReadSessionFactoryV1,
  DeclarativeV2AuthenticatedReadSessionInputV1,
  DeclarativeV2AuthenticatedReadSessionOpenError,
} from "./AuthenticatedVerifierReadSession";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const RESULT_MARKER = Symbol("DeclarativeV2AuthenticatedVerifierResult");
const CURSOR_MARKER = Symbol("DeclarativeV2AuthenticatedVerifierEvidenceCursor");

export interface DeclarativeV2AuthenticatedVerifierResultV1 {
  readonly [RESULT_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedVerifierEvidenceCursorV1 {
  readonly [CURSOR_MARKER]: true;
}

export interface DeclarativeV2AuthenticatedVerifierDispatchInputV1 {
  readonly readSession: DeclarativeV2AuthenticatedReadSessionInputV1;
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
  readonly moduleBudgets: ReadonlyArray<
    DeclarativeV2AuthenticatedVerifierComponentBudgetV1
  >;
  readonly linkerBudget: DeclarativeV2AuthenticatedVerifierComponentBudgetV1;
  readonly hostBudget: DeclarativeV2AuthenticatedVerifierComponentBudgetV1;
  readonly maximumResponseBytes: number;
}

export interface DeclarativeV2AuthenticatedVerifierComponentBudgetV1 {
  readonly maximums: DeclarativeV2VerifierBudgetFrameV2;
  readonly required: DeclarativeV2VerifierBudgetFrameV2;
}

export interface DeclarativeV2AuthenticatedVerifierResultReceiptV1 {
  readonly requestIdentitySha256: string;
  readonly resultIdentitySha256: string;
  readonly evidenceSha256: string;
  readonly verified: boolean;
  readonly moduleCount: number;
  readonly evidenceCount: number;
  readonly diagnosticCount: number;
  readonly responseBytes: number;
}

export interface DeclarativeV2AuthenticatedVerifierEvidenceReadV1 {
  readonly status: "pending" | "complete";
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export class DeclarativeV2AuthenticatedVerifierDispatchError extends Data.TaggedError(
  "DeclarativeV2AuthenticatedVerifierDispatchError",
)<{
  readonly operation:
    | "dispatch"
    | "handshake"
    | "request"
    | "response"
    | "access";
  readonly reason:
    | "invalidInput"
    | "invalidAuthority"
    | "wrongRequest"
    | "closed"
    | "budgetExceeded"
    | "transportFailed"
    | "transportUncertain"
    | "identityMismatch"
    | "malformed"
    | "rejected";
}> {}

const foreignCauses = new WeakMap<
  DeclarativeV2AuthenticatedVerifierDispatchError,
  unknown
>();

export function declarativeV2AuthenticatedVerifierDispatchCause(
  error: DeclarativeV2AuthenticatedVerifierDispatchError,
): unknown {
  return foreignCauses.get(error);
}

export interface DeclarativeV2AuthenticatedVerifierDispatchFactoryV1 {
  readonly dispatch: (
    request: Request,
    proof: SemanticArtifactV1FinalizedSourceProof,
    input: unknown,
  ) => Effect.Effect<
    DeclarativeV2AuthenticatedVerifierResultV1,
    | DeclarativeV2AuthenticatedReadSessionOpenError
    | DeclarativeV2AuthenticatedVerifierDispatchError,
    never
  >;
  readonly receipt: (
    request: Request,
    result: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedVerifierResultReceiptV1,
    DeclarativeV2AuthenticatedVerifierDispatchError
  >;
  readonly evidenceCursor: (
    request: Request,
    result: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedVerifierEvidenceCursorV1,
    DeclarativeV2AuthenticatedVerifierDispatchError
  >;
  readonly readEvidence: (
    request: Request,
    cursor: unknown,
    maximumBytes: unknown,
  ) => Result.Result<
    DeclarativeV2AuthenticatedVerifierEvidenceReadV1,
    DeclarativeV2AuthenticatedVerifierDispatchError
  >;
  readonly close: (
    request: Request,
    result: unknown,
  ) => Result.Result<void, DeclarativeV2AuthenticatedVerifierDispatchError>;
}

interface ResultStateV1 {
  readonly request: Request;
  readonly receipt: DeclarativeV2AuthenticatedVerifierResultReceiptV1;
  readonly evidence: Uint8Array;
  closed: boolean;
}

interface CursorStateV1 {
  readonly request: Request;
  readonly result: object;
  offset: number;
  closed: boolean;
}

function dispatchError(
  operation: DeclarativeV2AuthenticatedVerifierDispatchError["operation"],
  reason: DeclarativeV2AuthenticatedVerifierDispatchError["reason"],
  cause?: unknown,
): DeclarativeV2AuthenticatedVerifierDispatchError {
  const error = new DeclarativeV2AuthenticatedVerifierDispatchError({
    operation,
    reason,
  });
  if (cause !== undefined) foreignCauses.set(error, cause);
  return error;
}

export function makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1(
  options: {
    readonly sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1;
    readonly analyzer: {
      readonly fetch: (request: Request) => Promise<Response>;
    };
    readonly expectedRelease: PrivateAnalyzerReleaseTupleV1;
    readonly sha256: (
      bytes: Uint8Array,
    ) => Effect.Effect<Uint8Array, never, never>;
  },
): DeclarativeV2AuthenticatedVerifierDispatchFactoryV1 {
  const results = new WeakMap<object, ResultStateV1>();
  const cursors = new WeakMap<object, CursorStateV1>();

  const dispatch = Effect.fn("DeclarativeV2VerifierDispatch.dispatch")(
    function (
      request: Request,
      proof: SemanticArtifactV1FinalizedSourceProof,
      rawInput: unknown,
    ) {
      return Effect.gen(function* () {
        const input = yield* Effect.fromResult(captureInput(rawInput));
        // The one-shot C2 proof is consumed here before any dispatch identity,
        // hashing, Fetcher call, or analyzer-side work can begin.
        const session = yield* options.sessions.open(
          request,
          proof,
          input.readSession,
        );
        yield* Effect.addFinalizer(() =>
          Effect.fromResult(options.sessions.close(request, session)).pipe(
            Effect.orDie,
          ),
        );
      const receipt = yield* Effect.fromResult(
        options.sessions.receipt(request, session),
      );
      if (input.moduleBudgets.length !== receipt.moduleCount) {
        return yield* dispatchError("request", "budgetExceeded");
      }
      const release = yield* freshHandshake(options, request.signal);

      const modules: Array<Readonly<{
        readonly header: PrivateAnalyzerVerificationModuleHeaderV1;
        readonly headerBytes: Uint8Array;
        readonly sourceBytes: Uint8Array;
      }>> = [];
      for (let ordinal = 0; ordinal < receipt.moduleCount; ordinal += 1) {
        const module = yield* Effect.fromResult(
          options.sessions.moduleAt(request, session, ordinal),
        );
        const view = yield* Effect.fromResult(
          options.sessions.moduleView(request, module),
        );
        const pathBytes = yield* Effect.fromResult(modulePathBytes(view.path));
        const modulePath = yield* Effect.fromResult(decodePath(pathBytes));
        const sourceCursor = yield* Effect.fromResult(
          options.sessions.sourceCursor(request, module),
        );
        const sourceBytes = yield* Effect.fromResult(readExactSessionCursor(
          options.sessions,
          request,
          sourceCursor,
          view.sourceByteLength,
        ));
        const sourceSha256 = yield* options.sha256(sourceBytes);
        if (!bytesEqualFullScan(sourceSha256, view.sourceSha256)) {
          return yield* dispatchError("request", "identityMismatch");
        }
        const sourceHex = yield* Effect.fromResult(
          sha256HexFromBytesV1(view.sourceSha256).pipe(
            Result.mapError(() => dispatchError("request", "malformed")),
          ),
        );
        const frameHex = yield* Effect.fromResult(
          sha256HexFromBytesV1(view.frameSha256).pipe(
            Result.mapError(() => dispatchError("request", "malformed")),
          ),
        );
        const header = Object.freeze({
          kind: "private_analyzer_verification_module_v1",
          ordinal,
          roles: view.roles,
          modulePath,
          sourceByteLength: sourceBytes.byteLength,
          sourceSha256: sourceHex,
          frameSha256: frameHex,
          maximums: input.moduleBudgets[ordinal]!.maximums,
          required: input.moduleBudgets[ordinal]!.required,
        } satisfies PrivateAnalyzerVerificationModuleHeaderV1);
        modules.push(Object.freeze({
          header,
          headerBytes:
            canonicalPrivateAnalyzerVerificationModuleHeaderV1(header),
          sourceBytes,
        }));
      }
      const semanticCursor = yield* Effect.fromResult(
        options.sessions.semanticCursor(request, session),
      );
      const semanticBytes = yield* Effect.fromResult(readExactSessionCursor(
        options.sessions,
        request,
        semanticCursor,
        receipt.semanticByteLength,
      ));
      const totalSourceBytes = modules.reduce(
        (total, module) => total + BigInt(module.sourceBytes.byteLength),
        0n,
      );
      if (
        input.moduleBudgets.length !== modules.length ||
        !componentBudgetsFit(
          input,
          modules.map((module, index) => Object.freeze({
            budget: input.moduleBudgets[index]!,
            sourceBytes: BigInt(module.sourceBytes.byteLength),
          })),
          BigInt(semanticBytes.byteLength),
        ) ||
        input.required.sourceBytes !== totalSourceBytes ||
        input.required.semanticBytes !== BigInt(semanticBytes.byteLength) ||
        input.maximums.modules < input.required.modules ||
        input.maximums.sourceBytes < input.required.sourceBytes ||
        input.maximums.semanticBytes < input.required.semanticBytes
      ) {
        return yield* dispatchError("request", "budgetExceeded");
      }
      const moduleManifestBytes = concatenate(
        modules.map(module => module.headerBytes),
      );
      const moduleManifestSha256 = yield* options.sha256(moduleManifestBytes);
      const semanticContentSha256 = yield* options.sha256(semanticBytes);
      const pins = yield* Effect.fromResult(receiptPins(receipt));
      const moduleManifestHex = yield* Effect.fromResult(
        sha256HexFromBytesV1(moduleManifestSha256).pipe(
          Result.mapError(() => dispatchError("request", "malformed")),
        ),
      );
      const semanticContentHex = yield* Effect.fromResult(
        sha256HexFromBytesV1(semanticContentSha256).pipe(
          Result.mapError(() => dispatchError("request", "malformed")),
        ),
      );
      const headerWithoutIdentity = Object.freeze({
        kind: "private_analyzer_verification_request_v1" as const,
        protocolIdentity:
          "flarex.private-source-analyzer-verification.v1" as const,
        protocolVersion: 1 as const,
        release,
        moduleManifestSha256: moduleManifestHex,
        semanticContentSha256: semanticContentHex,
        pins,
        moduleCount: modules.length,
        semanticByteLength: semanticBytes.byteLength,
        maximums: input.maximums,
        required: input.required,
        linkerMaximums: input.linkerBudget.maximums,
        linkerRequired: input.linkerBudget.required,
        hostMaximums: input.hostBudget.maximums,
        hostRequired: input.hostBudget.required,
        verifier: installedPrivateAnalyzerVerifierIdentitiesV1(),
      });
      const requestIdentity = yield* options.sha256(
        canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1(
          headerWithoutIdentity,
        ),
      );
      const requestIdentitySha256 = yield* Effect.fromResult(
        sha256HexFromBytesV1(requestIdentity).pipe(
          Result.mapError(() => dispatchError("request", "malformed")),
        ),
      );
      const header = Object.freeze({
        ...headerWithoutIdentity,
        requestIdentitySha256,
      } satisfies PrivateAnalyzerVerificationRequestHeaderV1);
      const requestFrames: Uint8Array[] = [];
      requestFrames.push(yield* Effect.fromResult(frame(
        "requestHeader",
        canonicalPrivateAnalyzerVerificationRequestHeaderV1(header),
      )));
      for (const module of modules) {
        requestFrames.push(yield* Effect.fromResult(
          frame("moduleHeader", module.headerBytes),
        ));
        for (const bytes of chunk(module.sourceBytes)) {
          requestFrames.push(yield* Effect.fromResult(
            frame("moduleBytes", bytes),
          ));
        }
      }
      for (const bytes of chunk(semanticBytes)) {
        requestFrames.push(yield* Effect.fromResult(
          frame("semanticBytes", bytes),
        ));
      }
      requestFrames.push(yield* Effect.fromResult(
        frame("requestEnd", new Uint8Array(0)),
      ));
      const verificationRequestInit: RequestInit & {
        readonly duplex: "half";
      } = {
        method: "POST",
        headers: {
          "content-type": PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
          "cache-control": "no-store",
        },
        body: frameStream(requestFrames),
        duplex: "half",
      };
      const response = yield* analyzerFetch(
        options.analyzer,
        new Request(
          `https://flarex-analyzer.internal${PRIVATE_ANALYZER_VERIFICATION_PATH_V1}`,
          verificationRequestInit,
        ),
      );
      if (
        response.status !== 200 ||
        response.headers.get("content-type") !==
          PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1
      ) {
        return yield* dispatchError("response", "rejected");
      }
      const responseBytes = yield* readBoundedResponse(
        response,
        input.maximumResponseBytes,
      );
      const decoded = yield* Effect.fromResult(
        decodeResponse(responseBytes, requestIdentitySha256),
      );
      const evidenceSha = yield* options.sha256(decoded.evidence);
      const evidenceHex = yield* Effect.fromResult(
        sha256HexFromBytesV1(evidenceSha).pipe(
          Result.mapError(() => dispatchError("response", "malformed")),
        ),
      );
      if (evidenceHex !== decoded.header.evidenceSha256) {
        return yield* dispatchError("response", "identityMismatch");
      }
      const {
        resultIdentitySha256: _receivedResultIdentitySha256,
        ...resultIdentityFields
      } = decoded.header;
      const expectedResult = yield* options.sha256(
        canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1(
          resultIdentityFields,
        ),
      );
      const expectedResultHex = yield* Effect.fromResult(
        sha256HexFromBytesV1(expectedResult).pipe(
          Result.mapError(() => dispatchError("response", "malformed")),
        ),
      );
      if (expectedResultHex !== decoded.header.resultIdentitySha256) {
        return yield* dispatchError("response", "identityMismatch");
      }
      const result = Object.freeze(
        Object.defineProperty({}, RESULT_MARKER, {
          value: true,
          enumerable: false,
        }),
      ) as DeclarativeV2AuthenticatedVerifierResultV1;
      results.set(result, {
        request,
        receipt: Object.freeze({
          requestIdentitySha256,
          resultIdentitySha256: decoded.header.resultIdentitySha256,
          evidenceSha256: decoded.header.evidenceSha256,
          verified: decoded.header.verified,
          moduleCount: decoded.header.moduleCount,
          evidenceCount: decoded.header.evidenceCount,
          diagnosticCount: decoded.header.diagnosticCount,
          responseBytes: responseBytes.byteLength,
        }),
        evidence: decoded.evidence,
        closed: false,
      });
        return result;
      }).pipe(Effect.scoped);
    },
  );

  const getResult = (
    request: Request,
    raw: unknown,
  ): Result.Result<ResultStateV1, DeclarativeV2AuthenticatedVerifierDispatchError> => {
    const state = raw !== null && typeof raw === "object"
      ? results.get(raw)
      : undefined;
    return state === undefined
      ? Result.fail(dispatchError("access", "invalidAuthority"))
      : state.request !== request
      ? Result.fail(dispatchError("access", "wrongRequest"))
      : state.closed
      ? Result.fail(dispatchError("access", "closed"))
      : Result.succeed(state);
  };

  const receipt: DeclarativeV2AuthenticatedVerifierDispatchFactoryV1["receipt"] =
    (request, result) => Result.map(getResult(request, result), state => state.receipt);

  const evidenceCursor:
    DeclarativeV2AuthenticatedVerifierDispatchFactoryV1["evidenceCursor"] =
      (request, result) =>
        Result.map(getResult(request, result), () => {
          const cursor = Object.freeze(
            Object.defineProperty({}, CURSOR_MARKER, {
              value: true,
              enumerable: false,
            }),
          ) as DeclarativeV2AuthenticatedVerifierEvidenceCursorV1;
          cursors.set(cursor, {
            request,
            result: result as object,
            offset: 0,
            closed: false,
          });
          return cursor;
        });

  const readEvidence:
    DeclarativeV2AuthenticatedVerifierDispatchFactoryV1["readEvidence"] =
      (request, cursor, maximumBytes) =>
        Result.gen(function* () {
          const state = cursor !== null && typeof cursor === "object"
            ? cursors.get(cursor)
            : undefined;
          if (state === undefined) {
            return yield* Result.fail(
              dispatchError("access", "invalidAuthority"),
            );
          }
          if (state.request !== request) {
            return yield* Result.fail(dispatchError("access", "wrongRequest"));
          }
          if (
            state.closed ||
            !isNonNegativeSafeInteger(maximumBytes) ||
            maximumBytes === 0
          ) return yield* Result.fail(dispatchError(
            "access",
            state.closed ? "closed" : "invalidInput",
          ));
          const result = yield* getResult(request, state.result);
          const length = Math.min(
            maximumBytes,
            result.evidence.byteLength - state.offset,
          );
          const bytes = result.evidence.slice(state.offset, state.offset + length);
          state.offset += length;
          state.closed = state.offset === result.evidence.byteLength;
          return Object.freeze({
            status: state.closed ? "complete" as const : "pending" as const,
            offset: state.offset,
            bytes,
          });
        });

  const close: DeclarativeV2AuthenticatedVerifierDispatchFactoryV1["close"] =
    (request, result) =>
      Result.map(getResult(request, result), state => {
        state.closed = true;
      });

  return Object.freeze({
    dispatch,
    receipt,
    evidenceCursor,
    readEvidence,
    close,
  });
}

function captureInput(
  value: unknown,
): Result.Result<
  DeclarativeV2AuthenticatedVerifierDispatchInputV1,
  DeclarativeV2AuthenticatedVerifierDispatchError
> {
  if (value === null || typeof value !== "object") {
    return Result.fail(dispatchError("dispatch", "invalidInput"));
  }
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 7 ||
      ![
        "readSession",
        "maximums",
        "required",
        "moduleBudgets",
        "linkerBudget",
        "hostBudget",
        "maximumResponseBytes",
      ].every(
        key => Object.hasOwn(value, key),
      )
    ) return Result.fail(dispatchError("dispatch", "invalidInput"));
    const readSession = dataValue(value, "readSession");
    const maximums = captureBudget(dataValue(value, "maximums"), "command_budget");
    const required = captureBudget(dataValue(value, "required"), "attempt_usage");
    const moduleBudgets = captureComponentBudgets(
      dataValue(value, "moduleBudgets"),
    );
    const linkerBudget = captureComponentBudget(
      dataValue(value, "linkerBudget"),
    );
    const hostBudget = captureComponentBudget(dataValue(value, "hostBudget"));
    const maximumResponseBytes = dataValue(value, "maximumResponseBytes");
    if (
      maximums === undefined ||
      required === undefined ||
      moduleBudgets === undefined ||
      linkerBudget === undefined ||
      hostBudget === undefined ||
      !isNonNegativeSafeInteger(maximumResponseBytes) ||
      maximumResponseBytes === 0
    ) return Result.fail(dispatchError("dispatch", "invalidInput"));
    return Result.succeed(Object.freeze({
      readSession: readSession as DeclarativeV2AuthenticatedReadSessionInputV1,
      maximums,
      required,
      moduleBudgets,
      linkerBudget,
      hostBudget,
      maximumResponseBytes,
    }));
  } catch {
    return Result.fail(dispatchError("dispatch", "invalidInput"));
  }
}

function componentBudgetsFit(
  input: DeclarativeV2AuthenticatedVerifierDispatchInputV1,
  modules: ReadonlyArray<Readonly<{
    readonly budget: DeclarativeV2AuthenticatedVerifierComponentBudgetV1;
    readonly sourceBytes: bigint;
  }>>,
  semanticBytes: bigint,
): boolean {
  const components = [
    ...modules.map(module => module.budget),
    input.linkerBudget,
    input.hostBudget,
  ];
  for (const module of modules) {
    if (
      module.budget.required.modules !== 1n ||
      module.budget.required.sourceBytes !== module.sourceBytes ||
      module.budget.required.semanticBytes !== 0n
    ) return false;
  }
  if (input.hostBudget.required.semanticBytes !== semanticBytes) return false;
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    let maximum = 0n;
    let required = 0n;
    for (const component of components) {
      if (component.required[dimension] > component.maximums[dimension]) {
        return false;
      }
      maximum += component.maximums[dimension];
      required += component.required[dimension];
      if (maximum > MAX_SIGNED_INT64 || required > MAX_SIGNED_INT64) {
        return false;
      }
    }
    if (
      maximum > input.maximums[dimension] ||
      required !== input.required[dimension]
    ) return false;
  }
  return true;
}

function captureComponentBudget(
  value: unknown,
): DeclarativeV2AuthenticatedVerifierComponentBudgetV1 | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !["maximums", "required"].every(key => Object.hasOwn(value, key))
  ) return undefined;
  const maximums = captureBudget(dataValue(value, "maximums"), "command_budget");
  const required = captureBudget(dataValue(value, "required"), "attempt_usage");
  return maximums === undefined || required === undefined
    ? undefined
    : Object.freeze({ maximums, required });
}

function captureComponentBudgets(
  value: unknown,
): ReadonlyArray<DeclarativeV2AuthenticatedVerifierComponentBudgetV1> | undefined {
  if (!Array.isArray(value)) return undefined;
  const captured: DeclarativeV2AuthenticatedVerifierComponentBudgetV1[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const budget = captureComponentBudget(descriptor.value);
    if (budget === undefined) return undefined;
    captured.push(budget);
  }
  return Object.freeze(captured);
}

function dataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new Error("not data");
  }
  return descriptor.value;
}

function captureBudget(
  value: unknown,
  kind: "command_budget" | "attempt_usage",
): DeclarativeV2VerifierBudgetFrameV2 | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const expected = ["kind", ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== "string" || !expected.includes(key))
  ) return undefined;
  const captured: Record<string, bigint | string> = { kind };
  for (const key of expected) {
    const member = dataValue(value, key);
    if (key === "kind") {
      if (member !== kind) return undefined;
    } else {
      if (
        typeof member !== "bigint" ||
        member < 0n ||
        member > MAX_SIGNED_INT64
      ) return undefined;
      captured[key] = member;
    }
  }
  return Object.freeze(captured) as DeclarativeV2VerifierBudgetFrameV2;
}

function modulePathBytes(
  handle: unknown,
): Result.Result<
  Uint8Array,
  DeclarativeV2AuthenticatedVerifierDispatchError
> {
  const length = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteLength(handle);
  if (Result.isFailure(length)) {
    return Result.fail(dispatchError("request", "malformed"));
  }
  const bytes = new Uint8Array(length.success);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.byteAt(handle, index);
    if (Result.isFailure(byte) || byte.success === undefined) {
      return Result.fail(dispatchError("request", "malformed"));
    }
    bytes[index] = byte.success;
  }
  return Result.succeed(bytes);
}

function decodePath(
  bytes: Uint8Array,
): Result.Result<
  string,
  DeclarativeV2AuthenticatedVerifierDispatchError
> {
  try {
    return Result.succeed(UTF8_DECODER.decode(bytes));
  } catch {
    return Result.fail(dispatchError("request", "malformed"));
  }
}

function readExactSessionCursor(
  sessions: DeclarativeV2AuthenticatedReadSessionFactoryV1,
  request: Request,
  cursor: unknown,
  length: number,
): Result.Result<Uint8Array, DeclarativeV2AuthenticatedVerifierDispatchError> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const read = sessions.readCursor(
      request,
      cursor,
      Math.min(4_096, length - offset),
    );
    if (Result.isFailure(read)) {
      return Result.fail(dispatchError("request", "malformed"));
    }
    if (
      read.success.bytes.byteLength === 0 ||
      read.success.bytes.byteLength > length - offset ||
      read.success.offset !== offset + read.success.bytes.byteLength ||
      (read.success.status === "complete" &&
        read.success.offset !== length) ||
      (read.success.status === "pending" &&
        read.success.offset === length)
    ) {
      return Result.fail(dispatchError("request", "malformed"));
    }
    bytes.set(read.success.bytes, offset);
    offset += read.success.bytes.byteLength;
  }
  return Result.succeed(bytes);
}

function receiptPins(
  receipt: ReturnType<
    DeclarativeV2AuthenticatedReadSessionFactoryV1["receipt"]
  > extends Result.Result<infer A, unknown> ? A : never,
) {
  return Result.gen(function* () {
    const sourceRootSha256 = yield* sha256HexFromBytesV1(receipt.sourceRootSha256);
    const sourceSelectorSha256 =
      yield* sha256HexFromBytesV1(receipt.sourceSelectorSha256);
    const semanticRootSha256 =
      yield* sha256HexFromBytesV1(receipt.semanticRootSha256);
    const semanticSelectorSha256 =
      yield* sha256HexFromBytesV1(receipt.semanticSelectorSha256);
    const semanticAttemptIdentitySha256 =
      yield* sha256HexFromBytesV1(receipt.semanticAttemptIdentitySha256);
    return Object.freeze({
      projectId: receipt.projectId,
      deploymentId: receipt.deploymentId,
      deploymentCreatedAt: receipt.deploymentCreatedAt,
      sourceUploadId: receipt.sourceUploadId,
      sourceGeneration: receipt.sourceGeneration,
      sourceMutationFence: receipt.sourceMutationFence,
      sourceRootSha256,
      sourceSelectorSha256,
      semanticUploadId: receipt.semanticUploadId,
      semanticGeneration: receipt.semanticGeneration,
      semanticMutationFence: receipt.semanticMutationFence,
      semanticRootSha256,
      semanticSelectorSha256,
      semanticAttemptIdentitySha256,
    });
  }).pipe(Result.mapError(() => dispatchError("request", "malformed")));
}

const freshHandshake = Effect.fn(
  "DeclarativeV2VerifierDispatch.freshHandshake",
)(function*(
  options: Parameters<
    typeof makeDeclarativeV2AuthenticatedVerifierDispatchFactoryV1
  >[0],
  signal: AbortSignal,
) {
    const body = canonicalPrivateAnalyzerHandshakeRequestV1(
      options.expectedRelease,
    );
    const response = yield* analyzerFetch(
      options.analyzer,
      new Request(
        "https://flarex-analyzer.internal/__flarex_private/source-analyzer-v2/identity",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body: Uint8Array.from(body).buffer,
          signal,
        },
      ),
    );
    if (response.status !== 200) {
      return yield* dispatchError("handshake", "identityMismatch");
    }
    const bytes = yield* readBoundedResponse(response, body.byteLength + 64);
    return yield* decodePrivateAnalyzerHandshakeResponseV1(
      bytes,
      options.expectedRelease,
    ).pipe(
      Result.mapError(() => dispatchError("handshake", "identityMismatch")),
      Effect.fromResult,
    );
});

function analyzerFetch(
  analyzer: { readonly fetch: (request: Request) => Promise<Response> },
  request: Request,
): Effect.Effect<Response, DeclarativeV2AuthenticatedVerifierDispatchError> {
  return Effect.tryPromise({
    try: signal => analyzer.fetch(new Request(request, { signal })),
    catch: cause => dispatchError("dispatch", "transportFailed", cause),
  });
}

function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Effect.Effect<Uint8Array, DeclarativeV2AuthenticatedVerifierDispatchError> {
  return Effect.tryPromise({
    try: async signal => {
      if (response.body === null) throw dispatchError("response", "malformed");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let observedBytes = 0;
      const onAbort = () => void reader.cancel().catch(() => undefined);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value.byteLength > maximumBytes - observedBytes) {
            throw dispatchError("response", "budgetExceeded");
          }
          chunks.push(new Uint8Array(next.value));
          observedBytes += next.value.byteLength;
        }
      } catch (cause) {
        try {
          await reader.cancel(cause);
        } catch {
          // The original body-read decision remains authoritative.
        }
        throw cause;
      } finally {
        signal.removeEventListener("abort", onAbort);
        reader.releaseLock();
      }
      const output = new Uint8Array(observedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    },
    catch: cause =>
      cause instanceof DeclarativeV2AuthenticatedVerifierDispatchError
        ? cause
        : dispatchError("response", "transportUncertain", cause),
  });
}

function decodeResponse(
  bytes: Uint8Array,
  requestIdentitySha256: string,
): Result.Result<
  Readonly<{
    readonly header: PrivateAnalyzerVerificationResponseHeaderV1;
    readonly evidence: Uint8Array;
  }>,
  DeclarativeV2AuthenticatedVerifierDispatchError
> {
  let offset = 0;
  let header: PrivateAnalyzerVerificationResponseHeaderV1 | undefined;
  const evidence: Uint8Array[] = [];
  let ended = false;
  while (offset < bytes.byteLength) {
    if (offset + 5 > bytes.byteLength) {
      return Result.fail(dispatchError("response", "malformed"));
    }
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      5,
    ).getUint32(1, false);
    if (offset + 5 + length > bytes.byteLength) {
      return Result.fail(dispatchError("response", "malformed"));
    }
    const decoded = decodePrivateAnalyzerVerificationFrameV1(
      bytes.subarray(offset, offset + 5 + length),
    );
    if (Result.isFailure(decoded)) {
      return Result.fail(dispatchError("response", "malformed"));
    }
    offset += 5 + length;
    if (header === undefined) {
      if (decoded.success.kind !== "responseHeader") {
        return Result.fail(dispatchError("response", "malformed"));
      }
      const captured = decodePrivateAnalyzerVerificationResponseHeaderV1(
        decoded.success.payload,
        requestIdentitySha256,
      );
      if (Result.isFailure(captured)) {
        return Result.fail(dispatchError("response", "identityMismatch"));
      }
      header = captured.success;
    } else if (decoded.success.kind === "evidence" && !ended) {
      evidence.push(decoded.success.payload);
    } else if (
      decoded.success.kind === "responseEnd" &&
      decoded.success.payload.byteLength === 0 &&
      !ended
    ) ended = true;
    else return Result.fail(dispatchError("response", "malformed"));
  }
  if (
    header === undefined ||
    !ended ||
    evidence.length !== header.evidenceCount
  ) return Result.fail(dispatchError("response", "malformed"));
  return Result.succeed(Object.freeze({
    header,
    evidence: concatenate(evidence),
  }));
}

function frame(
  kind: PrivateAnalyzerVerificationFrameKindV1,
  payload: Uint8Array,
): Result.Result<
  Uint8Array,
  DeclarativeV2AuthenticatedVerifierDispatchError
> {
  return encodePrivateAnalyzerVerificationFrameV1(kind, payload).pipe(
    Result.mapError(() => dispatchError("request", "budgetExceeded")),
  );
}

function chunk(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 65_536) {
    chunks.push(bytes.slice(offset, Math.min(offset + 65_536, bytes.byteLength)));
  }
  return chunks;
}

function concatenate(values: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const value of values) length += value.byteLength;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function frameStream(frames: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const next = frames[index++];
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
}
