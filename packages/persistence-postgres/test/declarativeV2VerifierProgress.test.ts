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
  decodeDeclarativeV2PhysicalFrameV1,
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2AttemptIdentityFrameV1,
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
  type DeclarativeV2Sha256V1,
} from "../src/declarativeV2Sha256";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
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
        frames: [],
        objectReferences: [{
          kind: "inert_object_reference",
          namespace: "source",
          objectKind: "block",
          firstItemOrdinal: 0n,
          itemCount: 1n,
          bodyByteLength: 4n,
          objectSha256: digest(0x31),
        }],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
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
        objectReferences: [],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
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
      progress: { phase: "parse", moduleOrdinal: 0n },
    });

    const counts = await persistence.query<{
      modules: string;
      pages: string;
      projections: string;
      verdicts: string;
      revisions: string;
      heads: string;
    }>(`
      select
        (select count(*) from fx_system_declarative_v2_module_summary)::text
          as modules,
        (select count(*) from fx_system_declarative_v2_page_manifest)::text
          as pages,
        (select count(*) from fx_system_declarative_v2_candidate_projection)::text
          as projections,
        (select count(*) from fx_system_declarative_v2_verdict)::text
          as verdicts,
        (select count(*) from fx_system_declarative_v2_activation_revision)::text
          as revisions,
        (select count(*) from fx_system_declarative_v2_activation_head)::text
          as heads
    `);
    expect(counts.rows).toEqual([{
      modules: "0",
      pages: "1",
      projections: "0",
      verdicts: "0",
      revisions: "0",
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

  it("captures and budgets settlement evidence before any transaction", async () => {
    let transactionCount = 0;
    const current = await fixture(1_000n, () => {
      transactionCount += 1;
    });
    const acquired = await runEffect(
      current.repository.acquire(
        scopeId,
        current.attemptSha256,
        operationBudget,
      ),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const reserved = await runEffect(current.repository.reserveCommand(
      acquired.run,
      {
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x34),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");
    const beforeSettlement = transactionCount;

    const malformed = await runEffectFailure(
      current.repository.settleCommand(
        reserved.work,
        { frames: [] },
        operationBudget,
      ),
    );
    expect(malformed).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "invalidInput",
    });
    expect(transactionCount).toBe(beforeSettlement);

    const overBudget = await runEffectFailure(
      current.repository.settleCommand(
        reserved.work,
        validSettlementBatch({
          attemptSha256: current.attemptSha256,
          commandKind: "source_page",
          sequence: 1n,
          previousReceiptSha256: null,
          inputByte: 0x34,
          nextLifecycle: "parsing",
          nextPhase: "parse",
        }),
        { ...operationBudget, maximumRows: 1 },
      ),
    );
    expect(overBudget).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "budgetExceeded",
      dimension: "rows",
    });
    expect(transactionCount).toBe(beforeSettlement);
  });

  it("owns the complete settlement batch before the first asynchronous hash", async () => {
    const liveSha256 = makeLiveDeclarativeV2Sha256V1();
    let armed = false;
    let blocked = false;
    let enterHash!: () => void;
    let releaseHash!: () => void;
    const enteredHash = new Promise<void>(resolve => {
      enterHash = resolve;
    });
    const releasedHash = new Promise<void>(resolve => {
      releaseHash = resolve;
    });
    const blockingSha256: DeclarativeV2Sha256V1 = Effect.fn(
      "Test.blockingDeclarativeV2Sha256",
    )(function* (input: unknown, budget: unknown) {
      if (armed && !blocked) {
        blocked = true;
        enterHash();
        yield* Effect.promise(() => releasedHash);
      }
      return yield* liveSha256(input, budget);
    });
    const current = await fixture(1_000n, undefined, blockingSha256);
    const acquired = await runEffect(
      current.repository.acquire(
        scopeId,
        current.attemptSha256,
        operationBudget,
      ),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const sourceReceipt = await reserveAndSettleEmpty(
      current.repository,
      acquired.run,
      {
        attemptSha256: current.attemptSha256,
        commandKind: "source_page",
        sequence: 1n,
        previousReceiptSha256: null,
        inputByte: 0x35,
        nextLifecycle: "parsing",
        nextPhase: "parse",
      },
    );
    const sourceReceiptSha256 = await frameDigest(sourceReceipt);
    const reserved = await runEffect(current.repository.reserveCommand(
      acquired.run,
      {
        commandKind: "parse_module",
        sequence: 2n,
        previousReceiptSha256: sourceReceiptSha256,
        commandBudget: semanticBudget("command_budget", 1n),
        inputSha256: digest(0x36),
      },
      operationBudget,
    ));
    if (reserved.kind === "settledReplay") throw new Error("Expected work.");

    const moduleFrame = {
      kind: "module_summary",
      attemptSha256: current.attemptSha256,
      moduleOrdinal: 0n,
      modulePath: "src/original.mjs",
      moduleSha256: digest(0x37),
      sourceMapSha256: null,
      importCount: 1n,
      declaredFunctionCount: 1n,
    } as const;
    const edgeFrame = {
      kind: "import_edge",
      attemptSha256: current.attemptSha256,
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      specifier: "./dependency.mjs",
      importKind: "named",
      importedName: "dependency",
      localName: "dependency",
      targetModulePath: "src/dependency.mjs",
    } as const;
    const frames: Array<Record<string, unknown>> = [
      { ...moduleFrame },
      { ...edgeFrame },
    ];
    const nextProgress: Record<string, unknown> = {
      kind: "progress_cursor",
      phase: "link",
      settledSequence: 2n,
      moduleOrdinal: 1n,
      edgeOrdinal: 1n,
      pageOrdinal: 2n,
      previousReceiptSha256: sourceReceiptSha256,
    };
    armed = true;
    const settleFiber = Effect.runFork(current.repository.settleCommand(
      reserved.work,
      {
        frames,
        objectReferences: [],
        disposition: "completion",
        nextLifecycle: "parse_complete",
        nextProgress,
      },
      operationBudget,
    ));
    await enteredHash;
    frames[0]!.modulePath = "src/mutated.mjs";
    frames[1]!.edgeOrdinal = 99n;
    frames.push({ kind: "diagnostic" });
    nextProgress.phase = "verdict";
    releaseHash();
    await Effect.runPromise(Fiber.join(settleFiber));

    const stored = await current.persistence.query<{
      frame_bytes: Uint8Array;
      edge_ordinal: string;
      diagnostics: string;
    }>(`
      select
        module.frame_bytes,
        edge.edge_ordinal::text as edge_ordinal,
        (
          select count(*)::text
          from fx_system_declarative_v2_diagnostic
        ) as diagnostics
      from fx_system_declarative_v2_module_summary module
      join fx_system_declarative_v2_import_edge edge
        on edge.scope_id = module.scope_id
        and edge.attempt_sha256 = module.attempt_sha256
        and edge.module_ordinal = module.module_ordinal
    `);
    expect(stored.rows).toHaveLength(1);
    const storedModule = Result.getOrThrow(
      decodeDeclarativeV2PhysicalFrameV1(
        stored.rows[0]!.frame_bytes,
        {
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
        },
      ),
    );
    expect(storedModule.frame).toMatchObject({
      kind: "module_summary",
      modulePath: "src/original.mjs",
    });
    expect(stored.rows[0]).toMatchObject({
      edge_ordinal: "0",
      diagnostics: "0",
    });
  }, 60_000);

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
        objectReferences: [{
          kind: "inert_object_reference",
          namespace: "source",
          objectKind: "block",
          firstItemOrdinal: 0n,
          itemCount: 1n,
          bodyByteLength: 1n,
          objectSha256: digest(0x21),
        }],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          ...progressCursor("parse", 1n, null),
          pageOrdinal: 1n,
        },
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
        objectReferences: [],
        disposition: "completion",
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
        attemptSha256,
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
        attemptSha256,
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
        objectReferences: [],
        disposition: "continuation",
        nextLifecycle: "linking",
        nextProgress: {
          ...progressCursor("link", 3n, receipt2Sha256),
          moduleOrdinal: 1n,
          pageOrdinal: 3n,
        },
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
    const objectReference = {
      kind: "inert_object_reference",
      namespace: "source",
      objectKind: "block",
      firstItemOrdinal: 0n,
      itemCount: 1n,
      bodyByteLength: 1n,
      objectSha256: digest(0xad),
    } as const;
    const failure = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [],
        objectReferences: [objectReference, objectReference],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
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
        attemptSha256,
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

  it("fails pre-C1 verifier-progress identities closed without reinterpretation", async () => {
    const { persistence, repository } = await fixture();
    const stored = await persistence.query<{ identity_bytes: Uint8Array }>(`
      select identity_bytes
      from fx_system_declarative_v2_verifier_attempt
      where scope_id = '${scopeId}'
    `);
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2PhysicalFrameV1(
        stored.rows[0]!.identity_bytes,
        {
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
        },
      ),
    );
    if (decoded.frame.kind !== "attempt_identity") {
      throw new Error("Expected attempt identity.");
    }
    const legacy: DeclarativeV2AttemptIdentityFrameV1 = {
      ...decoded.frame,
      verifierProgressProtocolIdentity:
        "flarex.declarative-v2/verifier-progress/v1",
    };
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(legacy, {
        maximumFrameBytes: 1_000_000,
        maximumCanonicalBytes: 1_000_000,
      }),
    );
    const sha256 = new Uint8Array(await webcrypto.subtle.digest(
      "SHA-256",
      encoded.canonicalBytes.slice().buffer,
    ));
    await persistence.query(`
      update fx_system_declarative_v2_verifier_attempt
      set
        attempt_sha256 = '\\x${hex(sha256)}'::bytea,
        identity_byte_length = ${encoded.canonicalBytes.byteLength},
        identity_sha256 = '\\x${hex(sha256)}'::bytea,
        identity_bytes = '\\x${hex(encoded.canonicalBytes)}'::bytea
      where scope_id = '${scopeId}'
    `);
    const failure = await runEffectFailure(
      repository.observeAttempt(scopeId, sha256, operationBudget),
    );
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressCorruptionV1Error",
      operation: "observeAttempt",
      reason: "unsupportedProtocol",
    });
  }, 60_000);

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
        attemptSha256,
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
        attemptSha256,
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
        objectReferences: [],
        disposition: "continuation",
        nextLifecycle: "linking",
        nextProgress: {
          ...progressCursor("link", 3n, receipt2Sha256),
          moduleOrdinal: 1n,
          pageOrdinal: 3n,
        },
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
        objectReferences: [],
        disposition: "continuation",
        nextLifecycle: "linking",
        nextProgress: {
          ...progressCursor("link", 4n, receipt3Sha256),
          moduleOrdinal: 1n,
          pageOrdinal: 4n,
        },
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
  }, 20_000);

  it("observes bounded settled phase tails in fixed phase order", async () => {
    const { repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    const source = await reserveAndSettleEmpty(repository, acquired.run, {
      attemptSha256,
      commandKind: "source_page",
      sequence: 1n,
      previousReceiptSha256: null,
      inputByte: 0xc1,
      nextLifecycle: "parsing",
      nextPhase: "parse",
    });
    const sourceSha256 = await frameDigest(source);
    const parsed = await reserveAndSettleEmpty(repository, acquired.run, {
      attemptSha256,
      commandKind: "parse_module",
      sequence: 2n,
      previousReceiptSha256: sourceSha256,
      inputByte: 0xc2,
      nextLifecycle: "parse_complete",
      nextPhase: "link",
    });
    const parsedSha256 = await frameDigest(parsed);
    const linked = await reserveAndSettleEmpty(repository, acquired.run, {
      attemptSha256,
      commandKind: "link_page",
      sequence: 3n,
      previousReceiptSha256: parsedSha256,
      inputByte: 0xc3,
      nextLifecycle: "link_complete",
      nextPhase: "registration",
    });
    const linkedSha256 = await frameDigest(linked);
    await reserveAndSettleEmpty(repository, acquired.run, {
      attemptSha256,
      commandKind: "registration_page",
      sequence: 4n,
      previousReceiptSha256: linkedSha256,
      inputByte: 0xc4,
      nextLifecycle: "registering",
      nextPhase: "verdict",
    });

    const observed = await runEffect(
      repository.observeSettledPhaseTails(acquired.run, operationBudget),
    );
    expect(observed.tails.attempt).toMatchObject({
      lifecycle: "registering",
      settledSequence: 4n,
      progress: {
        phase: "verdict",
        pageOrdinal: 4n,
      },
    });
    expect(observed.tails.phases.map(({ phase, page }) => ({
      phase,
      pageOrdinal: page?.pageOrdinal ?? null,
    }))).toEqual([
      { phase: "source", pageOrdinal: 0n },
      { phase: "parse", pageOrdinal: 0n },
      { phase: "link", pageOrdinal: 0n },
      { phase: "registration", pageOrdinal: 0n },
    ]);
    for (const tail of observed.tails.phases) {
      expect(tail.pageSha256).toBeInstanceOf(Uint8Array);
      expect(tail.pageSha256).toHaveLength(32);
    }
    expect(observed.tails).toMatchObject({
      lastRegistrationOrdinal: null,
      lastDiagnosticOrdinal: null,
    });
    const ownedDigest = observed.tails.phases[0]!.pageSha256!;
    ownedDigest.fill(0xff);
    const reread = await runEffect(
      repository.observeSettledPhaseTails(acquired.run, operationBudget),
    );
    expect(reread.tails.phases[0]!.pageSha256).not.toEqual(ownedDigest);

    const exactBudget = {
      maximumCalls: observed.operationUsage.calls,
      maximumRows: observed.operationUsage.rows,
      maximumFrameBytes: observed.operationUsage.frameBytes,
      maximumCanonicalBytes: observed.operationUsage.canonicalBytes,
      maximumHashBytes: observed.operationUsage.hashBytes,
      maximumElapsedMilliseconds: 60_000,
    };
    await expect(runEffect(
      repository.observeSettledPhaseTails(acquired.run, exactBudget),
    )).resolves.toBeDefined();
    const oneLess = await runEffectFailure(
      repository.observeSettledPhaseTails(acquired.run, {
        ...exactBudget,
        maximumFrameBytes: exactBudget.maximumFrameBytes - 1,
      }),
    );
    expect(oneLess).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      operation: "observeSettledPhaseTails",
      reason: "budgetExceeded",
      dimension: "frameBytes",
    });
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const root = await import("../src/index");
    expect(packageJson.default.exports).not.toHaveProperty(
      "./declarative-v2-verifier-progress",
    );
    expect(root).not.toHaveProperty(
      "makeDeclarativeV2VerifierProgressRepositoryV1",
    );
  }, 60_000);

  it("rejects canonical settled tails bound to a foreign attempt", async () => {
    const { persistence, repository, attemptSha256 } = await fixture();
    const acquired = await runEffect(
      repository.acquire(scopeId, attemptSha256, operationBudget),
    );
    if (acquired.kind !== "acquired") throw new Error("Expected acquire.");
    await reserveAndSettleEmpty(repository, acquired.run, {
      attemptSha256,
      commandKind: "source_page",
      sequence: 1n,
      previousReceiptSha256: null,
      inputByte: 0xd1,
      nextLifecycle: "parsing",
      nextPhase: "parse",
    });
    const originalPage = await persistence.query<{
      frame_bytes: Uint8Array;
      frame_sha256: Uint8Array;
    }>(`
      select frame_bytes, frame_sha256
      from fx_system_declarative_v2_page_manifest
      where phase = 'source' and page_ordinal = 0
    `);
    const decodedPage = Result.getOrThrow(
      decodeDeclarativeV2PhysicalFrameV1(
        originalPage.rows[0]!.frame_bytes,
        {
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
        },
      ),
    );
    if (decodedPage.frame.kind !== "phase_page_manifest") {
      throw new Error("Expected page manifest.");
    }
    const foreignAttemptSha256 = digest(0xee);
    const foreignPage = await storedFrame({
      ...decodedPage.frame,
      attemptSha256: foreignAttemptSha256,
    });
    await persistence.query(`
      update fx_system_declarative_v2_page_manifest
      set
        frame_byte_length = ${foreignPage.bytes.byteLength},
        frame_sha256 = '\\x${hex(foreignPage.sha256)}'::bytea,
        frame_bytes = '\\x${hex(foreignPage.bytes)}'::bytea
      where phase = 'source' and page_ordinal = 0
    `);
    await expectForeignTailCorruption(repository, acquired.run);
    await persistence.query(`
      update fx_system_declarative_v2_page_manifest
      set
        frame_byte_length = ${originalPage.rows[0]!.frame_bytes.byteLength},
        frame_sha256 =
          '\\x${hex(originalPage.rows[0]!.frame_sha256)}'::bytea,
        frame_bytes = '\\x${hex(originalPage.rows[0]!.frame_bytes)}'::bytea
      where phase = 'source' and page_ordinal = 0
    `);

    const foreignRegistration = await storedFrame({
      kind: "registration",
      attemptSha256: foreignAttemptSha256,
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(0xa1),
      moduleOrdinal: 0n,
      exportName: "handler",
      functionPath: "module:handler",
      handlerKind: "query",
      visibility: "public",
    });
    await persistence.query(`
      insert into fx_system_declarative_v2_registration (
        scope_id,
        attempt_sha256,
        registration_ordinal,
        handler_identity_sha256,
        frame_codec_version,
        frame_byte_length,
        frame_sha256,
        frame_bytes
      ) values (
        '${scopeId}',
        '\\x${hex(attemptSha256)}'::bytea,
        0,
        '\\x${hex(digest(0xa1))}'::bytea,
        ${DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1},
        ${foreignRegistration.bytes.byteLength},
        '\\x${hex(foreignRegistration.sha256)}'::bytea,
        '\\x${hex(foreignRegistration.bytes)}'::bytea
      )
    `);
    await expectForeignTailCorruption(repository, acquired.run);
    const currentRegistration = await storedFrame({
      kind: "registration",
      attemptSha256,
      registrationOrdinal: 0n,
      handlerIdentitySha256: digest(0xa1),
      moduleOrdinal: 0n,
      exportName: "handler",
      functionPath: "module:handler",
      handlerKind: "query",
      visibility: "public",
    });
    await persistence.query(`
      update fx_system_declarative_v2_registration
      set
        frame_byte_length = ${currentRegistration.bytes.byteLength},
        frame_sha256 = '\\x${hex(currentRegistration.sha256)}'::bytea,
        frame_bytes = '\\x${hex(currentRegistration.bytes)}'::bytea
      where registration_ordinal = 0
    `);

    const foreignDiagnostic = await storedFrame({
      kind: "diagnostic",
      attemptSha256: foreignAttemptSha256,
      diagnosticOrdinal: 0n,
      severity: "warning",
      code: "foreign-attempt",
      path: null,
      message: "foreign attempt evidence",
    });
    await persistence.query(`
      insert into fx_system_declarative_v2_diagnostic (
        scope_id,
        attempt_sha256,
        diagnostic_ordinal,
        frame_codec_version,
        frame_byte_length,
        frame_sha256,
        frame_bytes
      ) values (
        '${scopeId}',
        '\\x${hex(attemptSha256)}'::bytea,
        0,
        ${DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1},
        ${foreignDiagnostic.bytes.byteLength},
        '\\x${hex(foreignDiagnostic.sha256)}'::bytea,
        '\\x${hex(foreignDiagnostic.bytes)}'::bytea
      )
    `);
    await expectForeignTailCorruption(repository, acquired.run);
  }, 60_000);

  it("rejects caller manifests and rolls back a generated page after an injected failure", async () => {
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
    const callerRoot = await runEffectFailure(repository.settleCommand(
      reserved.work,
      {
        frames: [],
        objectReferences: [{
          kind: "inert_object_reference",
          namespace: "source",
          objectKind: "block",
          firstItemOrdinal: 0n,
          itemCount: 1n,
          bodyByteLength: 1n,
          objectSha256: digest(0x53),
        }],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
          previousReceiptSha256: null,
        },
        pageRootSha256: digest(0x54),
      },
      operationBudget,
    ));
    expect(callerRoot).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "invalidInput",
    });
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
        objectReferences: [],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
          edgeOrdinal: 0n,
          pageOrdinal: 1n,
          previousReceiptSha256: null,
        },
      },
      operationBudget,
    ));
    expect(gap).toMatchObject({
      _tag: "DeclarativeV2VerifierProgressInputV1Error",
      reason: "invalidInput",
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
        frames: [],
        objectReferences: [{
          kind: "inert_object_reference",
          namespace: "source",
          objectKind: "block",
          firstItemOrdinal: 0n,
          itemCount: 1n,
          bodyByteLength: 1n,
          objectSha256: digest(0x54),
        }],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          kind: "progress_cursor",
          phase: "parse",
          settledSequence: 1n,
          moduleOrdinal: 0n,
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
        objectReferences: [{
          kind: "inert_object_reference",
          namespace: "source",
          objectKind: "block",
          firstItemOrdinal: 0n,
          itemCount: 1n,
          bodyByteLength: 1n,
          objectSha256: digest(0x91),
        }],
        disposition: "completion",
        nextLifecycle: "parsing",
        nextProgress: {
          ...progressCursor("parse", 1n, null),
          pageOrdinal: 1n,
        },
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

async function fixture(
  semanticCeiling = 1_000n,
  onTransaction?: () => void,
  sha256: DeclarativeV2Sha256V1 = makeLiveDeclarativeV2Sha256V1(),
) {
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
  const locatedTarget: LocatedReadCommittedAttemptTargetV1 =
    onTransaction === undefined
      ? target
      : {
        physicalLocator: target.physicalLocator,
        getCurrentClock: scope => target.getCurrentClock(scope),
        [RUN_LOCATED_READ_COMMITTED_V1]: async work => {
          onTransaction();
          return target[RUN_LOCATED_READ_COMMITTED_V1](work);
        },
      };
  const inert = makeDeclarativeV2InertRepositoryV1(locatedTarget, sha256);
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
    locatedTarget,
    {
      claimDurationMilliseconds: 60_000,
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    },
    sha256,
  );
  const created = await runEffect(repository.createAttempt({
    scopeId,
    candidateSha256: inserted.candidateSha256,
    ceilings: semanticBudget("attempt_ceilings", semanticCeiling),
  }, operationBudget));
  return {
    persistence,
    target: locatedTarget,
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
    readonly attemptSha256: Uint8Array;
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
    validSettlementBatch(input),
    operationBudget,
  ));
  return settled.receipt;
}

