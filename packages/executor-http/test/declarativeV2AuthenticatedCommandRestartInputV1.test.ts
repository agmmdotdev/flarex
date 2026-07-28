import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2VerifierProgressFrameIntoV2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  verifyOwnedDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierCommandOutputManifestFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import {
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MEDIA_TYPE_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_IDENTITY_V1,
  DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_VERSION_V1,
  makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  type DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  type DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
  type DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
  type DeclarativeV2AuthenticatedCommandRestartInputEncoderV1,
  type DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  type DeclarativeV2AuthenticatedCommandRestartInputFrameV1,
  type DeclarativeV2AuthenticatedCommandRestartInputSourceV1,
  type DeclarativeV2AuthenticatedCommandRestartInputUsageV1,
  type DeclarativeV2AuthenticatedCommandRestartInputV1Error,
} from "../src/declarativeV2AuthenticatedCommandRestartInputV1";

const MAXIMUM = 20_000_000;
const budget: Readonly<
  DeclarativeV2AuthenticatedCommandRestartInputBudgetV1
> = Object.freeze({
  maximumBodyBytes: MAXIMUM,
  maximumCanonicalBytes: MAXIMUM,
  maximumFrameBytes: MAXIMUM,
  maximumPayloadBytes: MAXIMUM,
  maximumFrames:
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_FRAMES_V1,
  maximumPages:
    DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MAXIMUM_PAGES_V1,
  maximumAllocationBytes: MAXIMUM,
  maximumCopyBytes: MAXIMUM,
  maximumScanBytes: MAXIMUM,
  maximumHashBytes: MAXIMUM,
  maximumTransitions: MAXIMUM,
});

