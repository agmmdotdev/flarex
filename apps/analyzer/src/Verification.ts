import {
  appendDeclarativeV2VerifierLinkerModuleV1,
  createIncrementalCanonicalJsonDecoderV1,
  createDeclarativeV2VerificationEvidenceSinkEncoderV2,
  createDeclarativeV2VerifierEngineV1,
  createDeclarativeV2VerifierLinkerV1,
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  finishDeclarativeV2VerifierLinkerV1,
  makeDeclarativeV2VerificationEvidenceBudgetV2,
  makeIncrementalCanonicalJsonEventSinkV1,
  makeIncrementalCanonicalJsonLimitsV1,
  makeIncrementalCanonicalJsonByteSinkV1,
  makeDeclarativeV2VerifierResultAccessFactoryV1,
  stepDeclarativeV2VerifierLinkerV1,
  type DeclarativeV2VerificationEvidenceCursorV2,
  type DeclarativeV2ArtifactModulePathHandleV1,
  type IncrementalCanonicalJsonDecodeStepV1,
  type IncrementalCanonicalJsonDecoderV1,
  type IncrementalCanonicalJsonReceiptV1,
  type IncrementalCanonicalJsonSinkEventV1,
  type DeclarativeV2VerifierModuleResultV1,
  canonicalPrivateAnalyzerVerificationResponseHeaderV1,
  canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1,
  canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1,
  decodePrivateAnalyzerVerificationFrameV1,
  decodePrivateAnalyzerVerificationModuleHeaderV1,
  decodePrivateAnalyzerVerificationRequestHeaderV1,
  encodePrivateAnalyzerVerificationFrameV1,
  PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
  type PrivateAnalyzerVerificationFrameKindV1,
  type PrivateAnalyzerVerificationModuleHeaderV1,
  type PrivateAnalyzerVerificationRequestHeaderV1,
  type PrivateAnalyzerVerificationResponseHeaderV1,
} from "@flarex/analysis/internal/private-analyzer-verification-v1";
import { Cause, Data, Effect, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import type { PrivateAnalyzerHostConfigurationV1 } from "./Configuration";
import type { PrivateAnalyzerIdentityTupleV1 } from "./Handshake";

const UTF8_ENCODER = new TextEncoder();
const FRAME_HEADER_BYTES = 5;
interface SemanticHandlerV1 {
  readonly modulePath: string;
  readonly exportName: string;
}

interface SemanticRecordCaptureV1 {
  depth: number;
  currentKey: string | undefined;
  currentText: string;
  textRole: "key" | "value" | undefined;
  rootObject: boolean;
  kind: string | undefined;
  functionPath: string | undefined;
  modulePath: string | undefined;
  exportName: string | undefined;
}

interface SemanticHandlerStreamV1 {
  decoder: IncrementalCanonicalJsonDecoderV1 | undefined;
  capture: SemanticRecordCaptureV1 | undefined;
  awaitingLineFeed: boolean;
  recordCount: number;
}

type MutableUsageV1 = Record<
  typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
  bigint
>;

export class PrivateAnalyzerVerificationHostV1Error extends Data.TaggedError(
  "PrivateAnalyzerVerificationHostV1Error",
)<{
  readonly reason:
    | "notFound"
    | "methodNotAllowed"
    | "unsupportedMediaType"
    | "malformed"
    | "budgetExceeded"
    | "timedOut"
    | "identityMismatch"
    | "invalidProgram";
}> {}

class PrivateAnalyzerVerificationForeignV1 {
  readonly _tag = "PrivateAnalyzerVerificationForeignV1";
  constructor(readonly cause: unknown) {}
}

export interface PrivateAnalyzerVerificationHostV1 {
  readonly handle: (request: Request) => Effect.Effect<Response, never, never>;
}

interface FrameReaderV1 {
  readonly next: (signal: AbortSignal) => Promise<Readonly<{
    readonly kind: PrivateAnalyzerVerificationFrameKindV1;
    readonly payload: Uint8Array;
  }> | undefined>;
  readonly close: () => Promise<void>;
}

function failure(
  reason: PrivateAnalyzerVerificationHostV1Error["reason"],
): PrivateAnalyzerVerificationHostV1Error {
  return new PrivateAnalyzerVerificationHostV1Error({ reason });
}

function requiredEffect<A, E>(
  value: Result.Result<A, E>,
  reason: PrivateAnalyzerVerificationHostV1Error["reason"],
): Effect.Effect<A, PrivateAnalyzerVerificationHostV1Error> {
  return Effect.fromResult(Result.mapError(value, observed => {
    const observedReason = observed !== null &&
        typeof observed === "object" &&
        "reason" in observed
      ? observed.reason
      : undefined;
    return failure(
      observedReason === "budgetExceeded" ? "budgetExceeded" : reason,
    );
  }));
}

function foreignPromise<A>(
  operation: string,
  evaluate: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, PrivateAnalyzerVerificationHostV1Error> {
  return Effect.tryPromise({
    try: evaluate,
    catch: cause => new PrivateAnalyzerVerificationForeignV1(cause),
  }).pipe(
    Effect.catchTag("PrivateAnalyzerVerificationForeignV1", caught =>
      caught.cause instanceof PrivateAnalyzerVerificationHostV1Error
        ? Effect.fail(caught.cause)
        : Effect.die(caught.cause)
    ),
    Effect.withSpan(operation),
  );
}

const cooperate = Effect.fn("PrivateAnalyzerVerification.cooperate")(
  () => Effect.sleep("0 millis"),
);

function nextFrame(
  reader: FrameReaderV1,
): Effect.Effect<
  Awaited<ReturnType<FrameReaderV1["next"]>>,
  PrivateAnalyzerVerificationHostV1Error
> {
  return foreignPromise(
    "PrivateAnalyzerVerification.readFrame",
    signal => reader.next(signal),
  );
}

export function makePrivateAnalyzerVerificationHostV1(options: {
  readonly configuration: PrivateAnalyzerHostConfigurationV1;
  readonly identity: PrivateAnalyzerIdentityTupleV1;
}): PrivateAnalyzerVerificationHostV1 {
  const access = makeDeclarativeV2VerifierResultAccessFactoryV1();

  const handleExpected = Effect.fn("PrivateAnalyzerVerification.handleExpected")(
    (request: Request) =>
      Effect.gen(function*() {
          const url = new URL(request.url);
          if (url.pathname !== options.configuration.verification.path) {
            return yield* Effect.fail(failure("notFound"));
          }
          if (request.method !== options.configuration.verification.method) {
            return yield* Effect.fail(failure("methodNotAllowed"));
          }
          if (
            request.headers.get("content-type") !==
              PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1
          ) {
            return yield* Effect.fail(failure("unsupportedMediaType"));
          }
          if (request.body === null) {
            return yield* Effect.fail(failure("malformed"));
          }
          const reader = makeFrameReader(
            request,
            options.configuration.verification.maximumFrameBytes,
          );
          return yield* Effect.acquireUseRelease(
            Effect.succeed(reader),
            ownedReader => verifyRequest(ownedReader, options.identity, access),
            ownedReader =>
              foreignPromise(
                "PrivateAnalyzerVerification.closeFrameReader",
                () => ownedReader.close(),
              ).pipe(Effect.orDie),
          );
        }).pipe(
        Effect.timeout(
          `${options.configuration.verification.maximumBodyReadMilliseconds} millis`,
        ),
        Effect.mapError(error =>
          Cause.isTimeoutError(error) ? failure("timedOut") : error
        ),
      ),
  );

  const handle = Effect.fn("PrivateAnalyzerVerification.handle")(
    (request: Request) =>
      handleExpected(request).pipe(
        Effect.catch(error => Effect.succeed(errorResponse(error))),
      ),
  );
  return Object.freeze({ handle });
}

const verifyRequest = Effect.fn("PrivateAnalyzerVerification.verifyRequest")(
  function*(
    reader: FrameReaderV1,
    identity: PrivateAnalyzerIdentityTupleV1,
    access: ReturnType<typeof makeDeclarativeV2VerifierResultAccessFactoryV1>,
  ) {
  const first = yield* nextFrame(reader);
  if (first?.kind !== "requestHeader") {
    return yield* Effect.fail(failure("malformed"));
  }
  const header = yield* requiredEffect(
    decodePrivateAnalyzerVerificationRequestHeaderV1(first.payload, identity),
    "identityMismatch",
  );
  const {
    requestIdentitySha256: receivedRequestIdentitySha256,
    ...requestIdentityFields
  } = header;
  if (
    (yield* sha256HexEffect(
      canonicalPrivateAnalyzerVerificationRequestIdentityPreimageV1(
        requestIdentityFields,
      ),
    )) !== receivedRequestIdentitySha256
  ) {
    return yield* Effect.fail(failure("identityMismatch"));
  }
  if (
    BigInt(header.moduleCount) > header.maximums.modules ||
    BigInt(header.semanticByteLength) !== header.required.semanticBytes ||
    BigInt(header.semanticByteLength) > header.maximums.semanticBytes
  ) {
    return yield* Effect.fail(failure("budgetExceeded"));
  }
  const allocationMaximums = zeroUsage();
  const allocationRequired = zeroUsage();
  yield* requiredEffect(addAllocation(
    allocationMaximums,
    allocationRequired,
    header.linkerMaximums,
    header.linkerRequired,
    header,
  ), "budgetExceeded");
  yield* requiredEffect(addAllocation(
    allocationMaximums,
    allocationRequired,
    header.hostMaximums,
    header.hostRequired,
    header,
  ), "budgetExceeded");
  const moduleResults: DeclarativeV2VerifierModuleResultV1[] = [];
  const moduleHeaders: PrivateAnalyzerVerificationModuleHeaderV1[] = [];
  const modulePathHandles: DeclarativeV2ArtifactModulePathHandleV1[] = [];
  const moduleHeaderBytes: Uint8Array[] = [];
  const linker = yield* requiredEffect(
    createDeclarativeV2VerifierLinkerV1(
      header.linkerMaximums,
      header.linkerRequired,
    ),
    "budgetExceeded",
  );
  let totalSourceBytes = 0n;

  for (let ordinal = 0; ordinal < header.moduleCount; ordinal += 1) {
    const frame = yield* nextFrame(reader);
    if (frame?.kind !== "moduleHeader") {
      return yield* Effect.fail(failure("malformed"));
    }
    const moduleHeader = yield* requiredEffect(
      decodePrivateAnalyzerVerificationModuleHeaderV1(frame.payload),
      "malformed",
    );
    yield* requiredEffect(addAllocation(
      allocationMaximums,
      allocationRequired,
      moduleHeader.maximums,
      moduleHeader.required,
      header,
    ), "budgetExceeded");
    if (
      moduleHeader.required.modules !== 1n ||
      moduleHeader.required.sourceBytes !==
        BigInt(moduleHeader.sourceByteLength) ||
      moduleHeader.required.semanticBytes !== 0n
    ) return yield* Effect.fail(failure("budgetExceeded"));
    moduleHeaderBytes.push(frame.payload);
    if (moduleHeader.ordinal !== ordinal) {
      return yield* Effect.fail(failure("malformed"));
    }
    totalSourceBytes += BigInt(moduleHeader.sourceByteLength);
    if (totalSourceBytes > header.maximums.sourceBytes) {
      return yield* Effect.fail(failure("budgetExceeded"));
    }
    moduleHeaders.push(moduleHeader);
    const modulePath = yield* pathHandle(moduleHeader.modulePath);
    modulePathHandles.push(modulePath);
    const digest = hexBytes(moduleHeader.sourceSha256);
    const engine = yield* requiredEffect(
      createDeclarativeV2VerifierEngineV1({
        modulePath,
        moduleOrdinal: BigInt(moduleHeader.ordinal),
        sourceSha256: digest,
        maximums: moduleHeader.maximums,
        required: moduleHeader.required,
      }),
      "budgetExceeded",
    );
    let sourceRead = 0;
    const sourceChunks: Uint8Array[] = [];
    while (sourceRead < moduleHeader.sourceByteLength) {
      const sourceFrame = yield* nextFrame(reader);
      if (sourceFrame?.kind !== "moduleBytes") {
        return yield* Effect.fail(failure("malformed"));
      }
      if (
        sourceFrame.payload.byteLength === 0 ||
        sourceRead + sourceFrame.payload.byteLength >
          moduleHeader.sourceByteLength
      ) return yield* Effect.fail(failure("malformed"));
      let offset = 0;
      sourceChunks.push(sourceFrame.payload);
      while (offset < sourceFrame.payload.byteLength) {
        const stepped = yield* requiredEffect(
          engine.step(sourceFrame.payload.subarray(offset), 1_024),
          "invalidProgram",
        );
        offset += stepped.consumedBytes;
        yield* cooperate();
      }
      sourceRead += sourceFrame.payload.byteLength;
    }
    if (
      (yield* sha256HexEffect(concatenate(sourceChunks))) !==
        moduleHeader.sourceSha256
    ) return yield* Effect.fail(failure("identityMismatch"));
    let moduleResult: DeclarativeV2VerifierModuleResultV1 | undefined;
    while (moduleResult === undefined) {
      const finished = yield* requiredEffect(
        engine.finish(1_024),
        "invalidProgram",
      );
      if (!("status" in finished)) moduleResult = finished;
      else yield* cooperate();
    }
    moduleResults.push(moduleResult);
    yield* requiredEffect(
      appendDeclarativeV2VerifierLinkerModuleV1(linker, moduleResult),
      "invalidProgram",
    );
    while (true) {
      const copied = yield* requiredEffect(
        stepDeclarativeV2VerifierLinkerV1(linker, 1_024),
        "invalidProgram",
      );
      if (!("status" in copied) || copied.readyForModule) break;
      yield* cooperate();
    }
  }
  if (totalSourceBytes !== header.required.sourceBytes) {
    return yield* Effect.fail(failure("budgetExceeded"));
  }
  yield* requiredEffect(
    assertCompleteAllocation(allocationMaximums, allocationRequired, header),
    "budgetExceeded",
  );
  const hostUsage = zeroUsage();
  yield* requiredEffect(
    chargeUsage(
      hostUsage,
      header.hostRequired,
      "semanticBytes",
      BigInt(header.semanticByteLength),
    ),
    "budgetExceeded",
  );

  const handlers: SemanticHandlerV1[] = [];
  const semanticChunks: Uint8Array[] = [];
  let semanticRead = 0;
  const semanticStream: SemanticHandlerStreamV1 = {
    decoder: undefined,
    capture: undefined,
    awaitingLineFeed: false,
    recordCount: 0,
  };
  while (semanticRead < header.semanticByteLength) {
    const frame = yield* nextFrame(reader);
    if (frame?.kind !== "semanticBytes") {
      return yield* Effect.fail(failure("malformed"));
    }
    if (
      frame.payload.byteLength === 0 ||
      semanticRead + frame.payload.byteLength > header.semanticByteLength
    ) return yield* Effect.fail(failure("malformed"));
    semanticChunks.push(frame.payload);
    let semanticOffset = 0;
    while (semanticOffset < frame.payload.byteLength) {
      semanticOffset += yield* consumeSemanticBytes(
        semanticStream,
        frame.payload.subarray(semanticOffset),
        handlers,
        hostUsage,
        header.hostRequired,
        header.semanticByteLength,
      );
      yield* cooperate();
    }
    semanticRead += frame.payload.byteLength;
  }
  if (
    header.semanticByteLength > 0 &&
    (
      semanticStream.decoder !== undefined ||
      semanticStream.awaitingLineFeed ||
      semanticStream.recordCount === 0
    )
  ) {
    return yield* Effect.fail(failure("invalidProgram"));
  }
  if (
    (yield* sha256HexEffect(concatenate(semanticChunks))) !==
      header.semanticContentSha256 ||
    (yield* sha256HexEffect(concatenate(moduleHeaderBytes))) !==
      header.moduleManifestSha256
  ) return yield* Effect.fail(failure("identityMismatch"));
  const end = yield* nextFrame(reader);
  if (end?.kind !== "requestEnd" || end.payload.byteLength !== 0) {
    return yield* Effect.fail(failure("malformed"));
  }
  if ((yield* nextFrame(reader)) !== undefined) {
    return yield* Effect.fail(failure("malformed"));
  }

  let linkResult;
  while (linkResult === undefined) {
    const linked = yield* requiredEffect(
      finishDeclarativeV2VerifierLinkerV1(linker, 1_024),
      "invalidProgram",
    );
    if ("status" in linked) yield* cooperate();
    else linkResult = linked;
  }

  const moduleIndexByPath = new Map<string, number>();
  for (let moduleIndex = 0; moduleIndex < moduleHeaders.length; moduleIndex += 1) {
    const modulePath = moduleHeaders[moduleIndex]!.modulePath;
    if (moduleIndexByPath.has(modulePath)) {
      return yield* Effect.fail(failure("invalidProgram"));
    }
    yield* requiredEffect(
      chargeUsage(hostUsage, header.hostRequired, "calls", 1n),
      "budgetExceeded",
    );
    yield* requiredEffect(
      chargeUsage(hostUsage, header.hostRequired, "graphNodes", 1n),
      "budgetExceeded",
    );
    moduleIndexByPath.set(modulePath, moduleIndex);
    yield* cooperate();
  }

  for (const handler of handlers) {
    yield* requiredEffect(
      chargeUsage(hostUsage, header.hostRequired, "calls", 1n),
      "budgetExceeded",
    );
    const moduleIndex = moduleIndexByPath.get(handler.modulePath);
    yield* cooperate();
    if (moduleIndex === undefined) {
      return yield* Effect.fail(failure("invalidProgram"));
    }
    const exportName = yield* encodeUtf8Cooperatively(
      handler.exportName,
      hostUsage,
      header.hostRequired,
    );
    const lookup = yield* requiredEffect(
      access.handlerLookup(
        moduleResults[moduleIndex],
        modulePathHandles[moduleIndex]!,
        exportName,
        remainingUsage(header.hostRequired, hostUsage),
      ),
      "invalidProgram",
    );
    let matched: boolean | undefined;
    while (matched === undefined) {
      const result = yield* requiredEffect(
        access.stepHandlerLookup(lookup, 1_024),
        "invalidProgram",
      );
      yield* requiredEffect(
        settleUsage(hostUsage, header.hostRequired, result.deltaUsage),
        "budgetExceeded",
      );
      if (result.status === "complete") matched = result.matched;
      yield* cooperate();
    }
    if (!matched) return yield* Effect.fail(failure("invalidProgram"));
  }

  const evidenceFrames: Uint8Array[] = [];
  let evidenceCount = 0;
  let diagnosticCount = Number(linkResult.diagnosticCount);
  for (const module of moduleResults) {
    diagnosticCount += Number(module.diagnosticCount);
    const cursor = yield* requiredEffect(
      access.moduleEvidence(module, remainingUsage(header.hostRequired, hostUsage)),
      "invalidProgram",
    );
    while (true) {
      const item = yield* requiredEffect(
        access.readModuleEvidence(cursor, 1_024),
        "invalidProgram",
      );
      yield* requiredEffect(
        settleUsage(hostUsage, header.hostRequired, item.deltaUsage),
        "budgetExceeded",
      );
      if (item.status === "complete") break;
      if (item.status === "pending") {
        yield* cooperate();
        continue;
      }
      evidenceFrames.push(
        yield* encodeEvidence(item.evidence, header, hostUsage),
      );
      evidenceCount += 1;
      yield* cooperate();
    }
  }
  const linkCursor = yield* requiredEffect(
    access.linkEvidence(
      linkResult,
      remainingUsage(header.hostRequired, hostUsage),
    ),
    "invalidProgram",
  );
  while (true) {
    const item = yield* requiredEffect(
      access.readLinkEvidence(linkCursor, 1_024),
      "invalidProgram",
    );
    yield* requiredEffect(
      settleUsage(hostUsage, header.hostRequired, item.deltaUsage),
      "budgetExceeded",
    );
    if (item.status === "complete") break;
    if (item.status === "pending") {
      yield* cooperate();
      continue;
    }
    evidenceFrames.push(
      yield* encodeEvidence(item.evidence, header, hostUsage),
    );
    evidenceCount += 1;
    yield* cooperate();
  }
  const verified = moduleResults.every(result => result.verified) &&
    linkResult.diagnosticCount === 0n;
  const evidenceSha256 = yield* sha256HexEffect(concatenate(evidenceFrames));
  const withoutIdentity = Object.freeze({
    kind: "private_analyzer_verification_response_v1" as const,
    protocolIdentity: header.protocolIdentity,
    protocolVersion: header.protocolVersion,
    requestIdentitySha256: header.requestIdentitySha256,
    evidenceSha256,
    verified,
    moduleCount: moduleResults.length,
    evidenceCount,
    diagnosticCount,
  });
  const resultIdentitySha256 = yield* sha256HexEffect(
    canonicalPrivateAnalyzerVerificationResultIdentityPreimageV1(
      withoutIdentity,
    ),
  );
  const responseHeader = Object.freeze({
    ...withoutIdentity,
    resultIdentitySha256,
  } satisfies PrivateAnalyzerVerificationResponseHeaderV1);
  const responseHeaderFrame = yield* frameBytesEffect(
    "responseHeader",
    canonicalPrivateAnalyzerVerificationResponseHeaderV1(responseHeader),
  );
  const framedEvidence: Uint8Array[] = [];
  for (const payload of evidenceFrames) {
    framedEvidence.push(yield* frameBytesEffect("evidence", payload));
    yield* cooperate();
  }
  const responseEndFrame = yield* frameBytesEffect(
    "responseEnd",
    new Uint8Array(0),
  );
  const frames = [
    responseHeaderFrame,
    ...framedEvidence,
    responseEndFrame,
  ];
  return new Response(streamFrames(frames), {
    status: 200,
    headers: {
      "content-type": PRIVATE_ANALYZER_VERIFICATION_CONTENT_TYPE_V1,
      "cache-control": "no-store",
    },
  });
});

const encodeEvidence = Effect.fn("PrivateAnalyzerVerification.encodeEvidence")(
  function*(
  evidence: DeclarativeV2VerificationEvidenceCursorV2,
  header: PrivateAnalyzerVerificationRequestHeaderV1,
  usage: MutableUsageV1,
  ) {
  const remaining = remainingUsage(header.hostRequired, usage);
  const maximum = Math.min(
    optionsNumber(remaining.frameBytes),
    optionsNumber(remaining.canonicalBytes),
    optionsNumber(remaining.outputBytes),
    65_536,
  );
  const output = new Uint8Array(maximum);
  const sink = makeIncrementalCanonicalJsonByteSinkV1((byte: number, offset: number) => {
    if (offset >= output.byteLength) throw failure("budgetExceeded");
    output[offset] = byte;
  });
  const budget = yield* requiredEffect(
    makeDeclarativeV2VerificationEvidenceBudgetV2(maximum, maximum),
    "budgetExceeded",
  );
  const encoder = yield* requiredEffect(
    createDeclarativeV2VerificationEvidenceSinkEncoderV2(
      evidence,
      budget,
      sink,
    ),
    "invalidProgram",
  );
  let length: number | undefined;
  while (length === undefined) {
    const step = yield* requiredEffect(
      encoder.step(1_024),
      "invalidProgram",
    );
    yield* requiredEffect(
      chargeUsage(usage, header.hostRequired, "calls", 1n),
      "budgetExceeded",
    );
    if (step.status === "complete") length = step.canonicalByteLength;
    else yield* cooperate();
  }
  yield* requiredEffect(
    chargeUsage(
      usage,
      header.hostRequired,
      "canonicalBytes",
      BigInt(length),
    ),
    "budgetExceeded",
  );
  yield* requiredEffect(
    chargeUsage(usage, header.hostRequired, "frameBytes", BigInt(length)),
    "budgetExceeded",
  );
  yield* requiredEffect(
    chargeUsage(usage, header.hostRequired, "outputBytes", BigInt(length)),
    "budgetExceeded",
  );
  return output.slice(0, length);
});

function zeroUsage(): MutableUsageV1 {
  return Object.fromEntries(
    DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      0n,
    ]),
  ) as MutableUsageV1;
}

