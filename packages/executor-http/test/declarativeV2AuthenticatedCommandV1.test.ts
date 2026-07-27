import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierBudgetFrameV2,
  type DeclarativeV2VerifierCommandReservationFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_CHUNKS_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_MEDIA_TYPE_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1,
  decodeDeclarativeV2AuthenticatedCommandRequestChunksV1,
  decodeDeclarativeV2AuthenticatedCommandRequestV1,
  encodeDeclarativeV2AuthenticatedCommandRequestV1,
  makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandFrameV1,
  type DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  type DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  type DeclarativeV2AuthenticatedCommandIncrementalFinishV1,
  type DeclarativeV2AuthenticatedCommandIncrementalUsageV1,
  type DeclarativeV2AuthenticatedCommandIncrementalV1Error,
  type DeclarativeV2AuthenticatedCommandModuleMetadataFrameV1,
  type DeclarativeV2AuthenticatedCommandRequestV1,
  type DeclarativeV2AuthenticatedCommandTransportBudgetV1,
} from "../src/declarativeV2AuthenticatedCommandV1";

const MAX = 2_000_000;
const generousBudget = Object.freeze({
  maximumBodyBytes: MAX,
  maximumCanonicalBytes: MAX,
  maximumFrameBytes: MAX,
  maximumPayloadBytes: MAX,
  maximumFrames:
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1,
  maximumTransitions: MAX,
}) satisfies DeclarativeV2AuthenticatedCommandTransportBudgetV1;

