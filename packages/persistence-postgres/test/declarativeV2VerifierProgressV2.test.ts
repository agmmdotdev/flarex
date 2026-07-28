import { createHash } from "node:crypto";
import { Result } from "effect";
import {
  decodeDeclarativeV2VerifierAttemptStoredStateV2,
  decodeDeclarativeV2VerifierAttemptMetadataRowV2,
  decodeDeclarativeV2VerifierCommittedCommandReadbackV2,
  decodeDeclarativeV2VerifierCommandStoredStateV2,
  decodeDeclarativeV2VerifierCommandMetadataRowV2,
  decodeDeclarativeV2VerifierEvidencePageManifestV2,
  decodeDeclarativeV2VerifierEvidencePageMetadataRowV2,
  decodeDeclarativeV2VerifierEvidencePagePayloadV2,
  decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2,
  decodeDeclarativeV2VerifierStoredFrameMetadataV2,
  decodeDeclarativeV2VerifierStoredFrameV2,
} from "../src/declarativeV2VerifierProgressV2";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
  DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
  encodeDeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierDurableCommandKindV2,
  type DeclarativeV2VerifierProgressFrameV2,
  type DeclarativeV2VerifierEvidencePageManifestFrameV2,
  type DeclarativeV2VerifierProgressCursorFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 16_384,
  maximumCanonicalBytes: 16_384,
  maximumPayloadBytes: 16_384,
});