const consumeSemanticBytes = Effect.fn(
  "PrivateAnalyzerVerification.consumeSemanticBytes",
)(function*(
  stream: SemanticHandlerStreamV1,
  input: Uint8Array,
  handlers: SemanticHandlerV1[],
  usage: MutableUsageV1,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  semanticByteLength: number,
) {
  if (stream.awaitingLineFeed) {
    if (input[0] !== 0x0a) {
      return yield* Effect.fail(failure("invalidProgram"));
    }
    yield* requiredEffect(
      chargeUsage(usage, maximum, "tokenBytes", 1n),
      "budgetExceeded",
    );
    yield* requiredEffect(
      chargeUsage(usage, maximum, "parserStates", 1n),
      "budgetExceeded",
    );
    yield* requiredEffect(
      chargeUsage(usage, maximum, "tokens", 1n),
      "budgetExceeded",
    );
    yield* requiredEffect(
      chargeUsage(usage, maximum, "calls", 1n),
      "budgetExceeded",
    );
    stream.awaitingLineFeed = false;
    stream.decoder = undefined;
    stream.capture = undefined;
    stream.recordCount += 1;
    return 1;
  }

  if (stream.decoder === undefined) {
    const capture = createSemanticRecordCapture();
    const limits = yield* requiredEffect(
      makeIncrementalCanonicalJsonLimitsV1(
        semanticByteLength,
        optionsNumber(maximum.canonicalBytes - usage.canonicalBytes),
        optionsNumber(maximum.stringBytes - usage.stringBytes),
        optionsNumber(maximum.schemaNodes - usage.schemaNodes),
        optionsNumber(maximum.nestingDepth - usage.nestingDepth),
      ),
      "budgetExceeded",
    );
    stream.capture = capture;
    stream.decoder = yield* requiredEffect(
      createIncrementalCanonicalJsonDecoderV1(
        limits,
        makeIncrementalCanonicalJsonEventSinkV1(event =>
          captureSemanticRecordEvent(capture, event)
        ),
      ),
      "invalidProgram",
    );
  }

  const allowance = semanticAllowance(maximum, usage);
  if (allowance < 1) {
    return yield* Effect.fail(failure("budgetExceeded"));
  }
  const decoded = yield* requiredEffect(
    stream.decoder.step(input, allowance),
    "invalidProgram",
  );
  yield* settleSemanticReceipt(usage, maximum, decoded);
  if (decoded.status === "complete") {
    if (
      !decoded.canonical ||
      !decoded.jsonMembership ||
      !decoded.wellFormedUnicode ||
      !stream.capture?.rootObject
    ) {
      return yield* Effect.fail(failure("invalidProgram"));
    }
    const handler = semanticHandlerFromCapture(stream.capture);
    if (stream.capture.kind === "handler") {
      if (handler === undefined || decoded.rootObjectMemberCount !== 4) {
        return yield* Effect.fail(failure("invalidProgram"));
      }
      handlers.push(handler);
    }
    stream.awaitingLineFeed = true;
  }
  return decoded.consumedInputBytes;
});