describe("Declarative V2 authenticated command V1 transport", () => {
  it("pins the private protocol identity and produces a two-cold golden", async () => {
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1).toBe(
      "flarex.executor-http/declarative-v2-authenticated-command/v1",
    );
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1).toBe(1);
    expect(DECLARATIVE_V2_AUTHENTICATED_COMMAND_MEDIA_TYPE_V1).toBe(
      "application/vnd.flarex.declarative-v2-authenticated-command-v1",
    );
    const first = encode(parseModuleRequest(), generousBudget);
    const second = encode(parseModuleRequest(), generousBudget);
    expect(second.canonicalBytes).toEqual(first.canonicalBytes);
    expect(first.canonicalBytes.byteLength).toBe(964);
    const digestInput = new Uint8Array(first.canonicalBytes.byteLength);
    digestInput.set(first.canonicalBytes);
    const sha256 = new Uint8Array(
      await crypto.subtle.digest("SHA-256", digestInput),
    );
    expect(hex(sha256)).toBe(
      "3f890ff164ffaf65f7d7afaf970eeb92dde073723c79d328bd3cfd90b7324198",
    );
  });

  it("round-trips all four strict command grammars", () => {
    for (const request of [
      sourcePageRequest(),
      parseModuleRequest(),
      linkPageRequest(),
      registrationPageRequest(),
    ]) {
      const encoded = encode(request, generousBudget);
      const decoded = decode(encoded.canonicalBytes, generousBudget);
      expect(decoded.request).toEqual(encoded.request);
      expect(decoded.canonicalBytes).not.toBe(encoded.canonicalBytes);
      expect(decoded.usage).toEqual(encoded.usage);
    }
  });

  it("decodes identically across every request and UTF-8 byte split", () => {
    for (const request of [
      sourcePageRequest(),
      parseModuleRequest("functions/\u1019\u103C\u1014\u103A\u1019\u102C.js"),
      linkPageRequest(),
      registrationPageRequest(),
    ]) {
      const encoded = encode(request, generousBudget);
      for (let split = 0; split <= encoded.canonicalBytes.byteLength; split += 1) {
        const decoded = unwrap(
          decodeDeclarativeV2AuthenticatedCommandRequestChunksV1([
            encoded.canonicalBytes.subarray(0, split),
            encoded.canonicalBytes.subarray(split),
          ], generousBudget),
        );
        expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
        expect(decoded.usage).toEqual(encoded.usage);
      }
    }
  }, 20_000);

  it("enforces zero, one, 1,024, and 1,025 frame boundaries", () => {
    expect(failureReason(encodeDeclarativeV2AuthenticatedCommandRequestV1(
      { frames: [] },
      generousBudget,
    ))).toBe("invalidGrammar");
    expect(failureReason(encodeDeclarativeV2AuthenticatedCommandRequestV1(
      { frames: [header("link_page")] },
      generousBudget,
    ))).toBe("invalidGrammar");

    const frames: DeclarativeV2AuthenticatedCommandFrameV1[] = [
      header("source_page"),
    ];
    for (let ordinal = 0; ordinal < 1_022; ordinal += 1) {
      frames.push(moduleMetadata(BigInt(ordinal), `m${ordinal}.js`, 0n));
    }
    frames.push(terminal({
      firstModuleOrdinal: 0n,
      moduleCount: 1_022n,
      payloadFrameCount: 1_022n,
    }));
    expect(encode({ frames }, generousBudget).usage.frames).toBe(1_024);
    frames.splice(frames.length - 1, 0, moduleMetadata(1_022n, "overflow.js", 0n));
    expect(failureReason(encodeDeclarativeV2AuthenticatedCommandRequestV1(
      { frames },
      generousBudget,
    ))).toBe("framesExceeded");
  });

  it("preserves every committed command-budget dimension exactly", () => {
    const request = parseModuleRequest();
    const encoded = encode(request, generousBudget);
    const decoded = decode(encoded.canonicalBytes, generousBudget);
    const headerFrame = decoded.request.frames[0];
    expect(headerFrame?.kind).toBe("command_header");
    if (headerFrame?.kind !== "command_header") throw new Error("missing header");
    for (let index = 0; index < DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length; index += 1) {
      const dimension = DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[index]!;
      expect(headerFrame.commandBudget[dimension]).toBe(BigInt(index + 1));
    }
    const omitted = { ...commandBudget() } as Record<string, unknown>;
    delete omitted.frontierEntries;
    expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
      frames: [
        { kind: "command_header", reservation: reservation("link_page"), commandBudget: omitted },
        terminal(),
      ],
    }, generousBudget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
      frames: [
        {
          kind: "command_header",
          reservation: reservation("link_page"),
          commandBudget: { ...commandBudget(), calls: 9_223_372_036_854_775_808n },
        },
        terminal(),
      ],
    }, generousBudget))).toBe(true);
  });

  it("enforces exact and one-less transport ceilings", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const exact = Object.freeze({
      maximumBodyBytes: encoded.usage.bodyBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumFrameBytes: encoded.usage.frameBytes,
      maximumPayloadBytes: encoded.usage.payloadBytes,
      maximumFrames: encoded.usage.frames,
      maximumTransitions: encoded.usage.transitions,
    });
    expect(Result.isSuccess(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(
        encoded.canonicalBytes,
        exact,
      ),
    )).toBe(true);
    const fields = [
      ["maximumBodyBytes", "bodyBytesExceeded"],
      ["maximumCanonicalBytes", "canonicalBytesExceeded"],
      ["maximumFrameBytes", "frameBytesExceeded"],
      ["maximumPayloadBytes", "payloadBytesExceeded"],
      ["maximumFrames", "framesExceeded"],
      ["maximumTransitions", "transitionsExceeded"],
    ] as const;
    for (const [field, reason] of fields) {
      expect(failureReason(
        decodeDeclarativeV2AuthenticatedCommandRequestV1(
          encoded.canonicalBytes,
          { ...exact, [field]: exact[field] - 1 },
        ),
      )).toBe(reason);
    }
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(
        encoded.canonicalBytes,
        { ...generousBudget, maximumFrameBytes: 1 },
      ),
    )).toBe("frameBytesExceeded");
  });

  it("rejects oversized hostile frame and chunk arrays before enumeration", () => {
    const oversizedFrames = new Proxy(
      new Array(DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_FRAMES_V1 + 1),
      {
        ownKeys() {
          throw new Error("must reject from length before enumeration");
        },
      },
    );
    expect(failureReason(
      encodeDeclarativeV2AuthenticatedCommandRequestV1(
        { frames: oversizedFrames },
        generousBudget,
      ),
    )).toBe("framesExceeded");

    const admittedEmptyChunks = new Array<Uint8Array>(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_CHUNKS_V1,
    ).fill(new Uint8Array());
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestChunksV1(
        admittedEmptyChunks,
        generousBudget,
      ),
    )).toBe("malformed");

    const oversizedChunks = new Proxy(
      new Array(
        DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_CHUNKS_V1 + 1,
      ),
      {
        ownKeys() {
          throw new Error("must reject from length before enumeration");
        },
      },
    );
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestChunksV1(
        oversizedChunks,
        generousBudget,
      ),
    )).toBe("chunksExceeded");
  });

  it("rejects missing, duplicate, reordered, mixed, and trailing frames", () => {
    const parse = parseModuleRequest().frames;
    const cases: readonly (readonly DeclarativeV2AuthenticatedCommandFrameV1[])[] = [
      parse.slice(1),
      [...parse, terminal()],
      [parse[0]!, parse[2]!, parse[1]!, parse[3]!],
      [parse[0]!, parse[1]!, semanticBytes(0n, "x"), parse[3]!],
      [parse[0]!, parse[1]!, parse[2]!],
      [header("source_page"), moduleMetadata(2n, "a.js", 0n), terminal({
        firstModuleOrdinal: 1n,
        moduleCount: 1n,
        payloadFrameCount: 1n,
      })],
    ];
    for (const frames of cases) {
      expect(Result.isFailure(
        encodeDeclarativeV2AuthenticatedCommandRequestV1(
          { frames },
          generousBudget,
        ),
      )).toBe(true);
    }
    const encoded = encode(parseModuleRequest(), generousBudget);
    const trailing = new Uint8Array(encoded.canonicalBytes.byteLength + 1);
    trailing.set(encoded.canonicalBytes);
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(trailing, generousBudget),
    )).toBe("malformed");
  });

  it("rejects wrong command kinds and forbidden finalize without coercion", () => {
    expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
      frames: [
        header("parse_module"),
        terminal(),
      ],
    }, generousBudget))).toBe(true);
    expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
      frames: [
        {
          kind: "command_header",
          reservation: {
            ...reservation("source_page"),
            commandKind: "finalize",
          },
          commandBudget: commandBudget(),
        },
        terminal(),
      ],
    }, generousBudget))).toBe(true);
  });

  it("rejects malformed UTF-8, NUL paths, oversized quanta, and noncanonical envelopes", () => {
    for (const modulePathBytes of [
      Uint8Array.of(0xff),
      new TextEncoder().encode("a\0b.js"),
    ]) {
      expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
        frames: [
          header("source_page"),
          {
            ...moduleMetadata(0n, "a.js", 0n),
            modulePathBytes,
          },
          terminal({ moduleCount: 1n, payloadFrameCount: 1n }),
        ],
      }, generousBudget))).toBe(true);
    }
    expect(Result.isFailure(encodeDeclarativeV2AuthenticatedCommandRequestV1({
      frames: [
        header("parse_module"),
        moduleMetadata(0n, "a.js", BigInt(
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 + 1,
        )),
        sourceBytes(
          0n,
          0n,
          new Uint8Array(
            DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 + 1,
          ),
        ),
        terminal({
          moduleCount: 1n,
          sourceByteLength: BigInt(
            DECLARATIVE_V2_AUTHENTICATED_COMMAND_MAXIMUM_PAYLOAD_QUANTUM_BYTES_V1 + 1,
          ),
          payloadFrameCount: 2n,
        }),
      ],
    }, generousBudget))).toBe(true);

    const encoded = encode(linkPageRequest(), generousBudget);
    const wrongVersion = new Uint8Array(encoded.canonicalBytes);
    const domainLength = readU32(wrongVersion, 0);
    wrongVersion[4 + domainLength + 3] = 2;
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(wrongVersion, generousBudget),
    )).toBe("unsupportedVersion");

    const unknownFrame = new Uint8Array(encoded.canonicalBytes);
    const firstFrameTagOffset = 4 + domainLength + 4 + 4 + 4;
    unknownFrame[firstFrameTagOffset] = 0xff;
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(unknownFrame, generousBudget),
    )).toBe("malformed");
  });

  it("maps hostile records, accessors, proxies, and detached views to typed failures", () => {
    const accessor = {
      get frames(): never {
        throw new Error("must not run");
      },
    };
    expect(failureReason(
      encodeDeclarativeV2AuthenticatedCommandRequestV1(accessor, generousBudget),
    )).toBe("invalidInput");

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(failureReason(
      encodeDeclarativeV2AuthenticatedCommandRequestV1(revoked.proxy, generousBudget),
    )).toBe("invalidInput");

    const hostileFrames = new Proxy([], {
      ownKeys() {
        throw new Error("trap");
      },
    });
    expect(failureReason(
      encodeDeclarativeV2AuthenticatedCommandRequestV1(
        { frames: hostileFrames },
        generousBudget,
      ),
    )).toBe("invalidInput");

    const encoded = encode(linkPageRequest(), generousBudget);
    const detached = new Uint8Array(encoded.canonicalBytes);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(detached, generousBudget),
    )).toBe("invalidInput");
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(
        new Proxy(encoded.canonicalBytes, {}),
        generousBudget,
      ),
    )).toBe("invalidInput");
  });

  it("detaches all caller-owned bytes and ignores overridden iterators", () => {
    const path = new TextEncoder().encode("owned.js");
    const source = new TextEncoder().encode("export const owned = true;");
    const frameDigest = digest(8);
    Object.defineProperty(path, Symbol.iterator, {
      value: () => {
        throw new Error("iterator must not run");
      },
    });
    const request: DeclarativeV2AuthenticatedCommandRequestV1 = {
      frames: [
        header("parse_module"),
        {
          ...moduleMetadata(0n, "owned.js", BigInt(source.byteLength)),
          modulePathBytes: path,
          frameSha256: frameDigest,
        },
        sourceBytes(0n, 0n, source),
        terminal({
          moduleCount: 1n,
          sourceByteLength: BigInt(source.byteLength),
          payloadFrameCount: 2n,
        }),
      ],
    };
    const encoded = encode(request, generousBudget);
    path.fill(0);
    source.fill(0);
    frameDigest.fill(0);
    const decoded = decode(encoded.canonicalBytes, generousBudget);
    const metadata = decoded.request.frames[1];
    const sourceFrame = decoded.request.frames[2];
    expect(metadata?.kind).toBe("module_metadata");
    expect(sourceFrame?.kind).toBe("source_bytes");
    if (metadata?.kind !== "module_metadata" || sourceFrame?.kind !== "source_bytes") {
      throw new Error("unexpected frames");
    }
    expect(new TextDecoder().decode(metadata.modulePathBytes)).toBe("owned.js");
    expect(new TextDecoder().decode(sourceFrame.bytes)).toBe(
      "export const owned = true;",
    );
    expect(metadata.frameSha256).toEqual(digest(8));
  });

  it("keeps existing durable protocol identities and bytes unchanged", () => {
    expect(DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2).toBe(
      "flarex.declarative-v2/verifier-budget/v2",
    );
    expect(DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2).toBe(
      "flarex.declarative-v2/verifier-progress-static/v2",
    );
    const encoded = unwrap(encodeDeclarativeV2VerifierProgressFrameV2(
      reservation("parse_module"),
      { maximumFrameBytes: 4_096, maximumCanonicalBytes: 4_096 },
    ));
    expect(encoded.canonicalBytes.byteLength).toBe(379);
    expect(hex(encoded.canonicalBytes).slice(0, 96)).toBe(
      "666c617265782e6465636c617261746976652d76322f636f6d6d616e645f7265736572766174696f6e2f763200000000",
    );
  });

  it("incrementally admits every split with two-cold byte and usage equality", () => {
    for (const request of [
      sourcePageRequest(),
      parseModuleRequest("functions/\u1019\u103C\u1014\u103A\u1019\u102C.js"),
      linkPageRequest(),
      registrationPageRequest(),
    ]) {
      const encoded = encode(request, generousBudget);
      const budget = incrementalBudget(encoded.canonicalBytes.byteLength);
      const first = driveIncremental(
        makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
        encoded.canonicalBytes,
        budget,
        [encoded.canonicalBytes.byteLength],
        1_024,
      );
      const second = driveIncremental(
        makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
        encoded.canonicalBytes,
        budget,
        [encoded.canonicalBytes.byteLength],
        1,
      );
      expect(first.usage).toEqual(encoded.usage);
      expect(second.usage).toEqual(encoded.usage);
      expect(second.aggregate).toEqual(first.aggregate);
      for (let split = 0; split <= encoded.canonicalBytes.byteLength; split += 1) {
        const splitResult = driveIncremental(
          makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
          encoded.canonicalBytes,
          budget,
          [split, encoded.canonicalBytes.byteLength - split],
          1_024,
        );
        expect(splitResult.usage).toEqual(encoded.usage);
        expect(splitResult.aggregate).toEqual(first.aggregate);
      }
    }
  }, 30_000);

  it("independently re-encodes canonical structure before capability creation", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const frames = commandFrameRanges(encoded.canonicalBytes);
    const header = frames[0]!;
    const reservationLength = readU32(
      encoded.canonicalBytes,
      header.start + 1,
    );
    const budgetStart = header.start + 1 + 4 + reservationLength + 4;
    const budgetDomainLength = new TextEncoder().encode(
      "flarex.declarative-v2/command_budget/v2\0",
    ).byteLength;
    const nonCanonical = new Uint8Array(encoded.canonicalBytes);
    nonCanonical[budgetStart + budgetDomainLength + 3] ^= 1;

    expect(incrementalFailureReason(attemptIncremental(
      nonCanonical,
      incrementalBudget(nonCanonical.byteLength),
    ))).toBe("nonCanonical");
    expect(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(
        nonCanonical,
        generousBudget,
      ),
    )).toBe("malformed");
  });

  it("rejects a duplicate complete header through the typed terminal boundary", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const duplicateHeader = insertDuplicateFirstFrame(encoded.canonicalBytes);
    const factory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    const created = unwrap(factory.create({
      bodyByteLength: duplicateHeader.byteLength,
      budget: incrementalBudget(duplicateHeader.byteLength),
    }));
    let inputOffset = 0;
    while (inputOffset < duplicateHeader.byteLength) {
      const stepped = unwrap(factory.step(
        created.decoder,
        duplicateHeader.subarray(inputOffset),
        1_024,
      ));
      expect(stepped.consumedBytes).toBeGreaterThan(0);
      inputOffset += stepped.consumedBytes;
    }
    let failure: DeclarativeV2AuthenticatedCommandIncrementalV1Error | undefined;
    while (failure === undefined) {
      const finished = factory.finish(created.decoder, 1_024);
      if (Result.isFailure(finished)) {
        failure = finished.failure;
      }
    }
    expect(failure.reason).toBe("invalidGrammar");
    expect(incrementalFailureReason(factory.finish(created.decoder, 1)))
      .toBe("closed");
  });

  it("pins allowance zero, one, 1,024, and 1,025 terminal behavior", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const factory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    const created = unwrap(factory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget: incrementalBudget(encoded.canonicalBytes.byteLength),
    }));
    const zero = unwrap(factory.step(
      created.decoder,
      new Proxy(encoded.canonicalBytes, {
        get() {
          throw new Error("zero allowance must not inspect input");
        },
      }),
      0,
    ));
    expect(zero).toMatchObject({
      status: "pending",
      consumedBytes: 0,
      receipt: { transitionCount: 0 },
    });
    expect(unwrap(factory.finish(created.decoder, 0))).toMatchObject({
      status: "pending",
      receipt: { transitionCount: 0 },
    });
    expect(unwrap(factory.step(
      created.decoder,
      encoded.canonicalBytes,
      1,
    )).consumedBytes).toBe(1);
    expect(incrementalFailureReason(factory.step(
      created.decoder,
      encoded.canonicalBytes.subarray(1),
      1_025,
    ))).toBe("invalidInput");
    expect(incrementalFailureReason(factory.step(
      created.decoder,
      encoded.canonicalBytes.subarray(1),
      1,
    ))).toBe("closed");

    const maximum = driveIncremental(
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
      encoded.canonicalBytes,
      incrementalBudget(encoded.canonicalBytes.byteLength),
      [encoded.canonicalBytes.byteLength],
      1_024,
    );
    expect(maximum.usage).toEqual(encoded.usage);

    const finishFactory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    const finishCreated = unwrap(finishFactory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget: incrementalBudget(encoded.canonicalBytes.byteLength),
    }));
    unwrap(finishFactory.step(
      finishCreated.decoder,
      encoded.canonicalBytes,
      1_024,
    ));
    expect(incrementalFailureReason(
      finishFactory.finish(finishCreated.decoder, 1_025),
    )).toBe("invalidInput");
    expect(incrementalFailureReason(
      finishFactory.finish(finishCreated.decoder, 1),
    )).toBe("closed");
  });

  it("precharges exact and one-less incremental allocation, copy, and transition ceilings", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const bodyLength = encoded.canonicalBytes.byteLength;
    const baseline = driveIncremental(
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
      encoded.canonicalBytes,
      incrementalBudget(bodyLength),
      [bodyLength],
      1_024,
    );
    const exact = Object.freeze({
      ...incrementalBudget(bodyLength),
      maximumBodyBytes: encoded.usage.bodyBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumFrameBytes: encoded.usage.frameBytes,
      maximumPayloadBytes: encoded.usage.payloadBytes,
      maximumFrames: encoded.usage.frames,
      maximumAllocationBytes: baseline.aggregate.allocationBytes,
      maximumCopyBytes: baseline.aggregate.copyBytes,
      maximumTransitions: baseline.aggregate.transitions,
    });
    const completed = driveIncremental(
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1(),
      encoded.canonicalBytes,
      exact,
      [bodyLength],
      1_024,
    );
    expect(completed.aggregate).toMatchObject({
      bodyBytes: bodyLength,
      canonicalBytes: bodyLength,
      frameBytes: encoded.usage.frameBytes,
      payloadBytes: encoded.usage.payloadBytes,
      frames: encoded.usage.frames,
      transitions: baseline.aggregate.transitions,
      allocationBytes: baseline.aggregate.allocationBytes,
      copyBytes: baseline.aggregate.copyBytes,
    });
    for (const [field, reason] of [
      ["maximumBodyBytes", "bodyBytesExceeded"],
      ["maximumCanonicalBytes", "canonicalBytesExceeded"],
      ["maximumFrameBytes", "frameBytesExceeded"],
      ["maximumPayloadBytes", "payloadBytesExceeded"],
      ["maximumFrames", "framesExceeded"],
      ["maximumAllocationBytes", "allocationBytesExceeded"],
      ["maximumCopyBytes", "copyBytesExceeded"],
      ["maximumTransitions", "transitionsExceeded"],
    ] as const) {
      const result = attemptIncremental(
        encoded.canonicalBytes,
        { ...exact, [field]: exact[field] - 1 },
      );
      expect(incrementalFailureReason(result)).toBe(reason);
    }
  });

  it("owns input bytes and rejects hostile, detached, foreign, closed, and reused handles", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const budget = incrementalBudget(encoded.canonicalBytes.byteLength);
    const factory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    expect(incrementalFailureReason(factory.create(new Proxy({}, {
      ownKeys() {
        throw new Error("hostile create");
      },
    })))).toBe("invalidInput");
    expect(incrementalFailureReason(factory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget: Object.defineProperty({}, "maximumBodyBytes", {
        get() {
          throw new Error("hostile budget");
        },
      }),
    }))).toBe("invalidBudget");
    expect(incrementalFailureReason(factory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget: {
        ...budget,
        maximumFrames: 1_025,
      },
    }))).toBe("invalidBudget");
    expect(incrementalFailureReason(factory.create({
      bodyByteLength: 0x1_0000_0000,
      budget: {
        ...budget,
        maximumBodyBytes: 0xffff_ffff,
        maximumCanonicalBytes: 0xffff_ffff,
        maximumAllocationBytes: Number.MAX_SAFE_INTEGER,
        maximumCopyBytes: Number.MAX_SAFE_INTEGER,
      },
    }))).toBe("invalidInput");

    const created = unwrap(factory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget,
    }));
    const aliased = new Uint8Array(encoded.canonicalBytes);
    const stepped = unwrap(factory.step(
      created.decoder,
      aliased,
      aliased.byteLength,
    ));
    expect(stepped.status).toBe("ready");
    aliased.fill(0);
    const completed = finishIncremental(factory, created.decoder, 1_024);
    expect(completed.usage).toEqual(encoded.usage);
    expect(incrementalFailureReason(factory.finish(
      created.decoder,
      1,
    ))).toBe("closed");
    expect(unwrap(factory.close(completed.capability))).toBeUndefined();
    expect(incrementalFailureReason(factory.close(completed.capability)))
      .toBe("closed");

    const foreign =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    expect(incrementalFailureReason(foreign.close(completed.capability)))
      .toBe("staleAuthority");
    expect(incrementalFailureReason(factory.close({
      _tag: "DeclarativeV2AuthenticatedCommandDecodedCapabilityV1",
    }))).toBe("staleAuthority");

    const trailingFactory =
      makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
    const trailingCreated = unwrap(trailingFactory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget,
    }));
    const withTrailing = new Uint8Array(encoded.canonicalBytes.byteLength + 1);
    withTrailing.set(encoded.canonicalBytes);
    expect(incrementalFailureReason(trailingFactory.step(
      trailingCreated.decoder,
      withTrailing,
      1_024,
    ))).toBe("malformed");
    expect(incrementalFailureReason(trailingFactory.finish(
      trailingCreated.decoder,
      1,
    ))).toBe("closed");

    const detached = new Uint8Array(encoded.canonicalBytes);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const detachedCreated = unwrap(factory.create({
      bodyByteLength: encoded.canonicalBytes.byteLength,
      budget,
    }));
    expect(incrementalFailureReason(factory.step(
      detachedCreated.decoder,
      detached,
      1,
    ))).toBe("invalidInput");
  });

  it("matches compatibility decoder failures", () => {
    const encoded = encode(parseModuleRequest(), generousBudget);
    const frames = commandFrameRanges(encoded.canonicalBytes);
    const header = frames[0]!;
    const reservationLength = readU32(
      encoded.canonicalBytes,
      header.start + 1,
    );
    const budgetStart = header.start + 1 + 4 + reservationLength + 4;
    const module = frames[1]!;
    const mutations = [
      (bytes: Uint8Array) => {
        bytes[0] ^= 0xff;
      },
      (bytes: Uint8Array) => {
        bytes[header.start + 5] ^= 0xff;
      },
      (bytes: Uint8Array) => {
        const budgetDomainLength = new TextEncoder().encode(
          "flarex.declarative-v2/command_budget/v2\0",
        ).byteLength;
        bytes[budgetStart + budgetDomainLength + 4] = 0x80;
      },
      (bytes: Uint8Array) => {
        bytes[module.start + 17] = 0xff;
      },
      (bytes: Uint8Array) => {
        bytes[module.start + 17] = 0;
      },
      (bytes: Uint8Array) => {
        writeU32(bytes, header.start - 4, 0xffff_ffff);
      },
    ] as const;
    for (const mutate of mutations) {
      const malformed = new Uint8Array(encoded.canonicalBytes);
      mutate(malformed);
      const compatibility = decodeDeclarativeV2AuthenticatedCommandRequestV1(
        malformed,
        generousBudget,
      );
      const incremental = attemptIncremental(
        malformed,
        incrementalBudget(malformed.byteLength),
      );
      expect(incrementalFailureReason(incremental)).toBe(
        failureReason(compatibility),
      );
    }
    const truncated = encoded.canonicalBytes.slice(0, -1);
    expect(incrementalFailureReason(attemptIncremental(
      truncated,
      incrementalBudget(truncated.byteLength),
    ))).toBe(failureReason(
      decodeDeclarativeV2AuthenticatedCommandRequestV1(
        truncated,
        generousBudget,
      ),
    ));
  });

  it("exposes only the intentional internal subpath", async () => {
    const root = await import("@flarex/executor-http");
    expect(
      "encodeDeclarativeV2AuthenticatedCommandRequestV1" in root,
    ).toBe(false);
    const internal = await import(
      "@flarex/executor-http/internal-declarative-v2-authenticated-command-v1"
    );
    expect(internal.DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_VERSION_V1)
      .toBe(1);
    expect(
      "makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1" in
        internal,
    ).toBe(true);
  });
});