function validSettlementBatch(input: Readonly<{
  readonly attemptSha256: Uint8Array;
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
}>) {
  const disposition = input.nextPhase === (
      input.commandKind === "source_page"
        ? "source"
        : input.commandKind === "parse_module"
        ? "parse"
        : input.commandKind === "link_page"
        ? "link"
        : "registration"
    )
    ? "continuation"
    : "completion";
  const frames: DeclarativeV2PhysicalFrameV1[] =
    input.commandKind === "parse_module"
      ? [{
        kind: "module_summary",
        attemptSha256: input.attemptSha256,
        moduleOrdinal: 0n,
        modulePath: "src/main.mjs",
        moduleSha256: digest(input.inputByte),
        sourceMapSha256: null,
        importCount: 0n,
        declaredFunctionCount: 1n,
      }]
      : input.commandKind === "link_page"
      ? [{
        kind: "link_node",
        attemptSha256: input.attemptSha256,
        moduleOrdinal: 0n,
        remainingIndegree: 0n,
        nextEdgeOrdinal: 0n,
        state: "linked",
        rowVersion: 0n,
        previousRowSha256: null,
      }]
      : [];
  const objectReferences = input.commandKind === "source_page"
    ? [{
      kind: "inert_object_reference" as const,
      namespace: "source" as const,
      objectKind: "block" as const,
      firstItemOrdinal: 0n,
      itemCount: 1n,
      bodyByteLength: 1n,
      objectSha256: digest(input.inputByte),
    }]
    : [];
  const moduleOrdinal = input.commandKind === "source_page" ? 0n : 1n;
  return {
    frames,
    objectReferences,
    disposition,
    nextLifecycle: input.nextLifecycle,
    nextProgress: {
      kind: "progress_cursor" as const,
      phase: input.nextPhase,
      settledSequence: input.sequence,
      moduleOrdinal,
      edgeOrdinal: 0n,
      pageOrdinal: input.sequence,
      previousReceiptSha256: input.previousReceiptSha256,
    },
  };
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

async function storedFrame(frame: DeclarativeV2PhysicalFrameV1) {
  const encoded = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(
    frame,
    {
      maximumFrameBytes: 1_000_000,
      maximumCanonicalBytes: 1_000_000,
    },
  ));
  return Object.freeze({
    bytes: new Uint8Array(encoded.canonicalBytes),
    sha256: await frameDigest(frame),
  });
}

async function expectForeignTailCorruption(
  repository: ReturnType<typeof makeDeclarativeV2VerifierProgressRepositoryV1>,
  run: Parameters<
    ReturnType<
      typeof makeDeclarativeV2VerifierProgressRepositoryV1
    >["observeSettledPhaseTails"]
  >[0],
) {
  const failure = await runEffectFailure(
    repository.observeSettledPhaseTails(run, operationBudget),
  );
  expect(failure).toMatchObject({
    _tag: "DeclarativeV2VerifierProgressCorruptionV1Error",
    operation: "observeSettledPhaseTails",
    reason: "normalizedMismatch",
  });
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
