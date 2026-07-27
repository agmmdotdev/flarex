import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2VerifierProgressFrameIntoV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  verifyOwnedDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MEDIA_TYPE_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_IDENTITY_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_VERSION_V1,
  makeDeclarativeV2AuthenticatedCommandResponseFactoryV1,
  type DeclarativeV2AuthenticatedCommandResponseBudgetV1,
  type DeclarativeV2AuthenticatedCommandResponseEncoderV1,
  type DeclarativeV2AuthenticatedCommandResponseFactoryV1,
  type DeclarativeV2AuthenticatedCommandResponseFrameV1,
  type DeclarativeV2AuthenticatedCommandResponseResultV1,
  type DeclarativeV2AuthenticatedCommandResponseUsageV1,
  type DeclarativeV2AuthenticatedCommandResponseV1Error,
} from "../src/declarativeV2AuthenticatedCommandResponseV1";

const MAXIMUM = 5_000_000;
const budget: Readonly<DeclarativeV2AuthenticatedCommandResponseBudgetV1> =
  Object.freeze({
  maximumBodyBytes: MAXIMUM,
  maximumCanonicalBytes: MAXIMUM,
  maximumFrameBytes: MAXIMUM,
  maximumPayloadBytes: MAXIMUM,
  maximumFrames: 1_024,
  maximumAllocationBytes: MAXIMUM,
  maximumCopyBytes: MAXIMUM,
  maximumTransitions: MAXIMUM,
  });