function sourcePageRequest(): DeclarativeV2AuthenticatedCommandRequestV1 {
  return {
    frames: [
      header("source_page"),
      moduleMetadata(3n, "a.js", 10n),
      moduleMetadata(4n, "functions/\u1019\u103C\u1014\u103A\u1019\u102C.js", 20n),
      terminal({
        firstModuleOrdinal: 3n,
        moduleCount: 2n,
        payloadFrameCount: 2n,
      }),
    ],
  };
}

function parseModuleRequest(
  path = "functions/example.js",
): DeclarativeV2AuthenticatedCommandRequestV1 {
  const source = new TextEncoder().encode("export function handler() { return 1n; }");
  const split = 17;
  return {
    frames: [
      header("parse_module"),
      moduleMetadata(7n, path, BigInt(source.byteLength)),
      sourceBytes(7n, 0n, source.subarray(0, split)),
      sourceBytes(7n, BigInt(split), source.subarray(split)),
      terminal({
        firstModuleOrdinal: 7n,
        moduleCount: 1n,
        sourceByteLength: BigInt(source.byteLength),
        payloadFrameCount: 3n,
      }),
    ],
  };
}

function linkPageRequest(): DeclarativeV2AuthenticatedCommandRequestV1 {
  return { frames: [header("link_page"), terminal()] };
}