function createSemanticRecordCapture(): SemanticRecordCaptureV1 {
  return {
    depth: 0,
    currentKey: undefined,
    currentText: "",
    textRole: undefined,
    rootObject: false,
    kind: undefined,
    functionPath: undefined,
    modulePath: undefined,
    exportName: undefined,
  };
}

function captureSemanticRecordEvent(
  capture: SemanticRecordCaptureV1,
  event: IncrementalCanonicalJsonSinkEventV1,
): void {
  switch (event.kind) {
    case "objectStart":
      capture.depth += 1;
      if (capture.depth === 1) capture.rootObject = true;
      return;
    case "arrayStart":
      capture.depth += 1;
      return;
    case "objectEnd":
    case "arrayEnd":
      capture.depth -= 1;
      return;
    case "stringStart":
      if (
        capture.depth === 1 &&
        (
          event.role === "key" ||
          (
            event.role === "value" &&
            (
              capture.currentKey === "kind" ||
              capture.currentKey === "functionPath" ||
              capture.currentKey === "modulePath" ||
              capture.currentKey === "exportName"
            )
          )
        )
      ) {
        capture.textRole = event.role;
        capture.currentText = "";
      }
      return;
    case "stringScalar":
      if (capture.textRole === event.role) {
        capture.currentText += event.value;
      }
      return;
    case "stringEnd":
      if (capture.textRole !== event.role) return;
      if (event.role === "key") {
        capture.currentKey = capture.currentText;
      } else {
        const key = capture.currentKey;
        if (key === "kind") capture.kind = capture.currentText;
        else if (key === "functionPath") {
          capture.functionPath = capture.currentText;
        } else if (key === "modulePath") {
          capture.modulePath = capture.currentText;
        } else if (key === "exportName") {
          capture.exportName = capture.currentText;
        }
      }
      capture.textRole = undefined;
      capture.currentText = "";
      return;
    case "memberFinalize":
      if (event.container === "object" && capture.depth === 1) {
        capture.currentKey = undefined;
      }
      return;
    default:
      return;
  }
}