describe("Declarative V2 authenticated command restart input V1", () => {
  it("pins a distinct internal identity and deterministic two-cold bytes", async () => {
    expect(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_IDENTITY_V1,
    ).toBe(
      "flarex.executor-http/declarative-v2-authenticated-command-restart-input/v1",
    );
    expect(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PROTOCOL_VERSION_V1,
    ).toBe(1);
    expect(
      DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_MEDIA_TYPE_V1,
    ).toBe(
      "application/vnd.flarex.declarative-v2-authenticated-command-restart-input-v1",
    );
    const first = encode(await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    ));
    const second = encode(await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    ));
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it.each([
    ["source_page", "parse_module"],
    ["source_page", "link_page"],
    ["parse_module", "parse_module"],
    ["parse_module", "link_page"],
    ["link_page", "parse_module"],
    ["link_page", "link_page"],
    ["registration_page", "parse_module"],
    ["registration_page", "link_page"],
  ] as const)(
    "round-trips %s from %s at every split",
    async (targetKind, sourceKind) => {
      const frames = await restartFrames(
        targetKind,
        sourceKind,
        [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)],
      );
      const bytes = encode(frames);
      for (let split = 0; split <= bytes.byteLength; split += 1) {
        const decoded = decodeToPages(
          [bytes.subarray(0, split), bytes.subarray(split)],
          bytes.byteLength,
          restartClaim(frames),
        );
        expect(decoded).toEqual([
          Uint8Array.of(1, 2, 3),
          Uint8Array.of(4, 5),
        ]);
      }
    },
    30_000,
  );

  it("keeps registration parse and link recovery as separate exchanges", async () => {
    const parseFrames = await restartFrames(
      "registration_page",
      "parse_module",
      [Uint8Array.of(1, 2)],
    );
    const linkFrames = await restartFrames(
      "registration_page",
      "link_page",
      [Uint8Array.of(3, 4)],
    );
    const parse = encode(parseFrames);
    const link = encode(linkFrames);
    expect(parse).not.toEqual(link);
    expect(decodeToPages(
      [parse],
      parse.byteLength,
      restartClaim(parseFrames),
    )).toEqual([
      Uint8Array.of(1, 2),
    ]);
    expect(decodeToPages(
      [link],
      link.byteLength,
      restartClaim(linkFrames),
    )).toEqual([
      Uint8Array.of(3, 4),
    ]);
  });

  it("makes zero and insufficient one allowance no-work and rejects 1,025", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1)],
    );
    const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    const zero = unwrap(factory.append(created.encoder, frames[0], 0));
    expect(zero.status).toBe("pending");
    expect(zero.receipt.delta).toEqual(zeroUsage());
    const one = unwrap(factory.append(created.encoder, frames[0], 1));
    expect(one.status).toBe("pending");
    expect(one.receipt.delta).toEqual(zeroUsage());
    expect(failureReason(
      factory.append(created.encoder, frames[0], 1_025),
    )).toBe("invalidInput");

    const bytes = encode(frames);
    const decoderFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const decoder = unwrap(decoderFactory.createDecoder({
      bodyByteLength: bytes.byteLength,
      budget,
    })).decoder;
    const decoderOne = unwrap(decoderFactory.stepDecoder(decoder, bytes, 1));
    expect(decoderOne.consumedBytes).toBe(1);
    expect(decoderOne.receipt.transitionCount).toBe(1);
    expect(failureReason(
      decoderFactory.stepDecoder(decoder, Uint8Array.of(1), 1_025),
    )).toBe("invalidInput");
  });

  it("admits protocol work before bytes and reports exact successful work", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    );
    const output = frames[1];
    if (output?.kind !== "source_output_manifest") {
      throw new Error("Expected source output.");
    }
    const protocol = captureProtocolWork(output.frame);
    const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const created = unwrap(factory.createEncoder({ budget }));
    appendUntilAccepted(factory, created.encoder, frames[0]);
    const encoding = unwrap(factory.append(created.encoder, output, 1_024));
    expect(encoding.status).toBe("pending");
    expect(encoding.receipt.delta.allocationBytes).toBe(
      4 + 5 + protocol.canonicalByteLength +
        protocol.encoding.byteStorageAllocationBytes,
    );
    expect(encoding.receipt.delta.copyBytes).toBe(
      protocol.encoding.byteCopyBytes,
    );
    const verification = unwrap(factory.append(
      created.encoder,
      output,
      1_024,
    ));
    expect(verification.status).toBe("pending");
    expect(verification.receipt.delta.scanBytes).toBe(
      protocol.verification.byteScanBytes,
    );
    expect(verification.receipt.delta.hashBytes).toBe(0);
    const acceptance = unwrap(factory.append(
      created.encoder,
      output,
      1_024,
    ));
    expect(acceptance.status).toBe("accepted");
    expect(acceptance.receipt.delta.allocationBytes).toBe(32);
    expect(acceptance.receipt.delta.scanBytes).toBe(
      protocol.canonicalByteLength + 64,
    );
    expect(acceptance.receipt.delta.hashBytes).toBe(
      protocol.canonicalByteLength,
    );
    expect(encoding.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    expect(verification.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    expect(acceptance.receipt.delta.transitions).toBeLessThanOrEqual(1_024);

    const page = frames.find(frame => frame.kind === "page_manifest");
    if (page?.kind !== "page_manifest") throw new Error("Expected page.");
    const pageProtocol = captureProtocolWork(page.frame);
    expect(unwrap(factory.append(created.encoder, page, 1_024)).status).toBe(
      "pending",
    );
    expect(unwrap(factory.append(created.encoder, page, 1_024)).status).toBe(
      "pending",
    );
    const pageScanBytes = (pageProtocol.canonicalByteLength * 2) + 32;
    const pageHashBytes = pageProtocol.canonicalByteLength * 2;
    const pageTransitions = pageScanBytes + 7;
    const insufficient = unwrap(factory.append(
      created.encoder,
      page,
      pageTransitions - 1,
    ));
    expect(insufficient.status).toBe("pending");
    expect(insufficient.receipt.delta).toEqual(zeroUsage());
    const pageAcceptance = unwrap(factory.append(
      created.encoder,
      page,
      pageTransitions,
    ));
    expect(pageAcceptance.status).toBe("accepted");
    expect(pageAcceptance.receipt.delta).toMatchObject({
      allocationBytes: 32,
      scanBytes: pageScanBytes,
      hashBytes: pageHashBytes,
      transitions: pageTransitions,
    });

    const secondPage = frames.filter(
      frame => frame.kind === "page_manifest",
    )[1];
    if (secondPage?.kind !== "page_manifest") {
      throw new Error("Expected second page.");
    }
    const secondProtocol = captureProtocolWork(secondPage.frame);
    expect(unwrap(factory.append(
      created.encoder,
      secondPage,
      1_024,
    )).status).toBe("pending");
    expect(unwrap(factory.append(
      created.encoder,
      secondPage,
      1_024,
    )).status).toBe("pending");
    const secondScanBytes = (secondProtocol.canonicalByteLength * 2) + 96;
    const secondHashBytes = secondProtocol.canonicalByteLength * 2;
    const secondTransitions = secondScanBytes + 12;
    const secondAcceptance = unwrap(factory.append(
      created.encoder,
      secondPage,
      secondTransitions,
    ));
    expect(secondAcceptance.status).toBe("accepted");
    expect(secondAcceptance.receipt.delta).toMatchObject({
      allocationBytes: 32,
      scanBytes: secondScanBytes,
      hashBytes: secondHashBytes,
      transitions: secondTransitions,
    });
  });

  it("admits every manifest before payload allocation and transfers metadata then body once", async () => {
    const pages = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6)];
    const frames = await restartFrames(
      "registration_page",
      "link_page",
      pages,
    );
    const bytes = encode(frames);
    const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const source = decode(
      factory,
      [bytes],
      bytes.byteLength,
      restartClaim(frames),
    );
    const zero = unwrap(factory.metadata(source, 0n, 0));
    expect(zero.status).toBe("pending");
    expect(zero.receipt.delta.transitions).toBe(0);
    const metadata = unwrap(factory.metadata(source, 0n, 1));
    expect(metadata.status).toBe("metadata");
    if (metadata.status !== "metadata") throw new Error("metadata");
    expect(metadata.manifestBytes.byteLength).toBeGreaterThan(0);
    expect(failureReason(factory.metadata(source, 1n, 1))).toBe(
      "staleAuthority",
    );

    const secondFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const secondSource = decode(
      secondFactory,
      [bytes],
      bytes.byteLength,
      restartClaim(frames),
    );
    const firstMetadata = unwrap(secondFactory.metadata(secondSource, 0n, 1));
    if (firstMetadata.status !== "metadata") throw new Error("metadata");
    const bodyZero = unwrap(secondFactory.body(
      secondSource,
      0n,
      BigInt(pages[0]!.byteLength),
      0,
    ));
    expect(bodyZero.status).toBe("pending");
    const body = unwrap(secondFactory.body(
      secondSource,
      0n,
      BigInt(pages[0]!.byteLength),
      1,
    ));
    expect(body.status).toBe("body");
    if (body.status !== "body") throw new Error("body");
    expect(body.bytes).toEqual(pages[0]);
    expect(failureReason(secondFactory.body(
      secondSource,
      0n,
      BigInt(pages[0]!.byteLength),
      1,
    ))).toBe("staleAuthority");
  });

  it("requires one exact claim before metadata or body authority is usable", async () => {
    const frames = await restartFrames(
      "registration_page",
      "link_page",
      [Uint8Array.of(1, 2, 3)],
    );
    const bytes = encode(frames);
    const expected = restartClaim(frames);

    const metadataFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const rawMetadata = decodeWithHandle(
      metadataFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(failureReason(metadataFactory.metadata(
      rawMetadata as unknown as
        DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
      0n,
      1,
    ))).toBe("staleAuthority");
    expect(failureReason(
      metadataFactory.claimSource(rawMetadata, expected, 1_024),
    )).toBe("closed");

    const bodyFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const rawBody = decodeWithHandle(
      bodyFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(failureReason(bodyFactory.body(
      rawBody as unknown as
        DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1,
      0n,
      3n,
      1,
    ))).toBe("staleAuthority");
    expect(failureReason(
      bodyFactory.claimSource(rawBody, expected, 1_024),
    )).toBe("closed");
  });

  it("binds every retained target, source, and terminal claim field", async () => {
    const frames = await restartFrames(
      "registration_page",
      "link_page",
      [Uint8Array.of(1, 2), Uint8Array.of(3)],
    );
    const bytes = encode(frames);
    const expected = restartClaim(frames);
    const mutations: readonly (
      readonly [
        string,
        (claim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1) =>
          DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
      ]
    )[] = [
      ["targetRequestSha256", claim => ({
        ...claim,
        targetRequestSha256: digest(101),
      })],
      ["targetReservationSha256", claim => ({
        ...claim,
        targetReservationSha256: digest(102),
      })],
      ["targetCommandKind", claim => ({
        ...claim,
        targetCommandKind: "source_page",
      })],
      ["targetSequence", claim => ({ ...claim, targetSequence: 10n })],
      ["analyzerReleaseSha256", claim => ({
        ...claim,
        analyzerReleaseSha256: digest(103),
      })],
      ["analyzerIdentitySha256", claim => ({
        ...claim,
        analyzerIdentitySha256: digest(104),
      })],
      ["verifierIdentitySha256", claim => ({
        ...claim,
        verifierIdentitySha256: digest(105),
      })],
      ["rangeAndPredecessorTailsSha256", claim => ({
        ...claim,
        rangeAndPredecessorTailsSha256: digest(106),
      })],
      ["sourceReservationSha256", claim => ({
        ...claim,
        sourceReservationSha256: digest(107),
      })],
      ["sourceCommandKind", claim => ({
        ...claim,
        sourceCommandKind: "parse_module",
      })],
      ["sourceSequence", claim => ({ ...claim, sourceSequence: 8n })],
      ["sourceAuthenticatedInputSha256", claim => ({
        ...claim,
        sourceAuthenticatedInputSha256: digest(108),
      })],
      ["sourceOutputManifestSha256", claim => ({
        ...claim,
        sourceOutputManifestSha256: digest(109),
      })],
      ["sourceSettledReceiptSha256", claim => ({
        ...claim,
        sourceSettledReceiptSha256: digest(110),
      })],
      ["pageCount", claim => ({ ...claim, pageCount: 3n })],
      ["payloadByteLength", claim => ({
        ...claim,
        payloadByteLength: 4n,
      })],
      ["finalPageSha256", claim => ({
        ...claim,
        finalPageSha256: digest(111),
      })],
      ["manifestSequenceSha256", claim => ({
        ...claim,
        manifestSequenceSha256: digest(112),
      })],
      ["payloadSha256", claim => ({
        ...claim,
        payloadSha256: digest(113),
      })],
    ];
    for (const [field, mutate] of mutations) {
      const factory =
        makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
      const raw = decodeWithHandle(
        factory,
        [bytes],
        bytes.byteLength,
      ).source;
      const mismatch = factory.claimSource(raw, mutate(expected), 1_024);
      expect(Result.isFailure(mismatch), field).toBe(true);
      expect(
        ["identityMismatch", "lineageMismatch", "digestMismatch"],
        field,
      ).toContain(
        Result.isFailure(mismatch) ? mismatch.failure.reason : undefined,
      );
      expect(failureReason(factory.claimSource(raw, expected, 1_024)), field)
        .toBe("closed");
    }
  }, 30_000);

  it("meters claim work exactly and fails closed on hostile, insufficient-budget, and invalid allowance input", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2, 3)],
    );
    const bytes = encode(frames);
    const expected = restartClaim(frames);
    const probeFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const probe = decodeWithHandle(
      probeFactory,
      [bytes],
      bytes.byteLength,
    );
    const zero = unwrap(probeFactory.claimSource(probe.source, expected, 0));
    expect(zero.status).toBe("pending");
    expect(zero.receipt.delta).toEqual(zeroUsage());
    const one = unwrap(probeFactory.claimSource(probe.source, expected, 1));
    expect(one.status).toBe("pending");
    expect(one.receipt.delta).toEqual(zeroUsage());
    const complete = unwrap(
      probeFactory.claimSource(probe.source, expected, 1_024),
    );
    expect(complete.status).toBe("complete");
    expect(complete.receipt.delta).toMatchObject({
      allocationBytes: 256,
      copyBytes: 0,
      scanBytes: 832,
      transitions: 872,
    });
    expect(failureReason(
      probeFactory.claimSource(probe.source, expected, 1_024),
    )).toBe("closed");

    for (const dimension of [
      "allocationBytes",
      "scanBytes",
      "transitions",
    ] as const) {
      const budgetKey =
        `maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}` as
          keyof DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
      const addition = complete.receipt.delta[dimension];
      const exactBudget = {
        ...budget,
        [budgetKey]: probe.usage[dimension] + addition,
      };
      const exactFactory =
        makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
      const exactRaw = decodeWithHandle(
        exactFactory,
        [bytes],
        bytes.byteLength,
        exactBudget,
      ).source;
      expect(
        unwrap(exactFactory.claimSource(exactRaw, expected, 1_024)).status,
        dimension,
      ).toBe("complete");

      const oneLessFactory =
        makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
      const oneLessRaw = decodeWithHandle(
        oneLessFactory,
        [bytes],
        bytes.byteLength,
        {
          ...exactBudget,
          [budgetKey]: exactBudget[budgetKey] - 1,
        },
      ).source;
      expect(
        failureReason(
          oneLessFactory.claimSource(oneLessRaw, expected, 1_024),
        ),
        dimension,
      ).toBe(`${dimension}Exceeded`);
      expect(failureReason(
        oneLessFactory.claimSource(oneLessRaw, expected, 1_024),
      )).toBe("closed");
    }

    let getterCalls = 0;
    const accessorClaim = { ...expected };
    Object.defineProperty(accessorClaim, "targetRequestSha256", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return expected.targetRequestSha256;
      },
    });
    const hostileFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const hostileRaw = decodeWithHandle(
      hostileFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(
      unwrap(hostileFactory.claimSource(hostileRaw, accessorClaim, 1)).status,
    ).toBe("pending");
    expect(getterCalls).toBe(0);
    expect(failureReason(
      hostileFactory.claimSource(hostileRaw, accessorClaim, 1_024),
    )).toBe("invalidInput");
    expect(getterCalls).toBe(0);
    expect(failureReason(
      hostileFactory.claimSource(hostileRaw, expected, 1_024),
    )).toBe("closed");

    const proxyFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const proxyRaw = decodeWithHandle(
      proxyFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(failureReason(proxyFactory.claimSource(
      proxyRaw,
      new Proxy({}, {
        ownKeys: () => {
          throw new Error("hostile");
        },
      }),
      1_024,
    ))).toBe("invalidInput");
    expect(failureReason(
      proxyFactory.claimSource(proxyRaw, expected, 1_024),
    )).toBe("closed");

    const detached = new Uint8Array(expected.targetRequestSha256);
    structuredClone(detached, { transfer: [detached.buffer] });
    const detachedFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const detachedRaw = decodeWithHandle(
      detachedFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(failureReason(detachedFactory.claimSource(
      detachedRaw,
      { ...expected, targetRequestSha256: detached },
      1_024,
    ))).toBe("invalidInput");

    const allowanceFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const allowanceRaw = decodeWithHandle(
      allowanceFactory,
      [bytes],
      bytes.byteLength,
    ).source;
    expect(failureReason(
      allowanceFactory.claimSource(allowanceRaw, expected, 1_025),
    )).toBe("invalidInput");
    expect(failureReason(
      allowanceFactory.claimSource(allowanceRaw, expected, 1_024),
    )).toBe("closed");
  }, 30_000);

  it("keeps claimed sources same-factory, result-bound, revocable, and single-terminal", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(7)],
    );
    const bytes = encode(frames);
    const expected = restartClaim(frames);
    const first = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const second = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const raw = decodeWithHandle(first, [bytes], bytes.byteLength).source;
    const claimed = claim(first, raw, expected);
    expect(failureReason(second.metadata(claimed, 0n, 1))).toBe(
      "staleAuthority",
    );
    expect(failureReason(first.metadata(
      {
        _tag:
          "DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1",
      },
      0n,
      1,
    ))).toBe("staleAuthority");
    const copied = { ...claimed };
    expect(failureReason(first.metadata(copied, 0n, 1))).toBe(
      "staleAuthority",
    );
    expect(failureReason(first.claimSource(raw, expected, 1_024))).toBe(
      "closed",
    );

    const otherFrames = await restartFrames(
      "source_page",
      "link_page",
      [Uint8Array.of(8)],
    );
    const otherBytes = encode(otherFrames);
    const otherRaw = decodeWithHandle(
      first,
      [otherBytes],
      otherBytes.byteLength,
    ).source;
    expect(failureReason(
      first.claimSource(otherRaw, expected, 1_024),
    )).toBe("identityMismatch");
    expect(failureReason(
      first.claimSource(otherRaw, restartClaim(otherFrames), 1_024),
    )).toBe("closed");

    const rawToClose = decodeWithHandle(
      first,
      [bytes],
      bytes.byteLength,
    ).source;
    unwrap(first.close(rawToClose));
    expect(failureReason(
      first.claimSource(rawToClose, expected, 1_024),
    )).toBe("closed");

    unwrap(first.close(claimed));
    expect(failureReason(first.metadata(claimed, 0n, 1))).toBe("closed");
    expect(failureReason(first.close(claimed))).toBe("closed");

    const exhaustedRaw = decodeWithHandle(
      first,
      [bytes],
      bytes.byteLength,
    ).source;
    const exhausted = claim(first, exhaustedRaw, expected);
    const metadata = unwrap(first.metadata(exhausted, 0n, 1));
    if (metadata.status !== "metadata") throw new Error("metadata");
    const manifest = unwrap(encodeOrDecodeManifest(metadata.manifestBytes));
    expect(unwrap(first.body(
      exhausted,
      0n,
      manifest.payloadByteLength,
      1,
    )).status).toBe("body");
    expect(unwrap(first.metadata(exhausted, 1n, 1)).status).toBe("complete");
    expect(failureReason(first.metadata(exhausted, 1n, 1))).toBe("closed");

    const aliasedBytes = new Uint8Array(64);
    aliasedBytes.set(expected.targetRequestSha256, 16);
    const aliasedClaim = {
      ...expected,
      targetRequestSha256: aliasedBytes.subarray(16, 48),
    };
    const aliasedRaw = decodeWithHandle(
      first,
      [bytes],
      bytes.byteLength,
    ).source;
    const aliasedSource = claim(first, aliasedRaw, aliasedClaim);
    aliasedBytes.fill(0);
    expect(unwrap(first.metadata(aliasedSource, 0n, 1)).status).toBe(
      "metadata",
    );
  });

  it("rejects gaps, duplicates, predecessor, output, terminal, and payload mismatches", async () => {
    const base = [...await restartFrames(
      "registration_page",
      "parse_module",
      [Uint8Array.of(1), Uint8Array.of(2)],
    )];
    const pageIndexes = base.flatMap((frame, index) =>
      frame.kind === "page_manifest" ? [index] : []
    );
    const terminalIndex = base.findIndex(frame =>
      frame.kind === "restart_terminal"
    );
    const payloadIndexes = base.flatMap((frame, index) =>
      frame.kind === "payload" ? [index] : []
    );
    const secondPage = base[pageIndexes[1]!];
    const terminal = base[terminalIndex];
    const firstPayload = base[payloadIndexes[0]!];
    if (
      secondPage?.kind !== "page_manifest" ||
      terminal?.kind !== "restart_terminal" ||
      firstPayload?.kind !== "payload"
    ) throw new Error("fixtures");

    expect(encodeFailure([
      ...base.slice(0, pageIndexes[1]),
      base[pageIndexes[0]],
      ...base.slice(pageIndexes[1] + 1),
    ])).toBe("lineageMismatch");
    expect(encodeFailure([
      ...base.slice(0, pageIndexes[1]),
      {
        ...secondPage,
        frame: {
          ...secondPage.frame,
          predecessorPageSha256: digest(99),
        },
      },
      ...base.slice(pageIndexes[1] + 1),
    ])).toBe("lineageMismatch");
    expect(encodeFailure([
      ...base.slice(0, terminalIndex),
      { ...terminal, finalPageSha256: digest(98) },
      ...base.slice(terminalIndex + 1),
    ])).toBe("digestMismatch");
    expect(encodeFailure([
      ...base.slice(0, payloadIndexes[0]),
      { ...firstPayload, offset: 1n },
      ...base.slice(payloadIndexes[0] + 1),
    ])).toBe("lineageMismatch");
  });

  it("rejects truncation, trailing, noncanonical, hostile, detached, and aliased input", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2, 3)],
    );
    const bytes = encode(frames);
    expect(decodeFailure(bytes.subarray(0, bytes.byteLength - 1))).toBe(
      "invalidGrammar",
    );
    expect(decodeFailure(concat([bytes, Uint8Array.of(0)]))).toBe("malformed");
    const noncanonical = new Uint8Array(bytes);
    noncanonical[4] ^= 1;
    expect(decodeFailure(noncanonical)).toBe("malformed");

    const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const encoder = unwrap(factory.createEncoder({ budget })).encoder;
    expect(failureReason(factory.append(
      encoder,
      new Proxy({}, { ownKeys: () => {
        throw new Error("hostile");
      } }),
      1_024,
    ))).toBe("invalidInput");

    const detached = Uint8Array.of(1);
    structuredClone(detached, { transfer: [detached.buffer] });
    const other = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const otherEncoder = unwrap(other.createEncoder({ budget })).encoder;
    const payload = frames.find(frame => frame.kind === "payload");
    if (payload?.kind !== "payload") throw new Error("payload");
    expect(failureReason(other.append(
      otherEncoder,
      { ...payload, bytes: detached },
      1_024,
    ))).toBe("payloadBytesExceeded");

    const mutable = Uint8Array.of(7, 8, 9);
    const ownedFrames = await restartFrames(
      "link_page",
      "parse_module",
      [mutable],
    );
    const ownedBytes = encode(ownedFrames);
    mutable.fill(0);
    expect(decodeToPages(
      [ownedBytes],
      ownedBytes.byteLength,
      restartClaim(ownedFrames),
    )[0]).toEqual(
      Uint8Array.of(7, 8, 9),
    );
  });

  it("enforces exact and one-less ceilings for every transport dimension", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2, 3)],
    );
    const probe = encodeWithReceipt(frames, budget);
    for (const dimension of [
      "bodyBytes",
      "canonicalBytes",
      "frameBytes",
      "payloadBytes",
      "frames",
      "pages",
      "allocationBytes",
      "copyBytes",
      "scanBytes",
      "hashBytes",
      "transitions",
    ] as const) {
      const budgetKey =
        `maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}` as
          keyof DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
      const exactBudget = {
        ...budget,
        [budgetKey]: probe.usage[dimension],
      };
      expect(() => encode(frames, exactBudget)).not.toThrow();
      expect(() => encode(frames, {
        ...exactBudget,
        [budgetKey]: probe.usage[dimension] - 1,
      })).toThrow(new RegExp(`${dimension}Exceeded`));
    }
  });

  it("enforces exact and one-less decoder ceilings through multi-page transfer", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    );
    const bytes = encode(frames);
    const claim = restartClaim(frames);
    const probe = decodeWithReceipt(bytes, budget, claim);
    for (const dimension of [
      "bodyBytes",
      "canonicalBytes",
      "frameBytes",
      "payloadBytes",
      "frames",
      "pages",
      "allocationBytes",
      "copyBytes",
      "scanBytes",
      "hashBytes",
      "transitions",
    ] as const) {
      const budgetKey =
        `maximum${dimension[0]!.toUpperCase()}${dimension.slice(1)}` as
          keyof DeclarativeV2AuthenticatedCommandRestartInputBudgetV1;
      const exactBudget = {
        ...budget,
        [budgetKey]: probe.usage[dimension],
      };
      expect(() => decodeWithReceipt(bytes, exactBudget, claim)).not.toThrow();
      expect(() => decodeWithReceipt(bytes, {
        ...exactBudget,
        [budgetKey]: probe.usage[dimension] - 1,
      }, claim)).toThrow(new RegExp(`${dimension}Exceeded`));
    }
  });

  it("fails closed for forged, cross-factory, exhausted, closed, and reused handles", async () => {
    const frames = await restartFrames(
      "link_page",
      "parse_module",
      [Uint8Array.of(1)],
    );
    const first = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const second = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const encoder = unwrap(first.createEncoder({ budget })).encoder;
    expect(failureReason(second.append(encoder, frames[0], 1_024))).toBe(
      "staleAuthority",
    );
    expect(failureReason(first.append(
      { _tag: "DeclarativeV2AuthenticatedCommandRestartInputEncoderV1" },
      frames[0],
      1_024,
    ))).toBe("staleAuthority");
    unwrap(first.close(encoder));
    expect(failureReason(first.append(encoder, frames[0], 1_024))).toBe(
      "closed",
    );

    const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const result = encodeSource(factory, frames, budget);
    for (;;) {
      const step = unwrap(factory.stepWire(result.source, 1));
      if (step.status === "complete") break;
    }
    expect(failureReason(factory.stepWire(result.source, 1))).toBe("closed");
    expect(failureReason(factory.close(result.source))).toBe("closed");

    const encoded = encode(frames);
    const decodedFactory =
      makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
    const decoded = decodeWithHandle(
      decodedFactory,
      [encoded],
      encoded.byteLength,
    );
    unwrap(decodedFactory.close(decoded.decoder));
    const claimed = claim(
      decodedFactory,
      decoded.source,
      restartClaim(frames),
    );
    const metadata = unwrap(decodedFactory.metadata(claimed, 0n, 1));
    expect(metadata.status).toBe("metadata");
    if (metadata.status !== "metadata") throw new Error("metadata");
    const manifest = unwrap(encodeOrDecodeManifest(metadata.manifestBytes));
    const body = unwrap(decodedFactory.body(
      claimed,
      0n,
      manifest.payloadByteLength,
      1,
    ));
    expect(body.status).toBe("body");
    if (body.status !== "body") throw new Error("body");
    expect(body.bytes).toEqual(Uint8Array.of(1));
  });

  it("preserves request, response, progress, restart, and monolithic identities and keeps the root closed", async () => {
    const root = await import("@flarex/executor-http");
    expect(
      "makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1" in root,
    ).toBe(false);
    const request = await import("../src/declarativeV2AuthenticatedCommandV1");
    const response = await import(
      "../src/declarativeV2AuthenticatedCommandResponseV1"
    );
    const progress = await import(
      "flarex-protocol/internal/declarative-v2-verifier-progress-v2"
    );
    expect(request.DECLARATIVE_V2_AUTHENTICATED_COMMAND_PROTOCOL_IDENTITY_V1)
      .toBe("flarex.executor-http/declarative-v2-authenticated-command/v1");
    expect(
      response.DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESPONSE_PROTOCOL_IDENTITY_V1,
    ).toBe(
      "flarex.executor-http/declarative-v2-authenticated-command-response/v1",
    );
    expect(progress.DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2).toBe(
      "flarex.declarative-v2/verifier-progress-static/v2",
    );
  }, 15_000);
});