function registrationPageRequest(): DeclarativeV2AuthenticatedCommandRequestV1 {
  const semantic = '{"kind":"handler","modulePath":"a.js"}\n';
  return {
    frames: [
      header("registration_page"),
      semanticBytes(0n, semantic.slice(0, 10)),
      semanticBytes(10n, semantic.slice(10)),
      terminal({
        semanticByteLength: BigInt(new TextEncoder().encode(semantic).byteLength),
        payloadFrameCount: 2n,
      }),
    ],
  };
}

function header(
  kind: DeclarativeV2VerifierDurableCommandKindV2,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return {
    kind: "command_header",
    reservation: reservation(kind),
    commandBudget: commandBudget(),
  };
}

function reservation(
  commandKind: DeclarativeV2VerifierDurableCommandKindV2,
): DeclarativeV2VerifierCommandReservationFrameV2 {
  return {
    kind: "command_reservation",
    attemptSha256: digest(1),
    candidateSha256: digest(2),
    commandKind,
    sequence: 9n,
    currentProgressSha256: digest(3),
    predecessorReceiptSha256: digest(4),
    commandBudgetSha256: digest(5),
    commandInputSha256: digest(6),
    freshAuthenticatedInputSha256: digest(7),
    analyzerIdentitySha256: digest(8),
    verifierIdentitySha256: digest(9),
    rangeAndPredecessorTailsSha256: digest(10),
  };
}