function semanticHandlerFromCapture(
  capture: SemanticRecordCaptureV1,
): SemanticHandlerV1 | undefined {
  return capture.kind === "handler" &&
      capture.functionPath !== undefined &&
      capture.modulePath !== undefined &&
      capture.exportName !== undefined
    ? Object.freeze({
      modulePath: capture.modulePath,
      exportName: capture.exportName,
    })
    : undefined;
}

function semanticAllowance(
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  usage: MutableUsageV1,
): number {
  return Math.min(
    1_024,
    optionsNumber(maximum.parserStates - usage.parserStates),
  );
}

const settleSemanticReceipt = Effect.fn(
  "PrivateAnalyzerVerification.settleSemanticReceipt",
)(function*(
  usage: MutableUsageV1,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  decoded: IncrementalCanonicalJsonDecodeStepV1,
) {
  const delta: IncrementalCanonicalJsonReceiptV1["delta"] =
    decoded.receipt.delta;
  for (const [dimension, amount] of [
    ["calls", 1n],
    ["tokenBytes", BigInt(delta.inputBytes)],
    ["canonicalBytes", BigInt(delta.canonicalBytes)],
    ["stringBytes", BigInt(delta.stringBytes)],
    ["schemaNodes", BigInt(delta.members)],
    ["nestingDepth", BigInt(delta.depth)],
    ["parserStates", BigInt(delta.transitions)],
  ] as const) {
    yield* requiredEffect(
      chargeUsage(usage, maximum, dimension, amount),
      "budgetExceeded",
    );
  }
});