function encode(
  frames: readonly unknown[],
  selectedBudget = budget,
): Uint8Array {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const encoded = encodeSource(factory, frames, selectedBudget);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const step = unwrap(factory.stepWire(encoded.source, 1_024));
    if (step.status === "complete") break;
    if (step.status === "pending") continue;
    chunks.push(step.bytes);
    total += step.bytes.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function encodeSource(
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  frames: readonly unknown[],
  selectedBudget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
): Readonly<{
  readonly source: DeclarativeV2AuthenticatedCommandRestartInputSourceV1;
  readonly usage: DeclarativeV2AuthenticatedCommandRestartInputUsageV1;
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
        source: finished.source,
        usage: finished.receipt.aggregate,
      });
    }
  }
}

function encodeWithReceipt(
  frames: readonly unknown[],
  selectedBudget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
) {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const result = encodeSource(factory, frames, selectedBudget);
  for (;;) {
    const step = unwrap(factory.stepWire(result.source, 1_024));
    if (step.status === "complete") {
      return Object.freeze({ usage: step.receipt.aggregate });
    }
  }
}

function appendUntilAccepted(
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  encoder: DeclarativeV2AuthenticatedCommandRestartInputEncoderV1,
  frame: unknown,
): void {
  for (;;) {
    const step = unwrap(factory.append(encoder, frame, 1_024));
    expect(step.receipt.delta.transitions).toBeLessThanOrEqual(1_024);
    if (step.status === "accepted") return;
  }
}

