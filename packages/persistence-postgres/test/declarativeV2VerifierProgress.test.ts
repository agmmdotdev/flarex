import { webcrypto } from "node:crypto";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2BudgetFrameV1,
  type DeclarativeV2CandidateFrameV1,
  type DeclarativeV2PhysicalFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  makeDeclarativeV2InertRepositoryV1,
} from "../src/declarativeV2InertRepository";
import {
  makeDeclarativeV2VerifierProgressRepositoryV1,
} from "../src/declarativeV2VerifierProgress";
import {
  makeLiveDeclarativeV2Sha256V1,
} from "../src/declarativeV2Sha256";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";

const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;
const epoch = `epoch_${SESSION_TEST_EPOCH_UUID}`;
const semanticBudgetDimensions = [
  "calls",
  "sourceBytes",
  "modules",
  "importEdges",
  "tokens",
  "tokenBytes",
  "nestingDepth",
  "functions",
  "schemaNodes",
  "validatorNodes",
  "graphNodes",
  "frontierEntries",
  "canonicalBytes",
  "frameBytes",
  "hashBytes",
  "diagnosticBytes",
  "outputBytes",
  "elapsedMilliseconds",
] as const;
const operationBudget = {
  maximumCalls: 100,
  maximumRows: 100,
  maximumFrameBytes: 2_000_000,
  maximumCanonicalBytes: 2_000_000,
  maximumHashBytes: 2_000_000,
  maximumElapsedMilliseconds: 60_000,
} as const;