function chargeUsage(
  usage: MutableUsageV1,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  dimension: keyof MutableUsageV1,
  amount: bigint,
): Result.Result<void, PrivateAnalyzerVerificationHostV1Error> {
  const observed = usage[dimension] + amount;
  if (observed > maximum[dimension]) {
    return Result.fail(failure("budgetExceeded"));
  }
  usage[dimension] = observed;
  return Result.succeed(undefined);
}

function settleUsage(
  usage: MutableUsageV1,
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  delta: DeclarativeV2VerifierBudgetFrameV2,
): Result.Result<void, PrivateAnalyzerVerificationHostV1Error> {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    const charged = chargeUsage(usage, maximum, dimension, delta[dimension]);
    if (Result.isFailure(charged)) return charged;
  }
  return Result.succeed(undefined);
}

function remainingUsage(
  maximum: DeclarativeV2VerifierBudgetFrameV2,
  usage: MutableUsageV1,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze(Object.fromEntries([
    ["kind", "attempt_usage"],
    ...DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map(dimension => [
      dimension,
      maximum[dimension] - usage[dimension],
    ]),
  ])) as DeclarativeV2VerifierBudgetFrameV2;
}

function addAllocation(
  maximums: MutableUsageV1,
  required: MutableUsageV1,
  componentMaximums: DeclarativeV2VerifierBudgetFrameV2,
  componentRequired: DeclarativeV2VerifierBudgetFrameV2,
  header: PrivateAnalyzerVerificationRequestHeaderV1,
): Result.Result<void, PrivateAnalyzerVerificationHostV1Error> {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (componentRequired[dimension] > componentMaximums[dimension]) {
      return Result.fail(failure("budgetExceeded"));
    }
    maximums[dimension] += componentMaximums[dimension];
    required[dimension] += componentRequired[dimension];
    if (
      maximums[dimension] > header.maximums[dimension] ||
      required[dimension] > header.required[dimension]
    ) return Result.fail(failure("budgetExceeded"));
  }
  return Result.succeed(undefined);
}