function decode(
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  chunks: readonly Uint8Array[],
  bodyByteLength: number,
  selectedClaim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
  selectedBudget = budget,
): DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1 {
  const raw = decodeWithHandle(
    factory,
    chunks,
    bodyByteLength,
    selectedBudget,
  ).source;
  return claim(factory, raw, selectedClaim);
}

function decodeWithHandle(
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  chunks: readonly Uint8Array[],
  bodyByteLength: number,
  selectedBudget = budget,
): Readonly<{
  readonly decoder: Parameters<
    DeclarativeV2AuthenticatedCommandRestartInputFactoryV1["stepDecoder"]
  >[0];
  readonly source: DeclarativeV2AuthenticatedCommandRestartInputSourceV1;
  readonly usage: DeclarativeV2AuthenticatedCommandRestartInputUsageV1;
}> {
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
      if (step.consumedBytes === 0) {
        unwrap(factory.finishDecoder(created.decoder, 1_024));
      } else {
        offset += step.consumedBytes;
      }
    }
  }
  for (;;) {
    const finished = unwrap(factory.finishDecoder(created.decoder, 1_024));
    if (finished.status === "complete") {
      return Object.freeze({
        decoder: created.decoder,
        source: finished.source,
        usage: finished.receipt.aggregate,
      });
    }
  }
}