describe("Declarative V2 durable verifier progress", () => {
  it("creates, acquires, reserves, settles atomically, releases, and restarts", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const observed = await runEffect(
      repository.observeAttempt(scopeId, attemptSha256, operationBudget),
    );
    expect(observed.kind).toBe("present");
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    expect(observed.attempt).toMatchObject({
      lifecycle: "open",
      settledSequence: 0n,
      pendingKind: null,
      progress: { phase: "source", settledSequence: 0n },
    });

    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");

    const busy = await runEffectFailure(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    expect(busy).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressBusyV1Error",
      operation: "acquire",
    });

    const inputSha256 = digest(0x71);
    const commandBudget = semanticBudget("command_budget", 1n);
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget,
        inputSha256,
      },
      operationBudget,
    ));
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind === "settledReplay") {
      throw new Error("Expected work.");
    }

    const settled = await runEffect(repository.settleCommand(
      reserved.work,
      {
        frames: [
          {
            kind: "module_summary",
            attemptSha256,
            moduleOrdinal: 0n,
            modulePath: "src/main.mjs",
            moduleSha256: digest(0x31),
            sourceMapSha256: null,
            importCount: 0n,
            declaredFunctionCount: 1n,
          },
          {
            kind: "phase_page_manifest",
            attemptSha256,
            phase: "source",
            pageOrdinal: 0n,
            firstItemOrdinal: 0n,
            itemCount: 1n,
            previousPageSha256: null,
            pageRootSha256: digest(0x32),
          },
        ],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 1n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(settled.receipt).toMatchObject({
      kind: "command_receipt",
      commandKind: "source_page",
      sequence: 1n,
    });

    await expect(runEffect(repository.settleCommand(
      reserved.work,
      {
        frames: [],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 1n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ))).rejects.toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "workClosed",
    });

    await runEffect(repository.release(acquired.run, operationBudget));
    const restarted = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    expect(restarted.kind).toBe("acquired");
    if (restarted.kind !== "acquired") throw new Error("Expected restart.");
    expect(restarted.attempt).toMatchObject({
      lifecycle: "parsing",
      settledSequence: 1n,
      pendingKind: null,
      progress: { phase: "parse", moduleOrdinal: 1n },
    });

    const counts = await persistence.query<{
      modules: string;
      pages: string;
      verdicts: string;
      heads: string;
    }>(`
      select
        (select count(*) from fx_system_declarative_v2_module_summary)::text
          as modules,
        (select count(*) from fx_system_declarative_v2_page_manifest)::text
          as pages,
        (select count(*) from fx_system_declarative_v2_verdict)::text
          as verdicts,
        (select count(*) from fx_system_declarative_v2_activation_head)::text
          as heads
    `);
    expect(counts.rows).toEqual([{
      modules: "1",
      pages: "1",
      verdicts: "0",
      heads: "0",
    }]);
  });

  it("replays reservations without recharge and rejects mismatched pending input", async () => {
    const { repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const command = {
      commandKind: "source_page",
      sequence: 1n,
      previousReceiptSha256: null,
      commandBudget: semanticBudget("command_budget", 2n),
      inputSha256: digest(0x41),
    } as const;
    const first = await runEffect(
      repository.reserveCommand(acquired.run, command, operationBudget),
    );
    expect(first.kind).toBe("reserved");
    const replay = await runEffect(
      repository.reserveCommand(acquired.run, command, operationBudget),
    );
    expect(replay.kind).toBe("pendingReplay");

    const mismatch = await runEffectFailure(
      repository.resumePending(
        acquired.run,
        digest(0x42),
        operationBudget,
      ),
    );
    expect(mismatch).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "commandMismatch",
    });
    const resumed = await runEffect(repository.resumePending(
      acquired.run,
      command.inputSha256,
      operationBudget,
    ));
    expect(resumed.work).toMatchObject({
      _tag: "DeclarativeV2VerifierWorkV1",
    });
  });

  it("enforces exact operation budgets before SQL and supports live abandon only", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const noCalls = await runEffectFailure(
      repository.observeAttempt(scopeId, attemptSha256, {
        ...operationBudget,
        maximumCalls: 0,
      }),
    );
    expect(noCalls).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "budgetExceeded",
      dimension: "calls",
      observed: 1,
      maximum: 0,
    });
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    await runEffect(repository.abandon(acquired.run, operationBudget));
    const row = await persistence.query<{ lifecycle: string }>(
      `select lifecycle from fx_system_declarative_v2_verifier_attempt`,
    );
    expect(row.rows).toEqual([{ lifecycle: "abandoned" }]);
    const closed = await runEffectFailure(
      repository.renew(acquired.run, operationBudget),
    );
    expect(closed).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "runClosed",
    });
  });

  it("charges semantic ceilings once with exact and one-over receipts", async () => {
    const exactFixture = await fixture(2n);
    const exactAcquire = await runEffect(
      exactFixture.repository.acquire(
        scopeId,
        exactFixture.attemptSha256,
        operationBudget,
      ),
    );
    if (exactAcquire.kind !== "acquired") throw new Error("Expected acquire.");
    const exact = await runEffect(exactFixture.repository.reserveCommand(
      exactAcquire.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 2n),
        inputSha256: digest(0x21),
      },
      operationBudget,
    ));
    expect(exact.kind).toBe("reserved");
    if (exact.kind === "settledReplay") throw new Error("Expected work.");
    await runEffect(exactFixture.repository.settleCommand(
      exact.work,
      {
        frames: [],
        nextLifecycle: "parsing",
        nextProgress: progressCursor("parse", 1n, null),
      },
      operationBudget,
    ));
    await runEffect(
      exactFixture.repository.release(exactAcquire.run, operationBudget),
    );
    const exactRestart = await runEffect(
      exactFixture.repository.acquire(
        scopeId,
        exactFixture.attemptSha256,
        operationBudget,
      ),
    );
    if (exactRestart.kind !== "acquired") throw new Error("Expected acquire.");
    const exactReplay = await runEffect(
      exactFixture.repository.reserveCommand(
        exactRestart.run,
        {
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          commandBudget: semanticBudget("command_budget", 2n),
          inputSha256: digest(0x21),
        },
        operationBudget,
      ),
    );
    expect(exactReplay.kind).toBe("settledReplay");

    const overFixture = await fixture(2n);
    const overAcquire = await runEffect(
      overFixture.repository.acquire(
        scopeId,
        overFixture.attemptSha256,
        operationBudget,
      ),
    );
    if (overAcquire.kind !== "acquired") throw new Error("Expected acquire.");
    for (const [index, dimension] of semanticBudgetDimensions.entries()) {
      const over = await runEffectFailure(
        overFixture.repository.reserveCommand(
          overAcquire.run,
          {
            commandKind: "source_page",
            sequence: 1n,
            previousReceiptSha256: null,
            commandBudget: {
              ...semanticBudget("command_budget", 0n),
              [dimension]: 3n,
            },
            inputSha256: digest(0x22 + index),
          },
          operationBudget,
        ),
      );
      expect(over).toMatchObject({
        _tag: "DeclarativeV2VerifierProgressInputV1Error",
        reason: "budgetExceeded",
        semanticDimension: dimension,
        observedSemantic: 3n,
        maximumSemantic: 2n,
      });
    }
    const observed = await runEffect(overFixture.repository.observeAttempt(
      scopeId,
      overFixture.attemptSha256,
      operationBudget,
    ));
    expect(observed.kind).toBe("present");
    if (observed.kind !== "present") throw new Error("Expected attempt.");
    expect(observed.attempt).toMatchObject({
      usage: { calls: 0n },
      pendingKind: null,
    });
  });

  it("rebinds one pending reservation on expiry without recharge and fences stale work", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const first = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (first.kind !== "acquired") throw new Error("Expected acquire.");
    const inputSha256 = digest(0x61);
    const reserved = await runEffect(repository.reserveCommand(
      first.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 3n),
        inputSha256,
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set
        lease_updated_at = clock_timestamp() - interval '2 seconds',
        lease_expires_at = clock_timestamp() - interval '1 second'
    `);

    const takeover = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (takeover.kind !== "acquired") throw new Error("Expected takeover.");
    expect(takeover.attempt).toMatchObject({
      pendingKind: "source_page",
      pendingSequence: 1n,
      pendingReservedByFence: takeover.attempt.writerFence,
      usage: { calls: 3n },
    });
    const resumed = await runEffect(
      repository.resumePending(
        takeover.run,
        inputSha256,
        operationBudget,
      ),
    );
    expect(resumed.work).toMatchObject({
      _tag: "DeclarativeV2VerifierWorkV1",
    });
    const staleWork = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 0n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(staleWork).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressStaleV1Error",
      reason: "ownerChanged",
    });
  });

  it("fails fence exhaustion without a write", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set writer_fence = 9223372036854775807
    `);
    const failure = await runEffectFailure(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressExhaustionV1Error",
      dimension: "writerFence",
      observed: 9_223_372_036_854_775_807n,
    });
    const row = await persistence.query<{
      writer_fence: string;
      writer_owner_id: string | null;
    }>(`
      select writer_fence::text, writer_owner_id
      from fx_system_declarative_v2_verifier_attempt
    `);
    expect(row.rows).toEqual([{
      writer_fence: "9223372036854775807",
      writer_owner_id: null,
    }]);
  });

  it("keeps invalid monotonic configuration in the typed error channel", async () => {
    const current = await fixture();
    const repository = makeDeclarativeV2VerifierProgressRepositoryV1(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        monotonicMilliseconds: () => Number.NaN,
      },
    );
    const failure = await runEffectFailure(
      repository.acquire(
        scopeId,
        current.attemptSha256,
        operationBudget,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressConfigurationV1Error",
      reason: "invalidMonotonicClock",
    });
  });

  it("rejects multiple mutable versions for one logical key before settlement", async () => {
    const { repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const receipt1 = await reserveAndSettleEmpty(
      repository,
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        inputByte: 0xa1,
        nextLifecycle: "parsing",
        nextPhase: "parse",
      },
    );
    const receipt1Sha256 = await frameDigest(receipt1);
    const receipt2 = await reserveAndSettleEmpty(
      repository,
      acquired.run,
      {
        commandKind: "parse_module",
        sequence: 2n,
        previousReceiptSha256: receipt1Sha256,
        inputByte: 0xa2,
        nextLifecycle: "parse_complete",
        nextPhase: "link",
      },
    );
    const receipt2Sha256 = await frameDigest(receipt2);
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "link_page",
        sequence: 3n,
        previousReceiptSha256: receipt2Sha256,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0xa3),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    const linkV0 = {
      kind: "link_node",
      attemptSha256,
      moduleOrdinal: 0n,
      remainingIndegree: 1n,
      nextEdgeOrdinal: 0n,
      state: "pending",
      rowVersion: 0n,
      previousRowSha256: null,
    } as const;
    const failure = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [
          linkV0,
          {
            ...linkV0,
            remainingIndegree: 0n,
            state: "linked",
            rowVersion: 1n,
            previousRowSha256: await frameDigest(linkV0),
          },
        ],
        nextLifecycle: "linking",
        nextProgress: progressCursor("link", 3n, receipt2Sha256),
      },
      operationBudget,
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCollisionV1Error",
      reason: "mutableEvidenceChanged",
    });
  });

  it("maps alternate immutable uniqueness conflicts to typed collision", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 2n),
        inputSha256: digest(0xac),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    const module = {
      kind: "module_summary",
      attemptSha256,
      moduleOrdinal: 0n,
      modulePath: "src/shared.mjs",
      moduleSha256: digest(0xad),
      sourceMapSha256: null,
      importCount: 0n,
      declaredFunctionCount: 0n,
    } as const;
    const failure = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [module, { ...module, moduleOrdinal: 1n }],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 2n,
          edgeOrdinal: 0n,
          pageOrdinal: 0n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCollisionV1Error",
      reason: "immutableEvidenceChanged",
    });
    const rows = await persistence.query<{ modules: string }>(`
      select count(*)::text as modules
      from fx_system_declarative_v2_module_summary
    `);
    expect(rows.rows).toEqual([{ modules: "0" }]);
  });

  it("rejects impossible stored frame metadata before fetching oversized bytes", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    await persistence.query(`
      alter table fx_system_declarative_v2_verifier_attempt
      drop constraint fx_dv2_attempt_identity_frame_check
    `);
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set
        identity_byte_length = 9223372036854775807,
        identity_bytes = '\\x'::bytea
    `);
    const failure = await runEffectFailure(repository.observeAttempt(
      scopeId,
      attemptSha256,
      operationBudget,
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCorruptionV1Error",
      operation: "observeAttempt",
      reason: "invalidMetadata",
    });
  });

  it("treats a canonically stored broken receipt chain as corruption", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const receipt = await reserveAndSettleEmpty(
      repository,
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        inputByte: 0xb1,
        nextLifecycle: "parsing",
        nextPhase: "parse",
      },
    );
    const corrupted = {
      ...receipt,
      reservationSha256: digest(0xff),
    } as const;
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(corrupted, {
        maximumFrameBytes: 1_000_000,
        maximumCanonicalBytes: 1_000_000,
      }),
    );
    const sha256 = await webcrypto.subtle.digest(
      "SHA-256",
      new Uint8Array(encoded.canonicalBytes),
    );
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set
        last_receipt_byte_length = ${encoded.canonicalBytes.byteLength},
        last_receipt_sha256 = '\\x${hex(new Uint8Array(sha256))}'::bytea,
        last_receipt_bytes =
          '\\x${hex(encoded.canonicalBytes)}'::bytea
    `);
    const failure = await runEffectFailure(repository.observeAttempt(
      scopeId,
      attemptSha256,
      operationBudget,
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCorruptionV1Error",
      reason: "normalizedMismatch",
    });
  });

  it("applies link and frontier version/digest CAS in deterministic order", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");

    const receipt1 = await reserveAndSettleEmpty(
      repository,
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        inputByte: 0x81,
        nextLifecycle: "parsing",
        nextPhase: "parse",
      },
    );
    const receipt1Sha256 = await frameDigest(receipt1);
    const receipt2 = await reserveAndSettleEmpty(
      repository,
      acquired.run,
      {
        commandKind: "parse_module",
        sequence: 2n,
        previousReceiptSha256: receipt1Sha256,
        inputByte: 0x82,
        nextLifecycle: "parse_complete",
        nextPhase: "link",
      },
    );
    const receipt2Sha256 = await frameDigest(receipt2);

    const linkV0 = {
      kind: "link_node",
      attemptSha256,
      moduleOrdinal: 0n,
      remainingIndegree: 1n,
      nextEdgeOrdinal: 0n,
      state: "pending",
      rowVersion: 0n,
      previousRowSha256: null,
    } as const;
    const frontierV0 = {
      kind: "frontier_entry",
      attemptSha256,
      frontierSequence: 0n,
      moduleOrdinal: 0n,
      state: "queued",
      rowVersion: 0n,
      previousRowSha256: null,
    } as const;
    const linkV0Sha256 = await frameDigest(linkV0);
    const frontierV0Sha256 = await frameDigest(frontierV0);
    const reserve3 = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "link_page",
        sequence: 3n,
        previousReceiptSha256: receipt2Sha256,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x83),
      },
      operationBudget,
    ));
    if (reserve3.kind === "settledReplay") throw new Error("Expected work.");
    const settled3 = await runEffect(repository.settleCommand(
      reserve3.work,
      {
        frames: [frontierV0, linkV0],
        nextLifecycle: "linking",
        nextProgress: progressCursor(
          "link",
          3n,
          receipt2Sha256,
        ),
      },
      operationBudget,
    ));
    const receipt3Sha256 = await frameDigest(settled3.receipt);

    const linkV1 = {
      ...linkV0,
      remainingIndegree: 0n,
      nextEdgeOrdinal: 1n,
      state: "linked",
      rowVersion: 1n,
      previousRowSha256: linkV0Sha256,
    } as const;
    const frontierV1 = {
      ...frontierV0,
      state: "consumed",
      rowVersion: 1n,
      previousRowSha256: frontierV0Sha256,
    } as const;
    const reserve4 = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "link_page",
        sequence: 4n,
        previousReceiptSha256: receipt3Sha256,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x84),
      },
      operationBudget,
    ));
    if (reserve4.kind === "settledReplay") throw new Error("Expected work.");
    await runEffect(repository.settleCommand(
      reserve4.work,
      {
        frames: [linkV1, frontierV1],
        nextLifecycle: "linking",
        nextProgress: progressCursor(
          "link",
          4n,
          receipt3Sha256,
        ),
      },
      operationBudget,
    ));

    const rows = await persistence.query<{
      link_version: string;
      link_state: string;
      frontier_version: string;
      frontier_state: string;
    }>(`
      select
        link.row_version::text as link_version,
        link.state as link_state,
        frontier.row_version::text as frontier_version,
        frontier.state as frontier_state
      from fx_system_declarative_v2_link_node link
      cross join fx_system_declarative_v2_frontier_entry frontier
    `);
    expect(rows.rows).toEqual([{
      link_version: "1",
      link_state: "linked",
      frontier_version: "1",
      frontier_state: "consumed",
    }]);
  });

  it("rejects page gaps and rolls back a multi-row batch after an injected failure", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x51),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    const gap = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [{
          kind: "phase_page_manifest",
          attemptSha256,
          phase: "source",
          pageOrdinal: 1n,
          firstItemOrdinal: 1n,
          itemCount: 1n,
          previousPageSha256: digest(0x52),
          pageRootSha256: digest(0x53),
        }],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 2n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(gap).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCollisionV1Error",
      reason: "pageRangeConflict",
    });
    const afterGap = await persistence.query<{
      pages: string;
      pending_kind: string | null;
    }>(`
      select
        (select count(*) from fx_system_declarative_v2_page_manifest)::text
          as pages,
        pending_kind
      from fx_system_declarative_v2_verifier_attempt
    `);
    expect(afterGap.rows).toEqual([{
      pages: "0",
      pending_kind: "source_page",
    }]);

    await persistence.query(`
      create function fx_test_fail_page_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'injected page failure';
      end
      $$
    `);
    await persistence.query(`
      create trigger fx_test_fail_page_insert
      before insert on fx_system_declarative_v2_page_manifest
      for each row execute function fx_test_fail_page_insert()
    `);
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set
        writer_owner_id = null,
        lease_updated_at = null,
        lease_expires_at = null
    `);
    const restarted = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (restarted.kind !== "acquired") throw new Error("Expected restart.");
    const resumed = await runEffect(repository.resumePending(
      restarted.run,
      digest(0x51),
      operationBudget,
    ));
    const rollback = await runEffectFailure(repository.settleCommand(
      resumed.work,
      {
        frames: [
          {
            kind: "module_summary",
            attemptSha256,
            moduleOrdinal: 0n,
            modulePath: "src/failing.mjs",
            moduleSha256: digest(0x54),
            sourceMapSha256: null,
            importCount: 0n,
            declaredFunctionCount: 0n,
          },
          {
            kind: "phase_page_manifest",
            attemptSha256,
            phase: "source",
            pageOrdinal: 0n,
            firstItemOrdinal: 0n,
            itemCount: 1n,
            previousPageSha256: null,
            pageRootSha256: digest(0x55),
          },
        ],
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 1n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(rollback).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressConfirmedRollbackV1Error",
      operation: "settleCommand",
    });
    const afterRollback = await persistence.query<{
      modules: string;
      pages: string;
      settled_sequence: string;
      pending_kind: string;
    }>(`
      select
        (select count(*) from fx_system_declarative_v2_module_summary)::text
          as modules,
        (select count(*) from fx_system_declarative_v2_page_manifest)::text
          as pages,
        settled_sequence::text,
        pending_kind
      from fx_system_declarative_v2_verifier_attempt
    `);
    expect(afterRollback.rows).toEqual([{
      modules: "0",
      pages: "0",
      settled_sequence: "0",
      pending_kind: "source_page",
    }]);
  });

  it("interrupts pre-transaction hashing without settling or preserving process authority", async () => {
    const current = await fixture();
    const liveSha256 = makeLiveDeclarativeV2Sha256V1();
    let blockHashing = false;
    let markHashStarted!: () => void;
    const hashStarted = new Promise<void>((resolve) => {
      markHashStarted = resolve;
    });
    const neverSettles = new Promise<Uint8Array>(() => {});
    const repository = makeDeclarativeV2VerifierProgressRepositoryV1(
      current.target,
      {
        claimDurationMilliseconds: 60_000,
        randomUuid: () => "22222222-2222-4222-8222-222222222222",
      },
      (input, shaBudget) =>
        blockHashing
          ? Effect.promise(() => {
            markHashStarted();
            return neverSettles;
          })
          : liveSha256(input, shaBudget),
    );
    const acquired = await runEffect(
      repository.acquire(scopeId, current.attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const reserved = await runEffect(repository.reserveCommand(
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x91),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    blockHashing = true;
    const fiber = Effect.runFork(repository.settleCommand(
      reserved.work,
      {
        frames: [],
        nextLifecycle: "parsing",
        nextProgress: progressCursor("parse", 1n, null),
      },
      operationBudget,
    ));
    const completion = runEffect(Fiber.await(fiber));
    await hashStarted;
    await runEffect(Fiber.interrupt(fiber));
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    const row = await current.persistence.query<{
      settled_sequence: string;
      pending_kind: string;
    }>(`
      select settled_sequence::text, pending_kind
      from fx_system_declarative_v2_verifier_attempt
    `);
    expect(row.rows).toEqual([{
      settled_sequence: "0",
      pending_kind: "source_page",
    }]);
    const closed = await runEffectFailure(
      repository.renew(acquired.run, operationBudget),
    );
    expect(closed).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "runClosed",
    });
  });
});

async function fixture(semanticCeiling = 1_000n) {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    {
      kind: "shared_database",
      databaseKey: "primary",
      schemaName: "public",
    },
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED target.");
  }
  const inert = makeDeclarativeV2InertRepositoryV1(target);
  const candidate = candidateFixture();
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2PhysicalFrameV1(candidate, {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    }),
  );
  const inserted = await runEffect(inert.insertCandidate(candidate, {
    maximumCalls: 1,
    maximumFrameBytes: encoded.canonicalBytes.byteLength,
    maximumCanonicalBytes: encoded.usage.canonicalBytes,
    maximumHashBytes: encoded.canonicalBytes.byteLength,
  }));
  const repository = makeDeclarativeV2VerifierProgressRepositoryV1(
    target,
    {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    },
  );
  const created = await runEffect(repository.createAttempt({
    scopeId,
    candidateSha256: inserted.candidateSha256,
    ceilings: semanticBudget("attempt_ceilings", semanticCeiling),
  }, operationBudget));
  return {
    persistence,
    target,
    repository,
    attemptSha256: created.attemptSha256,
  };
}

async function reserveAndSettleEmpty(
  repository: ReturnType<typeof makeDeclarativeV2VerifierProgressRepositoryV1>,
  run: Parameters<
    ReturnType<
      typeof makeDeclarativeV2VerifierProgressRepositoryV1
    >["reserveCommand"]
  >[0],
  input: Readonly<{
    readonly commandKind:
      | "source_page"
      | "parse_module"
      | "link_page"
      | "registration_page";
    readonly sequence: bigint;
    readonly previousReceiptSha256: Uint8Array | null;
    readonly inputByte: number;
    readonly nextLifecycle:
      | "open"
      | "parsing"
      | "parse_complete"
      | "linking"
      | "link_complete"
      | "registering";
    readonly nextPhase: "source" | "parse" | "link" | "registration" | "verdict";
  }>,
) {
  const reserved = await runEffect(repository.reserveCommand(
    run,
    {
      commandKind: input.commandKind,
      sequence: input.sequence,
      previousReceiptSha256: input.previousReceiptSha256,
      commandBudget: semanticBudget("command_budget", 1n),
      inputSha256: digest(input.inputByte),
    },
    operationBudget,
  ));
  if (reserved.kind === "settledReplay") throw new Error("Expected work.");
  const settled = await runEffect(repository.settleCommand(
    reserved.work,
    {
      frames: [],
      nextLifecycle: input.nextLifecycle,
      nextProgress: progressCursor(
        input.nextPhase,
        input.sequence,
        input.previousReceiptSha256,
      ),
    },
    operationBudget,
  ));
  return settled.receipt;
}

function progressCursor(
  phase: "source" | "parse" | "link" | "registration" | "verdict",
  settledSequence: bigint,
  previousReceiptSha256: Uint8Array | null,
) {
  return {
    kind: "progress_cursor",
    phase,
    settledSequence,
    moduleOrdinal: 0n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256,
  } as const;
}

async function frameDigest(
  frame: DeclarativeV2PhysicalFrameV1,
): Promise<Uint8Array> {
  const encoded = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(frame, {
    maximumFrameBytes: 1_000_000,
    maximumCanonicalBytes: 1_000_000,
  }));
  return new Uint8Array(await webcrypto.subtle.digest(
    "SHA-256",
    new Uint8Array(encoded.canonicalBytes),
  ));
}

function semanticBudget(
  kind: DeclarativeV2BudgetFrameV1["kind"],
  value: bigint,
): DeclarativeV2BudgetFrameV1 {
  return {
    kind,
    calls: value,
    sourceBytes: value,
    modules: value,
    importEdges: value,
    tokens: value,
    tokenBytes: value,
    nestingDepth: value,
    functions: value,
    schemaNodes: value,
    validatorNodes: value,
    graphNodes: value,
    frontierEntries: value,
    canonicalBytes: value,
    frameBytes: value,
    hashBytes: value,
    diagnosticBytes: value,
    outputBytes: value,
    elapsedMilliseconds: value,
  };
}

function candidateFixture(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
    scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: epoch,
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    readinessPolicyIdentity: "readiness-v1",
  };
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