function assertCompleteAllocation(
  maximums: MutableUsageV1,
  required: MutableUsageV1,
  header: PrivateAnalyzerVerificationRequestHeaderV1,
): Result.Result<void, PrivateAnalyzerVerificationHostV1Error> {
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    if (
      maximums[dimension] > header.maximums[dimension] ||
      required[dimension] !== header.required[dimension]
    ) return Result.fail(failure("budgetExceeded"));
  }
  return Result.succeed(undefined);
}

const pathHandle = Effect.fn("PrivateAnalyzerVerification.pathHandle")(
  function*(spelling: string) {
  const bytes = yield* encodeUtf8Cooperatively(spelling);
  const validator = yield* requiredEffect(
    DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
      bytes.byteLength + 3,
      bytes.byteLength,
      bytes.byteLength,
    ),
    "malformed",
  );
  let offset = 0;
  while (offset < bytes.byteLength) {
    const stepped = yield* requiredEffect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
        validator,
        bytes.subarray(offset),
        1_024,
      ),
      "malformed",
    );
    offset += stepped.consumedBytes;
    yield* cooperate();
  }
  while (true) {
    const finished = yield* requiredEffect(
      DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(validator, 1_024),
      "malformed",
    );
    if (!("status" in finished)) return finished;
    yield* cooperate();
  }
});