function claim(
  factory: DeclarativeV2AuthenticatedCommandRestartInputFactoryV1,
  source: DeclarativeV2AuthenticatedCommandRestartInputSourceV1,
  selectedClaim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
): DeclarativeV2AuthenticatedCommandRestartInputClaimedSourceV1 {
  for (;;) {
    const result = unwrap(factory.claimSource(source, selectedClaim, 1_024));
    if (result.status === "complete") return result.source;
  }
}

function decodeToPages(
  chunks: readonly Uint8Array[],
  bodyByteLength: number,
  selectedClaim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
): readonly Uint8Array[] {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const source = decode(factory, chunks, bodyByteLength, selectedClaim);
  const pages: Uint8Array[] = [];
  let ordinal = 0n;
  for (;;) {
    const metadata = unwrap(factory.metadata(source, ordinal, 1));
    if (metadata.status === "complete") break;
    if (metadata.status === "pending") continue;
    const manifest = unwrap(encodeOrDecodeManifest(metadata.manifestBytes));
    const body = unwrap(factory.body(
      source,
      ordinal,
      manifest.payloadByteLength,
      1,
    ));
    if (body.status === "pending") continue;
    pages.push(body.bytes);
    ordinal += 1n;
  }
  return pages;
}

function decodeWithReceipt(
  bytes: Uint8Array,
  selectedBudget: DeclarativeV2AuthenticatedCommandRestartInputBudgetV1,
  selectedClaim: DeclarativeV2AuthenticatedCommandRestartInputClaimV1,
): Readonly<{
  readonly usage: DeclarativeV2AuthenticatedCommandRestartInputUsageV1;
}> {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const source = decode(
    factory,
    [bytes],
    bytes.byteLength,
    selectedClaim,
    selectedBudget,
  );
  let ordinal = 0n;
  for (;;) {
    const metadata = unwrap(factory.metadata(source, ordinal, 1));
    if (metadata.status === "complete") {
      return Object.freeze({ usage: metadata.receipt.aggregate });
    }
    if (metadata.status === "pending") continue;
    const manifest = unwrap(encodeOrDecodeManifest(metadata.manifestBytes));
    for (;;) {
      const body = unwrap(factory.body(
        source,
        ordinal,
        manifest.payloadByteLength,
        1,
      ));
      if (body.status === "pending") continue;
      ordinal += 1n;
      break;
    }
  }
}