describe("Declarative V2 authenticated command response V1", () => {
  it("pins a distinct private identity and two-cold canonical bytes", async () => {
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_IDENTITY_V1)
      .toBe(
        "flarex.executor-http/declarative-v2-authenticated-command-response/v1",
      );
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_VERSION_V1)
      .toBe(1);
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_MEDIA_TYPE_V1).toBe(
      "application/vnd.flarex.declarative-v2-authenticated-command-response-v1",
    );
    const frames = await responseFrames("parse_module");
    const first = encode(frames);
    const second = encode(await responseFrames("parse_module"));
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("round-trips all four command grammars and every byte split", async () => {
    for (const kind of [
      "source_page",
      "parse_module",
      "link_page",
      "registration_page",
    ] as const) {
      const bytes = encode(await responseFrames(kind));
      for (let split = 0; split <= bytes.byteLength; split += 1) {
        const decoded = decode([
          bytes.subarray(0, split),
          bytes.subarray(split),
        ], bytes.byteLength);
        expect(decoded).toEqual(bytes);
      }
    }
  }, 30_000);

  it("makes zero allowance inert and accepts bounded 1/1,024 quanta", async () => {
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    const frame = (await responseFrames("source_page"))[0]!;
    const zero = unwrap(factory.append(created.encoder, frame, 0));
    expect(zero.status).toBe("pending");
    expect(zero.receipt.delta.transitions).toBe(0);
    const one = unwrap(factory.append(created.encoder, frame, 1));
    expect(one.status).toBe("pending");
    expect(one.receipt.delta.transitions).toBe(0);
    const accepted = unwrap(factory.append(created.encoder, frame, 1_024));
    expect(accepted.status).toBe("accepted");
    expect(accepted.receipt.delta.transitions).toBeGreaterThan(1);
    expect(failureReason(factory.append(created.encoder, frame, 1_025))).toBe(
      "invalidInput",
    );
    expect(failureReason(factory.append(created.encoder, frame, 1_024))).toBe(
      "exhausted",
    );
  });

  it("does not inspect a pending frame and preserves nested limit failures", async () => {
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    let accesses = 0;
    const pendingFrame = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        accesses += 1;
        throw new Error("must remain untouched");
      },
    });
    const pending = unwrap(factory.append(created.encoder, pendingFrame, 1));
    expect(pending.status).toBe("pending");
    expect(accesses).toBe(0);

    const limited = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const limitedEncoder = unwrap(limited.createEncoder({
      budget: { ...budget, maximumFrameBytes: 1 },
    })).encoder;
    const output = (await responseFrames("source_page")).find(frame =>
      frame.kind === "output_manifest"
    );
    const failure = limited.append(limitedEncoder, output, 1_024);
    expect(Result.isFailure(failure)).toBe(true);
    if (Result.isFailure(failure)) {
      expect(failure.failure.reason).toBe("frameBytesExceeded");
      expect(failure.failure.protocolCause?.reason).toBe("frameBytesExceeded");
    }
  });

  it("precharges protocol work before writing and settles exact successful work", async () => {
    const frames = await responseFrames("source_page");
    const header = frames[0]!;
    const output = frames[1]!;
    if (output.kind !== "output_manifest") {
      throw new Error("Expected output manifest.");
    }
    const protocol = captureProtocolWork(output.frame);
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    const headerStep = unwrap(factory.append(created.encoder, header, 1_024));
    const outputEncodingStep = unwrap(
      factory.append(created.encoder, output, 1_024),
    );
    expect(outputEncodingStep.status).toBe("pending");
    const outputStep = unwrap(factory.append(created.encoder, output, 1_024));
    expect(outputStep.status).toBe("accepted");
    const wrapperByteLength = 5 + protocol.canonicalByteLength;
    expect(outputEncodingStep.receipt.delta).toEqual(Object.freeze({
      bodyBytes: 4 + wrapperByteLength,
      canonicalBytes: 4 + wrapperByteLength,
      frameBytes: 4 + wrapperByteLength,
      payloadBytes: 0,
      frames: 1,
      allocationBytes: 4 + wrapperByteLength +
        protocol.encoding.byteStorageAllocationBytes,
      copyBytes: protocol.encoding.byteCopyBytes,
      transitions: wrapperByteLength + 1 +
        protocol.encoding.primitiveTransitions,
    }));
    expect(outputStep.receipt.delta).toEqual(Object.freeze({
      bodyBytes: 0,
      canonicalBytes: 0,
      frameBytes: 0,
      payloadBytes: 0,
      frames: 0,
      allocationBytes: protocol.verification.byteStorageAllocationBytes,
      copyBytes: protocol.verification.byteCopyBytes,
      transitions: protocol.verification.primitiveTransitions,
    }));
    expect(outputEncodingStep.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    expect(outputStep.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    expect(protocol.verification.primitiveTransitions).toBeLessThan(
      protocol.verificationCeiling.primitiveTransitions,
    );

    for (const dimension of [
      "allocationBytes",
      "copyBytes",
      "transitions",
    ] as const) {
      const verificationActual = dimension === "allocationBytes"
        ? protocol.verification.byteStorageAllocationBytes
        : dimension === "copyBytes"
        ? protocol.verification.byteCopyBytes
        : protocol.verification.primitiveTransitions;
      const verificationCeiling = dimension === "allocationBytes"
        ? protocol.verificationCeiling.byteStorageAllocationBytes
        : dimension === "copyBytes"
        ? protocol.verificationCeiling.byteCopyBytes
        : protocol.verificationCeiling.primitiveTransitions;
      const exactMaximum = outputStep.receipt.aggregate[dimension] -
        verificationActual + verificationCeiling;
      const exactFactory =
        makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
      const exactCreated = unwrap(exactFactory.createEncoder({
        budget: {
          ...budget,
          [`maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}`]:
            exactMaximum,
        },
      }));
      unwrap(exactFactory.append(exactCreated.encoder, header, 1_024));
      expect(unwrap(
        exactFactory.append(exactCreated.encoder, output, 1_024),
      ).status).toBe("pending");
      expect(Result.isSuccess(
        exactFactory.append(exactCreated.encoder, output, 1_024),
      )).toBe(true);

      const limitedFactory =
        makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
      const limitedCreated = unwrap(limitedFactory.createEncoder({
        budget: {
          ...budget,
          [`maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}`]:
            exactMaximum - 1,
        },
      }));
      unwrap(limitedFactory.append(limitedCreated.encoder, header, 1_024));
      const limitedEncoding = limitedFactory.append(
        limitedCreated.encoder,
        output,
        1_024,
      );
      if (Result.isFailure(limitedEncoding)) {
        expect(limitedEncoding.failure.reason).toBe(`${dimension}Exceeded`);
      } else {
        expect(limitedEncoding.success.status).toBe("pending");
        expect(failureReason(
          limitedFactory.append(limitedCreated.encoder, output, 1_024),
        )).toBe(`${dimension}Exceeded`);
      }
    }

    const body = encode(frames);
    const advanceDecoderToOutput = (
      selectedBudget: DeclarativeV2AuthenticatedCommandResponseBudgetV1,
    ) => {
      const decoderFactory =
        makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
      const decoder = unwrap(decoderFactory.createDecoder({
        bodyByteLength: body.byteLength,
        budget: selectedBudget,
      })).decoder;
      let offset = 0;
      while (offset < body.byteLength) {
        const copied = unwrap(decoderFactory.stepDecoder(
          decoder,
          body.subarray(offset),
          1_024,
        ));
        offset += copied.consumedBytes;
      }
      let lastStep = unwrap(decoderFactory.finishDecoder(decoder, 1_024));
      expect(lastStep.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
      for (let index = 1; index < 4; index += 1) {
        lastStep = unwrap(decoderFactory.finishDecoder(decoder, 1_024));
        expect(lastStep.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
      }
      return Object.freeze({
        decoderFactory,
        decoder,
        before: lastStep.receipt.aggregate,
      });
    };
    const decoderProbe = advanceDecoderToOutput(budget);
    const decodedOutput = unwrap(
      decoderProbe.decoderFactory.finishDecoder(
        decoderProbe.decoder,
        1_024,
      ),
    );
    expect(decodedOutput.receipt.delta).toEqual(Object.freeze({
      bodyBytes: 0,
      canonicalBytes: 0,
      frameBytes: 0,
      payloadBytes: 0,
      frames: 0,
      allocationBytes: protocol.verification.byteStorageAllocationBytes,
      copyBytes: protocol.verification.byteCopyBytes,
      transitions: protocol.verification.primitiveTransitions,
    }));
    const decoderTransitionCeiling =
      decoderProbe.before.transitions +
      protocol.verificationCeiling.primitiveTransitions;
    const exactDecoder = advanceDecoderToOutput({
      ...budget,
      maximumTransitions: decoderTransitionCeiling,
    });
    expect(Result.isSuccess(
      exactDecoder.decoderFactory.finishDecoder(
        exactDecoder.decoder,
        1_024,
      ),
    )).toBe(true);
    const limitedDecoder = advanceDecoderToOutput({
      ...budget,
      maximumTransitions: decoderTransitionCeiling - 1,
    });
    expect(failureReason(
      limitedDecoder.decoderFactory.finishDecoder(
        limitedDecoder.decoder,
        1_024,
      ),
    )).toBe("transitionsExceeded");

    expect(headerStep.receipt.aggregate.transitions).toBeGreaterThan(0);
  });

  it("admits all metadata before page payload and validates page digests", async () => {
    const frames = await responseFrames("parse_module");
    const payloadIndex = frames.findIndex(frame =>
      frame.kind === "payload"
    );
    const terminalIndex = frames.findIndex(frame =>
      frame.kind === "response_terminal"
    );
    expect(payloadIndex).toBeGreaterThan(terminalIndex);
    expect(decode([encode(frames)], encode(frames).byteLength)).toEqual(
      encode(frames),
    );

    const bad = frames.map(frame =>
      frame.kind === "payload"
        ? { ...frame, bytes: Uint8Array.of(9, 9, 9) }
        : frame
    );
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    for (const frame of bad) {
      for (;;) {
        const step = factory.append(created.encoder, frame, 1_024);
        if (Result.isFailure(step)) {
          expect(step.failure.reason).toBe("lineageMismatch");
          return;
        }
        if (step.success.status === "accepted") break;
      }
    }
    for (;;) {
      const finished = factory.finishEncoder(created.encoder, 1_024);
      if (Result.isFailure(finished)) {
        expect(finished.failure.reason).toBe("lineageMismatch");
        break;
      }
      if (finished.success.status === "complete") {
        throw new Error("Expected page lineage failure.");
      }
    }
  });

  it("keeps the largest admitted payload frame within one 1,024-transition quantum", async () => {
    const exactPayload = new Uint8Array(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PAYLOAD_QUANTUM_BYTES_V1,
    ).fill(7);
    const exactFrames = await responseFramesWithPayload(exactPayload);
    const exact = encodeResultWithReceipt(
      makeDeclarativeV2AuthenticatedCommandResponseFactoryV1(),
      exactFrames,
      budget,
    );
    const exactBytes = readResult(exact.factory, exact.result);
    expect(exactBytes.byteLength).toBeGreaterThan(0);
    expect(decode([exactBytes], exactBytes.byteLength)).toEqual(exactBytes);
    expect(() => encode(exactFrames, {
      ...budget,
      maximumCopyBytes: exact.receipt.aggregate.copyBytes - 1,
    })).toThrow(/copyBytesExceeded/);

    const oversized = new Uint8Array(exactPayload.byteLength + 1).fill(7);
    const oversizedFrames = await responseFramesWithPayload(oversized);
    expect(encodeFailure(oversizedFrames)).toBe("payloadBytesExceeded");
  });

  it("validates a multi-page response in bounded resumable finish quanta", async () => {
    const frames = await responseFramesWithPageCount(8);
    const bytes = encode(frames);
    expect(decode([bytes], bytes.byteLength)).toEqual(bytes);
  });

  it("rejects missing, reordered, duplicate, trailing, and wrong-kind frames", async () => {
    const frames = await responseFrames("source_page");
    const cases = [
      frames.slice(1),
      [frames[0]!, frames[2]!, frames[1]!, ...frames.slice(3)],
      [frames[0]!, frames[0]!, ...frames.slice(1)],
      [...frames, frames.at(-1)!],
      [
        { ...(frames[0] as object), kind: "command_receipt" },
        ...frames.slice(1),
      ],
    ];
    for (const candidate of cases) {
      expect(encodeFailure(candidate)).toBeDefined();
    }
  });

  it("rejects resulting usage and command receipt as unrecognized grammar", async () => {
    const frames = await responseFrames("registration_page");
    expect(encodeFailure([
      ...frames.slice(0, 2),
      { kind: "resulting_attempt_usage", frame: attemptUsage() },
      ...frames.slice(2),
    ])).toBe("invalidGrammar");
    expect(encodeFailure([
      ...frames,
      { kind: "command_receipt", bytes: Uint8Array.of(1) },
    ])).toBeDefined();
  });

  it("fails closed for hostile records, aliases, and detached bytes", async () => {
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    expect(failureReason(factory.createEncoder(new Proxy({}, {
      ownKeys() {
        throw new Error("hostile");
      },
    })))).toBe("invalidInput");
    expect(failureReason(factory.createEncoder({
      get budget() {
        throw new Error("must not run");
      },
    }))).toBe("invalidInput");

    const frames = await responseFrames("source_page");
    const payload = frames.find(frame => frame.kind === "payload");
    if (payload?.kind === "payload") {
      const original = payload.bytes[0];
      const bytes = encode(frames);
      payload.bytes[0] = (original ?? 0) ^ 0xff;
      expect(encode(await responseFrames("source_page"))).toEqual(bytes);
    }

    const detached = new Uint8Array([1, 2, 3]);
    structuredClone(detached, { transfer: [detached.buffer] });
    const created = unwrap(factory.createDecoder({
      bodyByteLength: 3,
      budget,
    }));
    expect(failureReason(factory.stepDecoder(
      created.decoder,
      detached,
      3,
    ))).toBe("invalidInput");
  });

  it("rejects forged, cross-factory, cross-result, exhausted, and closed handles", async () => {
    const first = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const second = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const created = unwrap(first.createEncoder({ budget }));
    expect(failureReason(second.append(created.encoder, {}, 1))).toBe(
      "staleAuthority",
    );
    expect(failureReason(first.append(
      Object.freeze({
        _tag: "DeclarativeV2AuthenticatedCommandResponseEncoderV1",
      }),
      {},
      1,
    ))).toBe("staleAuthority");

    const resultA = encodeResult(first, await responseFrames("source_page"));
    const resultB = encodeResult(first, await responseFrames("registration_page"));
    const cursor = unwrap(first.openCursor(resultA)).cursor;
    expect(failureReason(first.stepCursor(resultB, cursor, 1))).toBe(
      "staleAuthority",
    );
    expect(Result.isSuccess(first.close(cursor))).toBe(true);
    expect(failureReason(first.stepCursor(resultA, cursor, 1))).toBe("closed");
    expect(failureReason(first.close(resultA))).toBe("closed");
    expect(failureReason(first.openCursor(resultA))).toBe("closed");
  });

  it("meters one result-bound cursor cumulatively and releases bytes on exhaustion", async () => {
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const result = encodeResult(factory, await responseFrames("source_page"));
    const opened = unwrap(factory.openCursor(result));
    expect(failureReason(factory.openCursor(result))).toBe("exhausted");
    const zero = unwrap(factory.stepCursor(result, opened.cursor, 0));
    expect(zero.status).toBe("pending");
    expect(zero.receipt.delta.transitions).toBe(0);
    let previous = opened.receipt.aggregate.copyBytes;
    for (;;) {
      const step = unwrap(factory.stepCursor(result, opened.cursor, 1));
      if (step.status === "complete") break;
      if (step.status === "chunk") {
        expect(step.bytes.byteLength).toBe(1);
        expect(step.receipt.aggregate.copyBytes).toBe(previous + 1);
        previous = step.receipt.aggregate.copyBytes;
      }
    }
    expect(failureReason(factory.stepCursor(result, opened.cursor, 1))).toBe(
      "closed",
    );
    expect(failureReason(factory.openCursor(result))).toBe("closed");
  });

  it("releases result bytes when cursor budget exhaustion terminalizes output", async () => {
    const frames = await responseFrames("source_page");
    const probeFactory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const probeCreated = unwrap(probeFactory.createEncoder({ budget }));
    for (const frame of frames) {
      appendUntilAccepted(probeFactory, probeCreated.encoder, frame);
    }
    let probeFinished:
      | ReturnType<typeof probeFactory.finishEncoder> extends Result.Result<
        infer A,
        unknown
      > ? A
      : never;
    for (;;) {
      probeFinished = unwrap(
        probeFactory.finishEncoder(probeCreated.encoder, 1_024),
      );
      if (probeFinished.status === "complete") break;
    }
    if (probeFinished.status !== "complete") throw new Error("probe incomplete");

    const exactEncodingCopyBudget = probeFinished.receipt.aggregate.copyBytes;
    const limitedBudget = {
      ...budget,
      maximumCopyBytes: exactEncodingCopyBudget,
    };
    const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
    const result = encodeResult(factory, frames, limitedBudget);
    const cursor = unwrap(factory.openCursor(result)).cursor;
    expect(failureReason(factory.stepCursor(result, cursor, 1))).toBe(
      "copyBytesExceeded",
    );
    expect(failureReason(factory.openCursor(result))).toBe("closed");
    expect(failureReason(factory.close(result))).toBe("closed");
  });

  it("enforces exact and one-less decoder limits", async () => {
    const bytes = encode(await responseFrames("source_page"));
    const exact = {
      ...budget,
      maximumBodyBytes: bytes.byteLength,
      maximumAllocationBytes: bytes.byteLength + 10_000,
    };
    expect(() => decode([bytes], bytes.byteLength, exact)).not.toThrow();
    expect(() => decode(
      [bytes],
      bytes.byteLength,
      { ...exact, maximumBodyBytes: bytes.byteLength - 1 },
    )).toThrow(/bodyBytesExceeded/);
    expect(() => decode(
      [bytes],
      bytes.byteLength,
      { ...exact, maximumAllocationBytes: bytes.byteLength - 1 },
    )).toThrow(/allocationBytesExceeded/);
  });

  it("preserves request and monolithic identities and keeps the root closed", async () => {
    const root = await import("@flarex/executor-http");
    expect(
      "makeDeclarativeV2AuthenticatedCommandResponseFactoryV1" in root,
    ).toBe(false);
    const request = await import(
      "../src/declarativeV2AuthenticatedCommandV1"
    );
    expect(request.DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1)
      .toBe("flarex.executor-http/declarative-v2-authenticated-command/v1");
  }, 15_000);
});

function encode(
  frames: readonly unknown[],
  selectedBudget = budget,
): Uint8Array {
  const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
  const result = encodeResult(factory, frames, selectedBudget);
  return readResult(factory, result);
}

function encodeResult(
  factory: DeclarativeV2AuthenticatedCommandResponseFactoryV1,
  frames: readonly unknown[],
  selectedBudget = budget,
): DeclarativeV2AuthenticatedCommandResponseResultV1 {
  return encodeResultWithReceipt(factory, frames, selectedBudget).result;
}

function encodeResultWithReceipt(
  factory: DeclarativeV2AuthenticatedCommandResponseFactoryV1,
  frames: readonly unknown[],
  selectedBudget = budget,
): Readonly<{
  readonly factory: DeclarativeV2AuthenticatedCommandResponseFactoryV1;
  readonly result: DeclarativeV2AuthenticatedCommandResponseResultV1;
  readonly receipt: Readonly<{
    readonly aggregate: DeclarativeV2AuthenticatedCommandResponseUsageV1;
  }>;
}> {
  const created = unwrap(factory.createEncoder({ budget: selectedBudget }));
  for (const frame of frames) {
    appendUntilAccepted(factory, created.encoder, frame);
  }
  for (;;) {
    const finished = unwrap(factory.finishEncoder(created.encoder, 1_024));
    expect(finished.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    if (finished.status === "complete") {
      return Object.freeze({
        factory,
        result: finished.result,
        receipt: finished.receipt,
      });
    }
  }
}

function readResult(
  factory: DeclarativeV2AuthenticatedCommandResponseFactoryV1,
  result: DeclarativeV2AuthenticatedCommandResponseResultV1,
): Uint8Array {
  const cursor = unwrap(factory.openCursor(result)).cursor;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const step = unwrap(factory.stepCursor(result, cursor, 1_024));
    expect(step.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    if (step.status === "complete") break;
    if (step.status === "pending") continue;
    chunks.push(step.bytes);
    length += step.bytes.byteLength;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decode(
  chunks: readonly Uint8Array[],
  bodyByteLength: number,
  selectedBudget = budget,
): Uint8Array {
  const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
  const created = unwrap(factory.createDecoder({
    bodyByteLength,
    budget: selectedBudget,
  }));
  for (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const step = unwrap(factory.stepDecoder(
        created.decoder,
        chunk.subarray(offset),
        1_024,
      ));
      if (step.consumedBytes === 0) throw new Error("decoder stalled");
      offset += step.consumedBytes;
    }
  }
  let result: DeclarativeV2AuthenticatedCommandResponseResultV1 | undefined;
  for (;;) {
      const step = unwrap(factory.finishDecoder(created.decoder, 1_024));
      expect(step.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
      if (step.status === "complete") {
      result = step.result;
      break;
    }
  }
  return readResult(factory, result);
}

async function responseFrames(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
): Promise<readonly DeclarativeV2AuthenticatedCommandResponseFrameV1[]> {
  const sequence = 1n;
  const reservationSha256 = digest(2);
  const progress = progressCursor(commandKind, sequence);
  const progressSha256 = await hash(progressBytes(progress));
  const emptySha256 = await hash(new Uint8Array());
  const restart = commandKind === "parse_module" || commandKind === "link_page";
  const payload = Uint8Array.of(1, 2, 3);
  let page: DeclarativeV2VerifierEvidencePageManifestFrameV2 | undefined;
  let evidenceRootSha256 = emptySha256;
  if (restart) {
    page = Object.freeze({
      kind: "evidence_page_manifest",
      reservationSha256,
      commandKind,
      sequence,
      pageOrdinal: 0n,
      firstEvidenceOrdinal: 0n,
      evidenceCount: 1n,
      firstDiagnosticOrdinal: 0n,
      diagnosticCount: 0n,
      predecessorPageSha256: null,
      payloadByteLength: BigInt(payload.byteLength),
      payloadSha256: await hash(payload),
      cumulativeDiagnosticsRootSha256: emptySha256,
    });
    evidenceRootSha256 = await hash(progressBytes(page));
  }
  const output = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256,
    commandKind,
    sequence,
    evidenceRootSha256,
    evidenceCount: restart ? 1n : 0n,
    diagnosticsRootSha256: emptySha256,
    diagnosticCount: 0n,
    nextProgressSha256: progressSha256,
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  const frames: DeclarativeV2AuthenticatedCommandResponseFrameV1[] = [
    Object.freeze({
      kind: "response_header",
      requestSha256: digest(1),
      reservationSha256,
      commandKind,
      sequence,
      analyzerReleaseSha256: digest(3),
      analyzerIdentitySha256: digest(4),
      verifierIdentitySha256: digest(5),
      rangeAndPredecessorTailsSha256: digest(6),
    }),
    Object.freeze({ kind: "output_manifest", frame: output }),
    Object.freeze({ kind: "actual_command_usage", frame: attemptUsage() }),
    Object.freeze({ kind: "next_progress", frame: progress }),
  ];
  if (page !== undefined) {
    frames.push(Object.freeze({ kind: "page_manifest", frame: page }));
  }
  frames.push(Object.freeze({
    kind: "response_terminal",
    pageCount: restart ? 1n : 0n,
    pagePayloadByteLength: restart ? BigInt(payload.byteLength) : 0n,
    evidenceByteLength: 0n,
    diagnosticByteLength: 0n,
  }));
  if (restart) {
    frames.push(Object.freeze({
      kind: "payload",
      role: "page",
      ordinal: 0n,
      offset: 0n,
      bytes: payload,
    }));
  }
  return frames;
}

async function responseFramesWithPayload(
  payload: Uint8Array,
): Promise<readonly DeclarativeV2AuthenticatedCommandResponseFrameV1[]> {
  const frames = [...await responseFrames("parse_module")];
  const pageIndex = frames.findIndex(frame => frame.kind === "page_manifest");
  const outputIndex = frames.findIndex(frame => frame.kind === "output_manifest");
  const payloadIndex = frames.findIndex(frame => frame.kind === "payload");
  const pageFrame = frames[pageIndex];
  const outputFrame = frames[outputIndex];
  if (
    pageFrame?.kind !== "page_manifest" ||
    outputFrame?.kind !== "output_manifest" ||
    payloadIndex < 0
  ) {
    throw new Error("Missing restart response fixtures.");
  }
  const page = Object.freeze({
    ...pageFrame.frame,
    payloadByteLength: BigInt(payload.byteLength),
    payloadSha256: await hash(payload),
  });
  frames[pageIndex] = Object.freeze({ kind: "page_manifest", frame: page });
  frames[outputIndex] = Object.freeze({
    kind: "output_manifest",
    frame: Object.freeze({
      ...outputFrame.frame,
      evidenceRootSha256: await hash(progressBytes(page)),
    }),
  });
  frames[payloadIndex] = Object.freeze({
    kind: "payload",
    role: "page",
    ordinal: 0n,
    offset: 0n,
    bytes: payload,
  });
  const terminalIndex = frames.findIndex(frame =>
    frame.kind === "response_terminal"
  );
  frames[terminalIndex] = Object.freeze({
    kind: "response_terminal",
    pageCount: 1n,
    pagePayloadByteLength: BigInt(payload.byteLength),
    evidenceByteLength: 0n,
    diagnosticByteLength: 0n,
  });
  return frames;
}

async function responseFramesWithPageCount(
  pageCount: number,
): Promise<readonly DeclarativeV2AuthenticatedCommandResponseFrameV1[]> {
  const commandKind = "parse_module" as const;
  const sequence = 1n;
  const reservationSha256 = digest(2);
  const progress = progressCursor(commandKind, sequence);
  const emptySha256 = await hash(new Uint8Array());
  const pages: DeclarativeV2VerifierEvidencePageManifestFrameV2[] = [];
  const payloads: Uint8Array[] = [];
  let predecessorPageSha256: Uint8Array | null = null;
  for (let index = 0; index < pageCount; index += 1) {
    const payload = Uint8Array.of(index & 0xff);
    const page = Object.freeze({
      kind: "evidence_page_manifest",
      reservationSha256,
      commandKind,
      sequence,
      pageOrdinal: BigInt(index),
      firstEvidenceOrdinal: BigInt(index),
      evidenceCount: 1n,
      firstDiagnosticOrdinal: 0n,
      diagnosticCount: 0n,
      predecessorPageSha256,
      payloadByteLength: 1n,
      payloadSha256: await hash(payload),
      cumulativeDiagnosticsRootSha256: emptySha256,
    }) satisfies DeclarativeV2VerifierEvidencePageManifestFrameV2;
    pages.push(page);
    payloads.push(payload);
    predecessorPageSha256 = await hash(progressBytes(page));
  }
  const output = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256,
    commandKind,
    sequence,
    evidenceRootSha256: predecessorPageSha256 ?? emptySha256,
    evidenceCount: BigInt(pageCount),
    diagnosticsRootSha256: emptySha256,
    diagnosticCount: 0n,
    nextProgressSha256: await hash(progressBytes(progress)),
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  return [
    Object.freeze({
      kind: "response_header",
      requestSha256: digest(1),
      reservationSha256,
      commandKind,
      sequence,
      analyzerReleaseSha256: digest(3),
      analyzerIdentitySha256: digest(4),
      verifierIdentitySha256: digest(5),
      rangeAndPredecessorTailsSha256: digest(6),
    }),
    Object.freeze({ kind: "output_manifest", frame: output }),
    Object.freeze({ kind: "actual_command_usage", frame: attemptUsage() }),
    Object.freeze({ kind: "next_progress", frame: progress }),
    ...pages.map(frame => Object.freeze({ kind: "page_manifest" as const, frame })),
    Object.freeze({
      kind: "response_terminal",
      pageCount: BigInt(pageCount),
      pagePayloadByteLength: BigInt(pageCount),
      evidenceByteLength: 0n,
      diagnosticByteLength: 0n,
    }),
    ...payloads.map((bytes, ordinal) =>
      Object.freeze({
        kind: "payload" as const,
        role: "page" as const,
        ordinal: BigInt(ordinal),
        offset: 0n,
        bytes,
      })
    ),
  ];
}

function attemptUsage(): DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "attempt_usage";
} {
  return Object.freeze({
    kind: "attempt_usage",
    calls: 0n,
    objectCalls: 0n,
    objectBodyBytes: 0n,
    sourceBytes: 0n,
    sourceMapBytes: 0n,
    semanticBytes: 0n,
    modules: 0n,
    importEdges: 0n,
    exports: 0n,
    functions: 0n,
    tokens: 0n,
    tokenBytes: 0n,
    parserStates: 0n,
    nestingDepth: 0n,
    schemaNodes: 0n,
    validatorNodes: 0n,
    graphNodes: 0n,
    frontierEntries: 0n,
    stringBytes: 0n,
    tableBytes: 0n,
    canonicalBytes: 0n,
    frameBytes: 0n,
    hashBytes: 0n,
    diagnosticBytes: 0n,
    outputBytes: 0n,
    elapsedMilliseconds: 0n,
  });
}

function progressCursor(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
  sequence: bigint,
): DeclarativeV2VerifierProgressCursorFrameV2 {
  return Object.freeze({
    kind: "progress_cursor",
    phase: commandKind === "source_page"
      ? "source"
      : commandKind === "parse_module"
      ? "parse"
      : commandKind === "link_page"
      ? "link"
      : "registration",
    settledSequence: sequence,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: null,
  });
}

function progressBytes(
  frame:
    | DeclarativeV2VerifierProgressCursorFrameV2
    | DeclarativeV2VerifierEvidencePageManifestFrameV2,
): Uint8Array {
  const encoded = unwrap(encodeDeclarativeV2VerifierProgressFrameV2(frame, {
    maximumFrameBytes: 1_024,
    maximumCanonicalBytes: 1_024,
  }));
  return encoded.canonicalBytes;
}

function captureProtocolWork(
  frame: DeclarativeV2VerifierCommandOutputManifestFrameV2,
) {
  let encoding:
    | Parameters<
      Parameters<
        typeof encodeDeclarativeV2VerifierProgressFrameIntoV2
      >[2]
    >[0]["successfulWork"]
    | undefined;
  const encoded = unwrap(
    encodeDeclarativeV2VerifierProgressFrameIntoV2(
      frame,
      {
        maximumFrameBytes: 1_024,
        maximumCanonicalBytes: 1_024,
      },
      plan => {
        encoding = plan.successfulWork;
        return Result.succeed(Object.freeze({
          bytes: new Uint8Array(plan.canonicalByteLength),
          byteOffset: 0,
          byteLength: plan.canonicalByteLength,
        }));
      },
    ),
  );
  let verificationCeiling:
    | Parameters<
      Parameters<
        typeof verifyOwnedDeclarativeV2VerifierProgressFrameV2
      >[2]
    >[0]["successfulWorkCeiling"]
    | undefined;
  const verified = unwrap(
    verifyOwnedDeclarativeV2VerifierProgressFrameV2(
      encoded.range,
      {
        maximumFrameBytes: 1_024,
        maximumCanonicalBytes: 1_024,
      },
      plan => {
        verificationCeiling = plan.successfulWorkCeiling;
        return Result.succeed(undefined);
      },
    ),
  );
  if (encoding === undefined || verificationCeiling === undefined) {
    throw new Error("Protocol work admission did not run.");
  }
  return Object.freeze({
    canonicalByteLength: encoded.range.byteLength,
    encoding,
    verification: verified.work,
    verificationCeiling,
  });
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

async function hash(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
}

function encodeFailure(frames: readonly unknown[]): string | undefined {
  const factory = makeDeclarativeV2AuthenticatedCommandResponseFactoryV1();
  const created = unwrap(factory.createEncoder({ budget }));
  for (const frame of frames) {
    for (;;) {
      const step = factory.append(created.encoder, frame, 1_024);
      if (Result.isFailure(step)) return step.failure.reason;
      if (step.success.status === "accepted") break;
    }
  }
  for (;;) {
    const finished = factory.finishEncoder(created.encoder, 1_024);
    if (Result.isFailure(finished)) return finished.failure.reason;
    if (finished.success.status === "complete") return undefined;
  }
}

function appendUntilAccepted(
  factory: DeclarativeV2AuthenticatedCommandResponseFactoryV1,
  encoder: DeclarativeV2AuthenticatedCommandResponseEncoderV1,
  frame: unknown,
): void {
  for (;;) {
    const appended = unwrap(factory.append(encoder, frame, 1_024));
    expect(appended.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    if (appended.status === "accepted") return;
  }
}

function failureReason(
  result: Result.Result<unknown, DeclarativeV2AuthenticatedCommandResponseV1Error>,
): string | undefined {
  return Result.isFailure(result) ? result.failure.reason : undefined;
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) {
    throw new Error(failureText(result.failure));
  }
  return result.success;
}

function failureText(input: unknown): string {
  if (typeof input !== "object" || input === null) return String(input);
  const reason = Object.getOwnPropertyDescriptor(input, "reason");
  const path = Object.getOwnPropertyDescriptor(input, "path");
  return `${"value" in (reason ?? {}) ? String(reason?.value) : "failure"}:${
    "value" in (path ?? {}) ? String(path?.value) : ""
  }`;
}