const encodeUtf8Cooperatively = Effect.fn(
  "PrivateAnalyzerVerification.encodeUtf8",
)(function*(
  spelling: string,
  usage?: MutableUsageV1,
  maximum?: DeclarativeV2VerifierBudgetFrameV2,
) {
  let byteLength = 0;
  let index = 0;
  let transitions = 0;
  while (index < spelling.length) {
    const first = spelling.charCodeAt(index);
    let scalar = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = spelling.charCodeAt(index + 1);
      if (second < 0xdc00 || second > 0xdfff) {
        return yield* Effect.fail(failure("invalidProgram"));
      }
      scalar = 0x1_0000 + ((first - 0xd800) << 10) + second - 0xdc00;
      index += 2;
    } else {
      if (first >= 0xdc00 && first <= 0xdfff) {
        return yield* Effect.fail(failure("invalidProgram"));
      }
      index += 1;
    }
    byteLength += scalar <= 0x7f
      ? 1
      : scalar <= 0x7ff
      ? 2
      : scalar <= 0xffff
      ? 3
      : 4;
    transitions += 1;
    if (transitions === 1_024) {
      if (usage !== undefined && maximum !== undefined) {
        yield* requiredEffect(
          chargeUsage(usage, maximum, "calls", 1n),
          "budgetExceeded",
        );
      }
      transitions = 0;
      yield* cooperate();
    }
  }
  if (usage !== undefined && maximum !== undefined) {
    yield* requiredEffect(
      chargeUsage(usage, maximum, "outputBytes", BigInt(byteLength)),
      "budgetExceeded",
    );
  }
  const output = new Uint8Array(byteLength);
  index = 0;
  let offset = 0;
  transitions = 0;
  while (index < spelling.length) {
    const first = spelling.charCodeAt(index);
    let scalar = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = spelling.charCodeAt(index + 1);
      scalar = 0x1_0000 + ((first - 0xd800) << 10) + second - 0xdc00;
      index += 2;
    } else {
      index += 1;
    }
    if (scalar <= 0x7f) {
      output[offset++] = scalar;
    } else if (scalar <= 0x7ff) {
      output[offset++] = 0xc0 | (scalar >> 6);
      output[offset++] = 0x80 | (scalar & 0x3f);
    } else if (scalar <= 0xffff) {
      output[offset++] = 0xe0 | (scalar >> 12);
      output[offset++] = 0x80 | ((scalar >> 6) & 0x3f);
      output[offset++] = 0x80 | (scalar & 0x3f);
    } else {
      output[offset++] = 0xf0 | (scalar >> 18);
      output[offset++] = 0x80 | ((scalar >> 12) & 0x3f);
      output[offset++] = 0x80 | ((scalar >> 6) & 0x3f);
      output[offset++] = 0x80 | (scalar & 0x3f);
    }
    transitions += 1;
    if (transitions === 1_024) {
      if (usage !== undefined && maximum !== undefined) {
        yield* requiredEffect(
          chargeUsage(usage, maximum, "calls", 1n),
          "budgetExceeded",
        );
      }
      transitions = 0;
      yield* cooperate();
    }
  }
  return output;
});

function optionsNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  let output = "";
  for (const byte of digest) output += byte.toString(16).padStart(2, "0");
  return output;
}

function sha256HexEffect(
  bytes: Uint8Array,
): Effect.Effect<string, PrivateAnalyzerVerificationHostV1Error> {
  return foreignPromise(
    "PrivateAnalyzerVerification.sha256",
    () => sha256Hex(bytes),
  );
}

function frameBytesEffect(
  kind: PrivateAnalyzerVerificationFrameKindV1,
  payload: Uint8Array,
): Effect.Effect<Uint8Array, PrivateAnalyzerVerificationHostV1Error> {
  return requiredEffect(
    encodePrivateAnalyzerVerificationFrameV1(kind, payload),
    "budgetExceeded",
  );
}

function streamFrames(frames: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const frame = frames[index++];
      if (frame === undefined) controller.close();
      else controller.enqueue(frame);
    },
  });
}

function concatenate(values: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const value of values) total += value.byteLength;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function makeFrameReader(
  request: Request,
  maximumPayloadBytes: number,
): FrameReaderV1 {
  const stream = request.body;
  if (stream === null) throw failure("malformed");
  const reader = stream.getReader();
  let chunk = new Uint8Array(0);
  let chunkOffset = 0;
  let closed = false;
  const readExact = async (
    length: number,
    signal: AbortSignal,
  ): Promise<Uint8Array | undefined> => {
    const output = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      if (chunkOffset >= chunk.byteLength) {
        if (signal.aborted) throw signal.reason;
        const onAbort = () =>
          void reader.cancel(signal.reason).catch(() => undefined);
        signal.addEventListener("abort", onAbort, { once: true });
        const next = await reader.read().finally(() =>
          signal.removeEventListener("abort", onAbort)
        );
        if (next.done) return offset === 0 ? undefined : (() => {
          throw failure("malformed");
        })();
        chunk = new Uint8Array(next.value);
        chunkOffset = 0;
        if (chunk.byteLength === 0) continue;
      }
      const amount = Math.min(length - offset, chunk.byteLength - chunkOffset);
      output.set(chunk.subarray(chunkOffset, chunkOffset + amount), offset);
      offset += amount;
      chunkOffset += amount;
    }
    return output;
  };
  return {
    next: async signal => {
      const header = await readExact(FRAME_HEADER_BYTES, signal);
      if (header === undefined) return undefined;
      const length = new DataView(header.buffer).getUint32(1, false);
      if (length > maximumPayloadBytes) throw failure("budgetExceeded");
      const payload = await readExact(length, signal);
      if (payload === undefined) throw failure("malformed");
      const bytes = new Uint8Array(FRAME_HEADER_BYTES + length);
      bytes.set(header);
      bytes.set(payload, FRAME_HEADER_BYTES);
      const decoded = decodePrivateAnalyzerVerificationFrameV1(
        bytes,
        maximumPayloadBytes,
      );
      if (Result.isFailure(decoded)) throw failure("malformed");
      return decoded.success;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function errorResponse(error: PrivateAnalyzerVerificationHostV1Error): Response {
  const status = error.reason === "notFound"
    ? 404
    : error.reason === "methodNotAllowed"
    ? 405
    : error.reason === "unsupportedMediaType"
    ? 415
    : error.reason === "identityMismatch"
    ? 409
    : error.reason === "budgetExceeded"
    ? 413
    : error.reason === "timedOut"
    ? 408
    : 400;
  return new Response(
    UTF8_ENCODER.encode(`{"error":"${error.reason}"}`),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}