function decodeFailure(bytes: Uint8Array): string | undefined {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
  const created = factory.createDecoder({
    bodyByteLength: bytes.byteLength,
    budget,
  });
  if (Result.isFailure(created)) return created.failure.reason;
  let offset = 0;
  while (offset < bytes.byteLength) {
    const step = factory.stepDecoder(
      created.success.decoder,
      bytes.subarray(offset),
      1_024,
    );
    if (Result.isFailure(step)) return step.failure.reason;
    if (step.success.consumedBytes === 0) {
      const parsed = factory.finishDecoder(created.success.decoder, 1_024);
      if (Result.isFailure(parsed)) return parsed.failure.reason;
    } else {
      offset += step.success.consumedBytes;
    }
  }
  for (;;) {
    const finished = factory.finishDecoder(created.success.decoder, 1_024);
    if (Result.isFailure(finished)) return finished.failure.reason;
    if (finished.success.status === "complete") return undefined;
  }
}

function encodeFailure(frames: readonly unknown[]): string | undefined {
  const factory = makeDeclarativeV2AuthenticatedCommandRestartInputFactoryV1();
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

async function restartFrames(
  targetCommandKind: DeclarativeV2VerifierDurableCommandKindV2,
  sourceCommandKind: DeclarativeV2VerifierRestartCommandKindV2,
  pagePayloads: readonly Uint8Array[],
): Promise<readonly DeclarativeV2AuthenticatedCommandRestartInputFrameV1[]> {
  const targetReservationSha256 = digest(2);
  const sourceReservationSha256 = digest(8);
  const sourceSequence = 7n;
  const emptySha256 = await hash(EMPTY);
  const pages: DeclarativeV2VerifierEvidencePageManifestFrameV2[] = [];
  let predecessorPageSha256: Uint8Array | null = null;
  let evidenceOrdinal = 0n;
  let diagnosticOrdinal = 0n;
  for (let index = 0; index < pagePayloads.length; index += 1) {
    const payload = pagePayloads[index]!;
    const page = Object.freeze({
      kind: "evidence_page_manifest",
      reservationSha256: sourceReservationSha256,
      commandKind: sourceCommandKind,
      sequence: sourceSequence,
      pageOrdinal: BigInt(index),
      firstEvidenceOrdinal: evidenceOrdinal,
      evidenceCount: 1n,
      firstDiagnosticOrdinal: diagnosticOrdinal,
      diagnosticCount: 0n,
      predecessorPageSha256,
      payloadByteLength: BigInt(payload.byteLength),
      payloadSha256: await hash(payload),
      cumulativeDiagnosticsRootSha256: emptySha256,
    }) satisfies DeclarativeV2VerifierEvidencePageManifestFrameV2;
    pages.push(page);
    predecessorPageSha256 = await hash(progressBytes(page));
    evidenceOrdinal += 1n;
  }
  const finalPageSha256 = predecessorPageSha256;
  if (finalPageSha256 === null) throw new Error("At least one page is required.");
  const output = Object.freeze({
    kind: "command_output_manifest",
    reservationSha256: sourceReservationSha256,
    commandKind: sourceCommandKind,
    sequence: sourceSequence,
    evidenceRootSha256: finalPageSha256,
    evidenceCount: evidenceOrdinal,
    diagnosticsRootSha256: emptySha256,
    diagnosticCount: diagnosticOrdinal,
    nextProgressSha256: digest(14),
  }) satisfies DeclarativeV2VerifierCommandOutputManifestFrameV2;
  const outputBytes = progressBytes(output);
  const manifestBytes = pages.map(progressBytes);
  const payloadBytes = concat(pagePayloads);
  const frames: DeclarativeV2AuthenticatedCommandRestartInputFrameV1[] = [
    Object.freeze({
      kind: "restart_header",
      targetRequestSha256: digest(1),
      targetReservationSha256,
      targetCommandKind,
      targetSequence: 9n,
      analyzerReleaseSha256: digest(3),
      analyzerIdentitySha256: digest(4),
      verifierIdentitySha256: digest(5),
      rangeAndPredecessorTailsSha256: digest(6),
      sourceReservationSha256,
      sourceCommandKind,
      sourceSequence,
      sourceAuthenticatedInputSha256: digest(9),
      sourceOutputManifestSha256: await hash(outputBytes),
      sourceSettledReceiptSha256: digest(10),
    }),
    Object.freeze({ kind: "source_output_manifest", frame: output }),
    ...pages.map(frame => Object.freeze({
      kind: "page_manifest" as const,
      frame,
    })),
    Object.freeze({
      kind: "restart_terminal",
      pageCount: BigInt(pages.length),
      payloadByteLength: BigInt(payloadBytes.byteLength),
      finalPageSha256,
      manifestSequenceSha256: await hash(concat(manifestBytes)),
      payloadSha256: await hash(payloadBytes),
    }),
  ];
  pagePayloads.forEach((payload, pageOrdinal) => {
    let offset = 0;
    while (offset < payload.byteLength) {
      const end = Math.min(
        offset +
          DECLARATIVE_V2_AUTHENTICATED_COMMAND_RESTART_INPUT_PAYLOAD_QUANTUM_BYTES_V1,
        payload.byteLength,
      );
      frames.push(Object.freeze({
        kind: "payload",
        pageOrdinal: BigInt(pageOrdinal),
        offset: BigInt(offset),
        bytes: payload.subarray(offset, end),
      }));
      offset = end;
    }
  });
  return frames;
}

function restartClaim(
  frames: readonly DeclarativeV2AuthenticatedCommandRestartInputFrameV1[],
): DeclarativeV2AuthenticatedCommandRestartInputClaimV1 {
  const header = frames[0];
  const terminal = frames.find(frame => frame.kind === "restart_terminal");
  if (
    header?.kind !== "restart_header" ||
    terminal?.kind !== "restart_terminal"
  ) {
    throw new Error("Restart claim fixtures require a header and terminal.");
  }
  return Object.freeze({
    targetRequestSha256: header.targetRequestSha256,
    targetReservationSha256: header.targetReservationSha256,
    targetCommandKind: header.targetCommandKind,
    targetSequence: header.targetSequence,
    analyzerReleaseSha256: header.analyzerReleaseSha256,
    analyzerIdentitySha256: header.analyzerIdentitySha256,
    verifierIdentitySha256: header.verifierIdentitySha256,
    rangeAndPredecessorTailsSha256:
      header.rangeAndPredecessorTailsSha256,
    sourceReservationSha256: header.sourceReservationSha256,
    sourceCommandKind: header.sourceCommandKind,
    sourceSequence: header.sourceSequence,
    sourceAuthenticatedInputSha256: header.sourceAuthenticatedInputSha256,
    sourceOutputManifestSha256: header.sourceOutputManifestSha256,
    sourceSettledReceiptSha256: header.sourceSettledReceiptSha256,
    pageCount: terminal.pageCount,
    payloadByteLength: terminal.payloadByteLength,
    finalPageSha256: terminal.finalPageSha256,
    manifestSequenceSha256: terminal.manifestSequenceSha256,
    payloadSha256: terminal.payloadSha256,
  });
}

function progressBytes(
  frame:
    | DeclarativeV2VerifierCommandOutputManifestFrameV2
    | DeclarativeV2VerifierEvidencePageManifestFrameV2,
): Uint8Array {
  return unwrap(encodeDeclarativeV2VerifierProgressFrameV2(frame, {
    maximumFrameBytes: 1_024,
    maximumCanonicalBytes: 1_024,
  })).canonicalBytes;
}

function encodeOrDecodeManifest(bytes: Uint8Array) {
  let frame:
    | DeclarativeV2VerifierEvidencePageManifestFrameV2
    | undefined;
  const verified = verifyOwnedDeclarativeV2VerifierProgressFrameV2(
    Object.freeze({
      bytes,
      byteOffset: 0,
      byteLength: bytes.byteLength,
    }),
    {
      maximumFrameBytes: bytes.byteLength,
      maximumCanonicalBytes: bytes.byteLength,
    },
    () => Result.succeed(undefined),
  );
  if (
    Result.isSuccess(verified) &&
    verified.success.frame.kind === "evidence_page_manifest"
  ) {
    frame = verified.success.frame;
  }
  return frame === undefined
    ? Result.fail(new Error("manifest"))
    : Result.succeed(frame);
}

function captureProtocolWork(
  frame:
    | DeclarativeV2VerifierCommandOutputManifestFrameV2
    | DeclarativeV2VerifierEvidencePageManifestFrameV2,
) {
  let encoding:
    | Parameters<
      Parameters<typeof encodeDeclarativeV2VerifierProgressFrameIntoV2>[2]
    >[0]["successfulWork"]
    | undefined;
  const encoded = unwrap(encodeDeclarativeV2VerifierProgressFrameIntoV2(
    frame,
    { maximumFrameBytes: 1_024, maximumCanonicalBytes: 1_024 },
    plan => {
      encoding = plan.successfulWork;
      return Result.succeed(Object.freeze({
        bytes: new Uint8Array(plan.canonicalByteLength),
        byteOffset: 0,
        byteLength: plan.canonicalByteLength,
      }));
    },
  ));
  const verified = unwrap(verifyOwnedDeclarativeV2VerifierProgressFrameV2(
    encoded.range,
    { maximumFrameBytes: 1_024, maximumCanonicalBytes: 1_024 },
    () => Result.succeed(undefined),
  ));
  if (encoding === undefined) {
    throw new Error("protocol work");
  }
  return Object.freeze({
    canonicalByteLength: encoded.range.byteLength,
    encoding,
    verification: verified.work,
  });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

const EMPTY = new Uint8Array(0);

async function hash(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
}

function zeroUsage(): DeclarativeV2AuthenticatedCommandRestartInputUsageV1 {
  return Object.freeze({
    bodyBytes: 0,
    canonicalBytes: 0,
    frameBytes: 0,
    payloadBytes: 0,
    frames: 0,
    pages: 0,
    allocationBytes: 0,
    copyBytes: 0,
    scanBytes: 0,
    hashBytes: 0,
    transitions: 0,
  });
}

function failureReason(
  result: Result.Result<
    unknown,
    DeclarativeV2AuthenticatedCommandRestartInputV1Error
  >,
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