describe("Declarative V2 verifier progress V2 stored rows", () => {
  it("decodes owned canonical frames only after metadata admission", () => {
    const encoded = encodeFrame({
      kind: "progress_cursor",
      phase: "parse",
      settledSequence: 2n,
      moduleOrdinal: 3n,
      edgeOrdinal: 4n,
      pageOrdinal: 5n,
      previousReceiptSha256: digest(6),
    });
    const frameSha256 = sha256(encoded);
    const metadata = Result.getOrThrow(
      decodeDeclarativeV2VerifierStoredFrameMetadataV2({
        codecVersion: 2,
        byteLength: BigInt(encoded.byteLength),
        sha256: frameSha256,
      }),
    );
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        frameSha256,
        "progress_cursor",
        FRAME_BUDGET,
      ),
    );

    expect(decoded.frame).toMatchObject({
      kind: "progress_cursor",
      phase: "parse",
      settledSequence: 2n,
    });
    expect(decoded.canonicalBytes).toEqual(encoded);
    expect(decoded.canonicalBytes).not.toBe(encoded);

    encoded.fill(0);
    frameSha256.fill(0);
    expect(decoded.frame.kind).toBe("progress_cursor");
    expect(decoded.sha256).not.toEqual(frameSha256);
  });

  it("fails closed for noncanonical bytes, digest drift, kind drift, and exact/+1 budgets", () => {
    const encoded = encodeFrame({
      kind: "command_budget",
      ...budgetDimensions(2n),
    });
    const frameSha256 = sha256(encoded);
    const metadata = Result.getOrThrow(
      decodeDeclarativeV2VerifierStoredFrameMetadataV2({
        codecVersion: 2,
        byteLength: BigInt(encoded.byteLength),
        sha256: frameSha256,
      }),
    );
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        frameSha256,
        "command_budget",
        {
          ...FRAME_BUDGET,
          maximumFrameBytes: encoded.byteLength,
          maximumCanonicalBytes: encoded.byteLength,
        },
      ),
    )).toBe(true);
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        frameSha256,
        "command_budget",
        {
          ...FRAME_BUDGET,
          maximumFrameBytes: encoded.byteLength - 1,
        },
      ),
    )).toBe("budgetExceeded");
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        frameSha256,
        "command_budget",
        {
          ...FRAME_BUDGET,
          maximumFrameBytes: encoded.byteLength,
          maximumCanonicalBytes: encoded.byteLength - 1,
        },
      ),
    )).toBe("budgetExceeded");
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        digest(77),
        "command_budget",
        FRAME_BUDGET,
      ),
    )).toBe("digestMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameV2(
        metadata,
        encoded,
        frameSha256,
        "attempt_usage",
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");

    const trailing = new Uint8Array(encoded.byteLength + 1);
    trailing.set(encoded);
    const trailingMetadata = Result.getOrThrow(
      decodeDeclarativeV2VerifierStoredFrameMetadataV2({
        codecVersion: 2,
        byteLength: BigInt(trailing.byteLength),
        sha256: sha256(trailing),
      }),
    );
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameV2(
        trailingMetadata,
        trailing,
        sha256(trailing),
        "command_budget",
        FRAME_BUDGET,
      ),
    )).toBe("invalidStoredBytes");
  });

  it("captures exact metadata without invoking accessors or leaking Proxy defects", () => {
    let getterCalls = 0;
    const accessorRow = {
      codecVersion: 2,
      byteLength: 3n,
      get sha256(): Uint8Array {
        getterCalls += 1;
        return digest(1);
      },
    };
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameMetadataV2(accessorRow),
    )).toBe("invalidInput");
    expect(getterCalls).toBe(0);

    const proxyDefect = new Error("proxy trap must not escape");
    const hostile = new Proxy({}, {
      ownKeys(): never {
        throw proxyDefect;
      },
    });
    expect(failureReason(
      decodeDeclarativeV2VerifierStoredFrameMetadataV2(hostile),
    )).toBe("invalidInput");
  });

  it("decodes coherent attempt and command metadata groups without byte columns", () => {
    const attemptRow = attemptMetadataRow();
    const attempt = Result.getOrThrow(
      decodeDeclarativeV2VerifierAttemptMetadataRowV2(attemptRow),
    );
    expect(attempt).toMatchObject({
      scopeId: "scope-v2",
      lifecycle: "open",
      settledSequence: 0n,
      pendingKind: null,
    });
    attemptRow.attemptSha256.fill(0);
    expect(attempt.attemptSha256).toEqual(digest(20));

    const commandRow = commandMetadataRow();
    const command = Result.getOrThrow(
      decodeDeclarativeV2VerifierCommandMetadataRowV2(commandRow),
    );
    expect(command).toMatchObject({
      commandKind: "parse_module",
      sequence: 1n,
      pageCount: 0n,
      outputManifest: null,
      settledAt: null,
    });
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandMetadataRowV2({
        ...commandMetadataRow(),
        outputManifestCodecVersion: 2,
        outputManifestByteLength: 1n,
        outputManifestSha256: digest(40),
      }),
    )).toBe("normalizedMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierAttemptMetadataRowV2({
        ...attemptMetadataRow(),
        settledSequence: 1n,
        lastReceiptSha256: null,
      }),
    )).toBe("normalizedMismatch");
    const settledFields = {
      outputManifestCodecVersion: 2,
      outputManifestByteLength: 1n,
      outputManifestSha256: digest(40),
      commandUsageCodecVersion: 2,
      commandUsageByteLength: 1n,
      commandUsageSha256: digest(41),
      resultingUsageCodecVersion: 2,
      resultingUsageByteLength: 1n,
      resultingUsageSha256: digest(42),
      nextProgressCodecVersion: 2,
      nextProgressByteLength: 1n,
      nextProgressSha256: digest(43),
      receiptCodecVersion: 2,
      receiptByteLength: 1n,
      receiptSha256: digest(44),
    } as const;
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandMetadataRowV2({
        ...commandMetadataRow(),
        ...settledFields,
        settledAt: new Date("2026-07-26T00:00:01.000Z"),
      }),
    )).toBe("normalizedMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandMetadataRowV2({
        ...commandMetadataRow(),
        ...settledFields,
        pageCount: 1n,
        lastPageSha256: digest(45),
        settledAt: new Date("2025-07-26T00:00:00.000Z"),
      }),
    )).toBe("normalizedMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierAttemptMetadataRowV2({
        ...attemptMetadataRow(),
        writerFence: 2n,
        writerOwnerId: "00000000-0000-0000-0000-000000000001",
        leaseUpdatedAt: new Date("2026-07-26T00:00:00.000Z"),
        leaseExpiresAt: new Date("2026-07-26T00:00:01.000Z"),
        pendingKind: "parse_module",
        pendingSequence: 1n,
        pendingReservationSha256: digest(46),
        pendingReservedByFence: 1n,
        pendingStartedAt: new Date("2026-07-26T00:00:00.000Z"),
      }),
    )).toBe("normalizedMismatch");
  });

  it("proves attempt normalized lineage agrees with every canonical frame", () => {
    const ceilings = storedFrame({
      kind: "attempt_ceilings",
      ...budgetDimensions(10n),
    });
    const usage = storedFrame({
      kind: "attempt_usage",
      ...budgetDimensions(1n),
    });
    const progress = storedFrame({
      kind: "progress_cursor",
      phase: "source",
      settledSequence: 0n,
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      pageOrdinal: 0n,
      previousReceiptSha256: null,
    });
    const identity = storedFrame({
      kind: "attempt_identity",
      candidateSha256: digest(21),
      progressProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_PROGRESS_PROTOCOL_IDENTITY_V2,
      budgetProtocolIdentity:
        DECLARATIVE_V2_VERIFIER_BUDGET_PROTOCOL_IDENTITY_V2,
      ceilingsSha256: ceilings.sha256,
    });
    const row = {
      ...attemptMetadataRow(),
      attemptSha256: identity.sha256,
      identityByteLength: BigInt(identity.bytes.byteLength),
      identitySha256: identity.sha256,
      ceilingsByteLength: BigInt(ceilings.bytes.byteLength),
      ceilingsSha256: ceilings.sha256,
      usageByteLength: BigInt(usage.bytes.byteLength),
      usageSha256: usage.sha256,
      progressByteLength: BigInt(progress.bytes.byteLength),
      progressSha256: progress.sha256,
    };
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierAttemptStoredStateV2(
        row,
        identity.bytes,
        identity.sha256,
        ceilings.bytes,
        ceilings.sha256,
        usage.bytes,
        usage.sha256,
        progress.bytes,
        progress.sha256,
        FRAME_BUDGET,
      ),
    )).toBe(true);
    expect(failureReason(
      decodeDeclarativeV2VerifierAttemptStoredStateV2(
        { ...row, candidateSha256: digest(99) },
        identity.bytes,
        identity.sha256,
        ceilings.bytes,
        ceilings.sha256,
        usage.bytes,
        usage.sha256,
        progress.bytes,
        progress.sha256,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierAttemptStoredStateV2(
        { ...row, lifecycle: "registering" },
        identity.bytes,
        identity.sha256,
        ceilings.bytes,
        ceilings.sha256,
        usage.bytes,
        usage.sha256,
        progress.bytes,
        progress.sha256,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
    const excessiveUsage = storedFrame({
      kind: "attempt_usage",
      ...budgetDimensions(11n),
    });
    expect(failureReason(
      decodeDeclarativeV2VerifierAttemptStoredStateV2(
        {
          ...row,
          usageByteLength: BigInt(excessiveUsage.bytes.byteLength),
          usageSha256: excessiveUsage.sha256,
        },
        identity.bytes,
        identity.sha256,
        ceilings.bytes,
        ceilings.sha256,
        excessiveUsage.bytes,
        excessiveUsage.sha256,
        progress.bytes,
        progress.sha256,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
  });

  it("proves command reservation, settlement, and page-tail frame agreement", () => {
    const commandBudget = storedFrame({
      kind: "command_budget",
      ...budgetDimensions(10n),
    });
    const reservation = storedFrame({
      kind: "command_reservation",
      attemptSha256: digest(20),
      candidateSha256: digest(21),
      commandKind: "parse_module",
      sequence: 1n,
      currentProgressSha256: digest(50),
      predecessorReceiptSha256: null,
      commandBudgetSha256: commandBudget.sha256,
      commandInputSha256: digest(51),
      freshAuthenticatedInputSha256: digest(52),
      analyzerIdentitySha256: digest(53),
      verifierIdentitySha256: digest(54),
      rangeAndPredecessorTailsSha256: digest(55),
    });
    const commandUsage = storedFrame({
      kind: "command_budget",
      ...budgetDimensions(1n),
    });
    const resultingUsage = storedFrame({
      kind: "attempt_usage",
      ...budgetDimensions(2n),
    });
    const nextProgress = storedFrame({
      kind: "progress_cursor",
      phase: "parse",
      settledSequence: 1n,
      moduleOrdinal: 1n,
      edgeOrdinal: 0n,
      pageOrdinal: 1n,
      previousReceiptSha256: null,
    });
    const pageRoot = digest(60);
    const outputManifest = storedFrame({
      kind: "command_output_manifest",
      reservationSha256: reservation.sha256,
      commandKind: "parse_module",
      sequence: 1n,
      evidenceRootSha256: pageRoot,
      evidenceCount: 1n,
      diagnosticsRootSha256: digest(61),
      diagnosticCount: 0n,
      nextProgressSha256: nextProgress.sha256,
    });
    const receipt = storedFrame({
      kind: "command_receipt",
      reservationSha256: reservation.sha256,
      commandUsageSha256: commandUsage.sha256,
      resultingAttemptUsageSha256: resultingUsage.sha256,
      outputManifestSha256: outputManifest.sha256,
      nextProgressSha256: nextProgress.sha256,
    });
    const row = {
      ...commandMetadataRow(),
      reservationSha256: reservation.sha256,
      reservationByteLength: BigInt(reservation.bytes.byteLength),
      reservationFrameSha256: reservation.sha256,
      commandBudgetByteLength: BigInt(commandBudget.bytes.byteLength),
      commandBudgetSha256: commandBudget.sha256,
      pageCount: 1n,
      lastPageSha256: pageRoot,
      outputManifestCodecVersion: 2,
      outputManifestByteLength: BigInt(outputManifest.bytes.byteLength),
      outputManifestSha256: outputManifest.sha256,
      commandUsageCodecVersion: 2,
      commandUsageByteLength: BigInt(commandUsage.bytes.byteLength),
      commandUsageSha256: commandUsage.sha256,
      resultingUsageCodecVersion: 2,
      resultingUsageByteLength: BigInt(resultingUsage.bytes.byteLength),
      resultingUsageSha256: resultingUsage.sha256,
      nextProgressCodecVersion: 2,
      nextProgressByteLength: BigInt(nextProgress.bytes.byteLength),
      nextProgressSha256: nextProgress.sha256,
      receiptCodecVersion: 2,
      receiptByteLength: BigInt(receipt.bytes.byteLength),
      receiptSha256: receipt.sha256,
      settledAt: new Date("2026-07-26T00:00:01.000Z"),
    };
    const settlement = {
      outputManifestBytes: outputManifest.bytes,
      outputManifestObservedSha256: outputManifest.sha256,
      commandUsageBytes: commandUsage.bytes,
      commandUsageObservedSha256: commandUsage.sha256,
      resultingUsageBytes: resultingUsage.bytes,
      resultingUsageObservedSha256: resultingUsage.sha256,
      nextProgressBytes: nextProgress.bytes,
      nextProgressObservedSha256: nextProgress.sha256,
      receiptBytes: receipt.bytes,
      receiptObservedSha256: receipt.sha256,
    };
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierCommandStoredStateV2(
        row,
        digest(21),
        digest(50),
        null,
        "parsing",
        "parse",
        "parsing",
        reservation.bytes,
        reservation.sha256,
        commandBudget.bytes,
        commandBudget.sha256,
        settlement,
        FRAME_BUDGET,
      ),
    )).toBe(true);
    for (const mutation of [
      { candidate: digest(99), row },
      { candidate: digest(21), row: { ...row, lastPageSha256: digest(99) } },
    ]) {
      expect(failureReason(
        decodeDeclarativeV2VerifierCommandStoredStateV2(
          mutation.row,
          mutation.candidate,
          digest(50),
          null,
          "parsing",
          "parse",
          "parsing",
          reservation.bytes,
          reservation.sha256,
          commandBudget.bytes,
          commandBudget.sha256,
          settlement,
          FRAME_BUDGET,
        ),
      )).toBe("normalizedMismatch");
    }
    const wrongReceipt = storedFrame({
      kind: "command_receipt",
      reservationSha256: reservation.sha256,
      commandUsageSha256: digest(99),
      resultingAttemptUsageSha256: resultingUsage.sha256,
      outputManifestSha256: outputManifest.sha256,
      nextProgressSha256: nextProgress.sha256,
    });
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandStoredStateV2(
        {
          ...row,
          receiptByteLength: BigInt(wrongReceipt.bytes.byteLength),
          receiptSha256: wrongReceipt.sha256,
        },
        digest(21),
        digest(50),
        null,
        "parsing",
        "parse",
        "parsing",
        reservation.bytes,
        reservation.sha256,
        commandBudget.bytes,
        commandBudget.sha256,
        {
          ...settlement,
          receiptBytes: wrongReceipt.bytes,
          receiptObservedSha256: wrongReceipt.sha256,
        },
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
  });

  it("keeps predecessor receipts acyclic and validates lifecycle transitions", () => {
    for (const [sequence, predecessor] of [
      [1n, null],
      [2n, digest(70)],
    ] as const) {
      const fixture = settledCommandFixture(sequence, predecessor, predecessor);
      expect(Result.isSuccess(
        decodeDeclarativeV2VerifierCommandStoredStateV2(
          fixture.row,
          digest(21),
          digest(50),
          predecessor,
          "parsing",
          "parse",
          "parsing",
          fixture.reservation.bytes,
          fixture.reservation.sha256,
          fixture.commandBudget.bytes,
          fixture.commandBudget.sha256,
          fixture.settlement,
          FRAME_BUDGET,
        ),
      )).toBe(true);
    }
    const mismatched = settledCommandFixture(2n, digest(70), digest(71));
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandStoredStateV2(
        mismatched.row,
        digest(21),
        digest(50),
        digest(70),
        "parsing",
        "parse",
        "parsing",
        mismatched.reservation.bytes,
        mismatched.reservation.sha256,
        mismatched.commandBudget.bytes,
        mismatched.commandBudget.sha256,
        mismatched.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
    const valid = settledCommandFixture(1n, null, null);
    expect(failureReason(
      decodeDeclarativeV2VerifierCommandStoredStateV2(
        valid.row,
        digest(21),
        digest(50),
        null,
        "open",
        "source",
        "parsing",
        valid.reservation.bytes,
        valid.reservation.sha256,
        valid.commandBudget.bytes,
        valid.commandBudget.sha256,
        valid.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
  });

  it("rehydrates only the latest coherently committed command decision", () => {
    const fixture = settledCommandFixture(1n, null, null);
    const postSettlementAttempt = {
      candidateSha256: digest(21),
      lifecycle: "parsing",
      settledSequence: 1n,
      lastReceiptSha256: fixture.settlement.receiptObservedSha256,
      usageSha256: fixture.settlement.resultingUsageObservedSha256,
      progressSha256: fixture.settlement.nextProgressObservedSha256,
      phase: "parse",
    };
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
        fixture.row,
        postSettlementAttempt,
        fixture.reservation.bytes,
        fixture.reservation.sha256,
        fixture.commandBudget.bytes,
        fixture.commandBudget.sha256,
        fixture.settlement,
        FRAME_BUDGET,
      ),
    )).toBe(true);
    for (
      const [commandKind, nextPhase, validLifecycle, invalidLifecycle] of [
        ["parse_module", "link", "parse_complete", "linking"],
        ["link_page", "link", "linking", "parse_complete"],
        [
          "registration_page",
          "registration",
          "registering",
          "link_complete",
        ],
      ] as const
    ) {
      const advanced = settledCommandFixture(1n, null, null, {
        commandKind,
        nextPhase,
      });
      const advancedAttempt = {
        candidateSha256: digest(21),
        lifecycle: validLifecycle,
        settledSequence: 1n,
        lastReceiptSha256: advanced.settlement.receiptObservedSha256,
        usageSha256: advanced.settlement.resultingUsageObservedSha256,
        progressSha256: advanced.settlement.nextProgressObservedSha256,
        phase: nextPhase,
      };
      expect(Result.isSuccess(
        decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
          advanced.row,
          advancedAttempt,
          advanced.reservation.bytes,
          advanced.reservation.sha256,
          advanced.commandBudget.bytes,
          advanced.commandBudget.sha256,
          advanced.settlement,
          FRAME_BUDGET,
        ),
      )).toBe(true);
      expect(failureReason(
        decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
          advanced.row,
          { ...advancedAttempt, lifecycle: invalidLifecycle },
          advanced.reservation.bytes,
          advanced.reservation.sha256,
          advanced.commandBudget.bytes,
          advanced.commandBudget.sha256,
          advanced.settlement,
          FRAME_BUDGET,
        ),
      )).toBe("normalizedMismatch");
    }
    expect(failureReason(
      decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
        fixture.row,
        { ...postSettlementAttempt, settledSequence: 2n },
        fixture.reservation.bytes,
        fixture.reservation.sha256,
        fixture.commandBudget.bytes,
        fixture.commandBudget.sha256,
        fixture.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
    expect(failureReason(
      decodeDeclarativeV2VerifierCommittedCommandReadbackV2(
        fixture.row,
        new Proxy({}, {
          ownKeys() {
            throw new Error("hostile");
          },
        }),
        fixture.reservation.bytes,
        fixture.reservation.sha256,
        fixture.commandBudget.bytes,
        fixture.commandBudget.sha256,
        fixture.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("invalidInput");
  });

  it("decodes a historical settled parse/link decision without current attempt authority", () => {
    for (const commandKind of ["parse_module", "link_page"] as const) {
      const fixture = settledCommandFixture(7n, digest(70), digest(70), {
        commandKind,
        nextPhase: commandKind === "parse_module" ? "link" : "registration",
      });
      const identity = {
        scopeId: "scope-v2",
        attemptSha256: digest(20),
        commandKind,
        sequence: 7n,
        reservationSha256: fixture.reservation.sha256,
        outputManifestSha256:
          fixture.settlement.outputManifestObservedSha256,
        receiptSha256: fixture.settlement.receiptObservedSha256,
      };
      const decoded = Result.getOrThrow(
        decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
          fixture.row,
          identity,
          fixture.reservation.bytes,
          fixture.reservation.sha256,
          fixture.commandBudget.bytes,
          fixture.commandBudget.sha256,
          fixture.settlement,
          FRAME_BUDGET,
        ),
      );
      expect(decoded.metadata.sequence).toBe(7n);
      expect(decoded.settlement.receipt.sha256).toEqual(
        identity.receiptSha256,
      );
      identity.receiptSha256.fill(0);
      expect(decoded.settlement.receipt.sha256).not.toEqual(
        identity.receiptSha256,
      );

      expect(failureReason(
        decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
          fixture.row,
          { ...identity, receiptSha256: digest(99) },
          fixture.reservation.bytes,
          fixture.reservation.sha256,
          fixture.commandBudget.bytes,
          fixture.commandBudget.sha256,
          fixture.settlement,
          FRAME_BUDGET,
        ),
      )).toBe("normalizedMismatch");

      const incompatibleFixture = settledCommandFixture(
        8n,
        digest(71),
        digest(71),
        {
          commandKind,
          nextPhase:
            commandKind === "parse_module" ? "registration" : "parse",
        },
      );
      expect(failureReason(
        decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
          incompatibleFixture.row,
          {
            scopeId: "scope-v2",
            attemptSha256: digest(20),
            commandKind,
            sequence: 8n,
            reservationSha256: incompatibleFixture.reservation.sha256,
            outputManifestSha256:
              incompatibleFixture.settlement.outputManifestObservedSha256,
            receiptSha256:
              incompatibleFixture.settlement.receiptObservedSha256,
          },
          incompatibleFixture.reservation.bytes,
          incompatibleFixture.reservation.sha256,
          incompatibleFixture.commandBudget.bytes,
          incompatibleFixture.commandBudget.sha256,
          incompatibleFixture.settlement,
          FRAME_BUDGET,
        ),
      )).toBe("normalizedMismatch");
    }

    const fixture = settledCommandFixture(1n, null, null);
    expect(failureReason(
      decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
        fixture.row,
        new Proxy({}, {
          ownKeys() {
            throw new Error("hostile");
          },
        }),
        fixture.reservation.bytes,
        fixture.reservation.sha256,
        fixture.commandBudget.bytes,
        fixture.commandBudget.sha256,
        fixture.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("invalidInput");
    expect(failureReason(
      decodeDeclarativeV2VerifierHistoricalSettledCommandReadbackV2(
        fixture.row,
        {
          scopeId: "scope-v2",
          attemptSha256: digest(20),
          commandKind: "source_page",
          sequence: 1n,
          reservationSha256: fixture.reservation.sha256,
          outputManifestSha256:
            fixture.settlement.outputManifestObservedSha256,
          receiptSha256: fixture.settlement.receiptObservedSha256,
        },
        fixture.reservation.bytes,
        fixture.reservation.sha256,
        fixture.commandBudget.bytes,
        fixture.commandBudget.sha256,
        fixture.settlement,
        FRAME_BUDGET,
      ),
    )).toBe("invalidInput");
  });

  it("admits page metadata before separately touching payload bytes", () => {
    const payload = Uint8Array.of(0, 0, 0, 1, 0x7b);
    const payloadSha256 = sha256(payload);
    const manifestFrame: DeclarativeV2VerifierEvidencePageManifestFrameV2 = {
      kind: "evidence_page_manifest",
      reservationSha256: digest(1),
      commandKind: "parse_module",
      sequence: 1n,
      pageOrdinal: 0n,
      firstEvidenceOrdinal: 0n,
      evidenceCount: 1n,
      firstDiagnosticOrdinal: 0n,
      diagnosticCount: 0n,
      predecessorPageSha256: null,
      payloadByteLength: BigInt(payload.byteLength),
      payloadSha256,
      cumulativeDiagnosticsRootSha256: digest(2),
    };
    const manifestBytes = encodeFrame(manifestFrame);
    const manifestSha256 = sha256(manifestBytes);
    const row = pageMetadataRow({
      manifestBytes,
      manifestSha256,
      payload,
      payloadSha256,
    });
    const metadata = Result.getOrThrow(
      decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(row),
    );
    expect(Result.isSuccess(
      decodeDeclarativeV2VerifierEvidencePageManifestV2(
        metadata,
        manifestBytes,
        manifestSha256,
        FRAME_BUDGET,
      ),
    )).toBe(true);
    const owned = Result.getOrThrow(
      decodeDeclarativeV2VerifierEvidencePagePayloadV2(
        metadata,
        payload,
        payloadSha256,
        {
          ...FRAME_BUDGET,
          maximumPayloadBytes: payload.byteLength,
        },
      ),
    );
    expect(owned).toEqual(payload);
    expect(owned).not.toBe(payload);
    expect(failureReason(
      decodeDeclarativeV2VerifierEvidencePagePayloadV2(
        metadata,
        payload,
        payloadSha256,
        {
          ...FRAME_BUDGET,
          maximumPayloadBytes: payload.byteLength - 1,
        },
      ),
    )).toBe("budgetExceeded");

    let payloadGetterCalls = 0;
    const rowWithForbiddenPayload = {
      ...row,
      get payloadBytes(): Uint8Array {
        payloadGetterCalls += 1;
        return payload;
      },
    };
    expect(failureReason(
      decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(
        rowWithForbiddenPayload,
      ),
    )).toBe("invalidInput");
    expect(payloadGetterCalls).toBe(0);

    expect(failureReason(
      decodeDeclarativeV2VerifierEvidencePageManifestV2(
        Object.freeze({ ...metadata, evidenceCount: 2n }),
        manifestBytes,
        manifestSha256,
        FRAME_BUDGET,
      ),
    )).toBe("normalizedMismatch");
  });

  it("rejects incoherent page ranges and isolates metadata aliases", () => {
    const payload = Uint8Array.of(1);
    const payloadSha256 = sha256(payload);
    const manifestBytes = encodeFrame({
      kind: "evidence_page_manifest",
      reservationSha256: digest(1),
      commandKind: "link_page",
      sequence: 2n,
      pageOrdinal: 1n,
      firstEvidenceOrdinal: 4n,
      evidenceCount: 2n,
      firstDiagnosticOrdinal: 1n,
      diagnosticCount: 1n,
      predecessorPageSha256: digest(3),
      payloadByteLength: 1n,
      payloadSha256,
      cumulativeDiagnosticsRootSha256: digest(4),
    });
    const manifestSha256 = sha256(manifestBytes);
    const row = pageMetadataRow({
      manifestBytes,
      manifestSha256,
      payload,
      payloadSha256,
      overrides: {
        commandKind: "link_page",
        sequence: 2n,
        pageOrdinal: 1n,
        firstEvidenceOrdinal: 4n,
        evidenceCount: 2n,
        firstDiagnosticOrdinal: 1n,
        diagnosticCount: 1n,
        predecessorPageSha256: digest(3),
      },
    });
    const metadata = Result.getOrThrow(
      decodeDeclarativeV2VerifierEvidencePageMetadataRowV2(row),
    );
    row.attemptSha256.fill(0);
    expect(metadata.attemptSha256).toEqual(digest(10));

    expect(failureReason(
      decodeDeclarativeV2VerifierEvidencePageMetadataRowV2({
        ...pageMetadataRow({
          manifestBytes,
          manifestSha256,
          payload,
          payloadSha256,
        }),
        pageOrdinal: 1n,
        predecessorPageSha256: null,
      }),
    )).toBe("normalizedMismatch");
  });
});

function encodeFrame(input: unknown): Uint8Array {
  return Result.getOrThrow(
    encodeDeclarativeV2VerifierProgressFrameV2(input, {
      maximumFrameBytes: FRAME_BUDGET.maximumFrameBytes,
      maximumCanonicalBytes: FRAME_BUDGET.maximumCanonicalBytes,
    }),
  ).canonicalBytes;
}

function storedFrame(frame: DeclarativeV2VerifierProgressFrameV2) {
  const bytes = encodeFrame(frame);
  return Object.freeze({
    bytes,
    sha256: sha256(bytes),
  });
}

function settledCommandFixture(
  sequence: bigint,
  predecessorReceiptSha256: Uint8Array | null,
  nextPreviousReceiptSha256: Uint8Array | null,
  options: Readonly<{
    readonly commandKind?: DeclarativeV2VerifierDurableCommandKindV2;
    readonly nextPhase?: DeclarativeV2VerifierProgressCursorFrameV2["phase"];
  }> = {},
) {
  const commandKind = options.commandKind ?? "parse_module";
  const nextPhase = options.nextPhase ?? "parse";
  const hasEvidencePages =
    commandKind === "parse_module" || commandKind === "link_page";
  const commandBudget = storedFrame({
    kind: "command_budget",
    ...budgetDimensions(10n),
  });
  const reservation = storedFrame({
    kind: "command_reservation",
    attemptSha256: digest(20),
    candidateSha256: digest(21),
    commandKind,
    sequence,
    currentProgressSha256: digest(50),
    predecessorReceiptSha256,
    commandBudgetSha256: commandBudget.sha256,
    commandInputSha256: digest(51),
    freshAuthenticatedInputSha256: digest(52),
    analyzerIdentitySha256: digest(53),
    verifierIdentitySha256: digest(54),
    rangeAndPredecessorTailsSha256: digest(55),
  });
  const commandUsage = storedFrame({
    kind: "command_budget",
    ...budgetDimensions(1n),
  });
  const resultingUsage = storedFrame({
    kind: "attempt_usage",
    ...budgetDimensions(2n),
  });
  const nextProgress = storedFrame({
    kind: "progress_cursor",
    phase: nextPhase,
    settledSequence: sequence,
    moduleOrdinal: sequence,
    edgeOrdinal: 0n,
    pageOrdinal: sequence,
    previousReceiptSha256: nextPreviousReceiptSha256,
  });
  const pageRoot = digest(60);
  const outputManifest = storedFrame({
    kind: "command_output_manifest",
    reservationSha256: reservation.sha256,
    commandKind,
    sequence,
    evidenceRootSha256: pageRoot,
    evidenceCount: 1n,
    diagnosticsRootSha256: digest(61),
    diagnosticCount: 0n,
    nextProgressSha256: nextProgress.sha256,
  });
  const receipt = storedFrame({
    kind: "command_receipt",
    reservationSha256: reservation.sha256,
    commandUsageSha256: commandUsage.sha256,
    resultingAttemptUsageSha256: resultingUsage.sha256,
    outputManifestSha256: outputManifest.sha256,
    nextProgressSha256: nextProgress.sha256,
  });
  return {
    commandBudget,
    reservation,
    row: {
      ...commandMetadataRow(),
      sequence,
      commandKind,
      reservationSha256: reservation.sha256,
      reservationByteLength: BigInt(reservation.bytes.byteLength),
      reservationFrameSha256: reservation.sha256,
      commandBudgetByteLength: BigInt(commandBudget.bytes.byteLength),
      commandBudgetSha256: commandBudget.sha256,
      pageCount: hasEvidencePages ? 1n : 0n,
      lastPageSha256: hasEvidencePages ? pageRoot : null,
      outputManifestCodecVersion: 2,
      outputManifestByteLength: BigInt(outputManifest.bytes.byteLength),
      outputManifestSha256: outputManifest.sha256,
      commandUsageCodecVersion: 2,
      commandUsageByteLength: BigInt(commandUsage.bytes.byteLength),
      commandUsageSha256: commandUsage.sha256,
      resultingUsageCodecVersion: 2,
      resultingUsageByteLength: BigInt(resultingUsage.bytes.byteLength),
      resultingUsageSha256: resultingUsage.sha256,
      nextProgressCodecVersion: 2,
      nextProgressByteLength: BigInt(nextProgress.bytes.byteLength),
      nextProgressSha256: nextProgress.sha256,
      receiptCodecVersion: 2,
      receiptByteLength: BigInt(receipt.bytes.byteLength),
      receiptSha256: receipt.sha256,
      settledAt: new Date("2026-07-26T00:00:01.000Z"),
    },
    settlement: {
      outputManifestBytes: outputManifest.bytes,
      outputManifestObservedSha256: outputManifest.sha256,
      commandUsageBytes: commandUsage.bytes,
      commandUsageObservedSha256: commandUsage.sha256,
      resultingUsageBytes: resultingUsage.bytes,
      resultingUsageObservedSha256: resultingUsage.sha256,
      nextProgressBytes: nextProgress.bytes,
      nextProgressObservedSha256: nextProgress.sha256,
      receiptBytes: receipt.bytes,
      receiptObservedSha256: receipt.sha256,
    },
  };
}

function pageMetadataRow(input: {
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Uint8Array;
  readonly payload: Uint8Array;
  readonly payloadSha256: Uint8Array;
  readonly overrides?: Readonly<Record<string, unknown>>;
}) {
  return {
    scopeId: "scope-v2",
    attemptSha256: digest(10),
    sequence: 1n,
    commandKind: "parse_module",
    reservationSha256: digest(1),
    pageOrdinal: 0n,
    pageSha256: new Uint8Array(input.manifestSha256),
    firstEvidenceOrdinal: 0n,
    evidenceCount: 1n,
    firstDiagnosticOrdinal: 0n,
    diagnosticCount: 0n,
    predecessorPageSha256: null,
    cumulativeDiagnosticsRootSha256: digest(2),
    manifestCodecVersion: 2,
    manifestByteLength: BigInt(input.manifestBytes.byteLength),
    manifestSha256: new Uint8Array(input.manifestSha256),
    payloadCodecVersion: 1,
    payloadByteLength: BigInt(input.payload.byteLength),
    payloadSha256: new Uint8Array(input.payloadSha256),
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
    ...input.overrides,
  };
}

function attemptMetadataRow() {
  return {
    scopeId: "scope-v2",
    attemptSha256: digest(20),
    candidateSha256: digest(21),
    lifecycle: "open",
    writerOwnerId: null,
    writerFence: 0n,
    leaseUpdatedAt: null,
    leaseExpiresAt: null,
    settledSequence: 0n,
    lastReceiptSha256: null,
    pendingKind: null,
    pendingSequence: null,
    pendingReservationSha256: null,
    pendingReservedByFence: null,
    pendingStartedAt: null,
    identityCodecVersion: 2,
    identityByteLength: 1n,
    identitySha256: digest(20),
    ceilingsCodecVersion: 2,
    ceilingsByteLength: 1n,
    ceilingsSha256: digest(22),
    usageCodecVersion: 2,
    usageByteLength: 1n,
    usageSha256: digest(23),
    progressCodecVersion: 2,
    progressByteLength: 1n,
    progressSha256: digest(24),
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
    updatedAt: new Date("2026-07-26T00:00:01.000Z"),
  };
}

function commandMetadataRow() {
  return {
    scopeId: "scope-v2",
    attemptSha256: digest(20),
    sequence: 1n,
    commandKind: "parse_module",
    reservationSha256: digest(30),
    reservationCodecVersion: 2,
    reservationByteLength: 1n,
    reservationFrameSha256: digest(30),
    commandBudgetCodecVersion: 2,
    commandBudgetByteLength: 1n,
    commandBudgetSha256: digest(31),
    reservedByFence: 1n,
    reservedAt: new Date("2026-07-26T00:00:00.000Z"),
    pageCount: 0n,
    lastPageSha256: null,
    outputManifestCodecVersion: null,
    outputManifestByteLength: null,
    outputManifestSha256: null,
    commandUsageCodecVersion: null,
    commandUsageByteLength: null,
    commandUsageSha256: null,
    resultingUsageCodecVersion: null,
    resultingUsageByteLength: null,
    resultingUsageSha256: null,
    nextProgressCodecVersion: null,
    nextProgressByteLength: null,
    nextProgressSha256: null,
    receiptCodecVersion: null,
    receiptByteLength: null,
    receiptSha256: null,
    settledAt: null,
  };
}

function budgetDimensions(value: bigint) {
  return {
    calls: value,
    objectCalls: value,
    objectBodyBytes: value,
    sourceBytes: value,
    sourceMapBytes: value,
    semanticBytes: value,
    modules: value,
    importEdges: value,
    exports: value,
    functions: value,
    tokens: value,
    tokenBytes: value,
    parserStates: value,
    nestingDepth: value,
    schemaNodes: value,
    validatorNodes: value,
    graphNodes: value,
    frontierEntries: value,
    stringBytes: value,
    tableBytes: value,
    canonicalBytes: value,
    frameBytes: value,
    hashBytes: value,
    diagnosticBytes: value,
    outputBytes: value,
    elapsedMilliseconds: value,
  } as const;
}

function digest(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function failureReason(result: Result.Result<unknown, { readonly reason: string }>) {
  if (Result.isSuccess(result)) throw new Error("Expected failure.");
  return result.failure.reason;
}