function commandBudget(): DeclarativeV2VerifierBudgetFrameV2 & {
  readonly kind: "command_budget";
} {
  const frame: Record<string, bigint | string> = { kind: "command_budget" };
  for (let index = 0; index < DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.length; index += 1) {
    frame[DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[index]!] = BigInt(index + 1);
  }
  return frame as unknown as DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "command_budget";
  };
}

function moduleMetadata(
  moduleOrdinal: bigint,
  path: string,
  sourceByteLength: bigint,
): DeclarativeV2AuthenticatedCommandModuleMetadataFrameV1 {
  return {
    kind: "module_metadata",
    moduleOrdinal,
    roles: 3,
    modulePathBytes: new TextEncoder().encode(path),
    frameSha256: digest(11),
    sourceSha256: digest(12),
    sourceByteLength,
  };
}

function sourceBytes(
  moduleOrdinal: bigint,
  offset: bigint,
  bytes: Uint8Array,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return { kind: "source_bytes", moduleOrdinal, offset, bytes };
}

function semanticBytes(
  offset: bigint,
  text: string,
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return { kind: "semantic_bytes", offset, bytes: new TextEncoder().encode(text) };
}

function terminal(
  overrides: Partial<{
    firstModuleOrdinal: bigint;
    moduleCount: bigint;
    sourceByteLength: bigint;
    semanticByteLength: bigint;
    payloadFrameCount: bigint;
  }> = {},
): DeclarativeV2AuthenticatedCommandFrameV1 {
  return {
    kind: "command_terminal",
    firstModuleOrdinal: overrides.firstModuleOrdinal ?? 0n,
    moduleCount: overrides.moduleCount ?? 0n,
    sourceByteLength: overrides.sourceByteLength ?? 0n,
    semanticByteLength: overrides.semanticByteLength ?? 0n,
    payloadFrameCount: overrides.payloadFrameCount ?? 0n,
  };
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function encode(
  request: unknown,
  budget: unknown,
) {
  return unwrap(
    encodeDeclarativeV2AuthenticatedCommandRequestV1(request, budget),
  );
}

function decode(bytes: unknown, budget: unknown) {
  return unwrap(
    decodeDeclarativeV2AuthenticatedCommandRequestV1(bytes, budget),
  );
}

function failureReason(
  result: Result.Result<unknown, { readonly reason: string }>,
): string {
  if (Result.isSuccess(result)) throw new Error("expected failure");
  return result.failure.reason;
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

type IncrementalComplete = Extract<
  DeclarativeV2AuthenticatedCommandIncrementalFinishV1,
  { readonly status: "complete" }
>;

function incrementalBudget(
  bodyByteLength: number,
): DeclarativeV2AuthenticatedCommandIncrementalBudgetV1 {
  return Object.freeze({
    ...generousBudget,
    maximumTransitions: bodyByteLength * 4 + 32,
    maximumAllocationBytes: bodyByteLength * 4 + 2_048,
    maximumCopyBytes: bodyByteLength * 4 + 2_048,
  });
}

function finishIncremental(
  factory: DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  decoder: unknown,
  allowance: number,
): IncrementalComplete {
  while (true) {
    const result = unwrap(factory.finish(decoder, allowance));
    if (result.status === "complete") return result;
  }
}

function driveIncremental(
  factory: DeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1,
  bytes: Uint8Array,
  budget: DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
  chunks: readonly number[],
  allowance: number,
): Readonly<{
  readonly usage: IncrementalComplete["usage"];
  readonly aggregate: DeclarativeV2AuthenticatedCommandIncrementalUsageV1;
  readonly capability: IncrementalComplete["capability"];
}> {
  const created = unwrap(factory.create({
    bodyByteLength: bytes.byteLength,
    budget,
  }));
  let sourceOffset = 0;
  for (const chunkLength of chunks) {
    const chunkEnd = sourceOffset + chunkLength;
    while (sourceOffset < chunkEnd) {
      const stepped = unwrap(factory.step(
        created.decoder,
        bytes.subarray(sourceOffset, chunkEnd),
        allowance,
      ));
      if (stepped.consumedBytes === 0) {
        throw new Error("incremental decoder made no input progress");
      }
      sourceOffset += stepped.consumedBytes;
    }
  }
  if (sourceOffset !== bytes.byteLength) {
    throw new Error("incremental test chunks did not cover the body");
  }
  const completed = finishIncremental(factory, created.decoder, allowance);
  return Object.freeze({
    usage: completed.usage,
    aggregate: completed.receipt.aggregate,
    capability: completed.capability,
  });
}

function attemptIncremental(
  bytes: Uint8Array,
  budget: DeclarativeV2AuthenticatedCommandIncrementalBudgetV1,
): Result.Result<
  IncrementalComplete,
  DeclarativeV2AuthenticatedCommandIncrementalV1Error
> {
  const factory =
    makeDeclarativeV2AuthenticatedCommandIncrementalDecoderFactoryV1();
  const created = factory.create({
    bodyByteLength: bytes.byteLength,
    budget,
  });
  if (Result.isFailure(created)) return Result.fail(created.failure);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const stepped = factory.step(
      created.success.decoder,
      bytes.subarray(offset),
      1_024,
    );
    if (Result.isFailure(stepped)) return Result.fail(stepped.failure);
    if (stepped.success.consumedBytes === 0) {
      throw new Error("incremental decoder made no input progress");
    }
    offset += stepped.success.consumedBytes;
  }
  while (true) {
    const finished = factory.finish(created.success.decoder, 1_024);
    if (Result.isFailure(finished)) return Result.fail(finished.failure);
    if (finished.success.status === "complete") {
      return Result.succeed(finished.success);
    }
  }
}

function incrementalFailureReason(
  result: Result.Result<unknown, { readonly reason: string }>,
): string {
  if (Result.isSuccess(result)) throw new Error("expected incremental failure");
  return result.failure.reason;
}

function hex(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    output += bytes[index]!.toString(16).padStart(2, "0");
  }
  return output;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) >>> 0) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function insertDuplicateFirstFrame(bytes: Uint8Array): Uint8Array {
  const domainLength = readU32(bytes, 0);
  const frameCountOffset = 4 + domainLength + 4;
  const frameCount = readU32(bytes, frameCountOffset);
  const [first] = commandFrameRanges(bytes);
  if (first === undefined) throw new Error("missing first frame");
  const framePrefixStart = first.start - 4;
  const frameEnd = first.start + first.length;
  const frameBytes = bytes.subarray(framePrefixStart, frameEnd);
  const duplicate = new Uint8Array(bytes.byteLength + frameBytes.byteLength);
  duplicate.set(bytes.subarray(0, frameEnd), 0);
  duplicate.set(frameBytes, frameEnd);
  duplicate.set(bytes.subarray(frameEnd), frameEnd + frameBytes.byteLength);
  writeU32(duplicate, frameCountOffset, frameCount + 1);
  return duplicate;
}

function commandFrameRanges(
  bytes: Uint8Array,
): readonly Readonly<{ readonly start: number; readonly length: number }>[] {
  const domainLength = readU32(bytes, 0);
  let offset = 4 + domainLength + 4;
  const frameCount = readU32(bytes, offset);
  offset += 4;
  const frames: Readonly<{ readonly start: number; readonly length: number }>[] =
    [];
  for (let index = 0; index < frameCount; index += 1) {
    const length = readU32(bytes, offset);
    offset += 4;
    frames.push(Object.freeze({ start: offset, length }));
    offset += length;
  }
  return Object.freeze(frames);
}
