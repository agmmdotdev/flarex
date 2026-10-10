import { fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { webcrypto } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import {
  claimApplicationExecutableActiveSelection,
  isApplicationBindingPreparation,
  readApplicationBindingTargetProtection,
} from "../../../src/application/activation/selectionIdentity";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  prepareApplicationBindingSelection,
  prepareRetainedApplicationBindingSelection,
  prepareFiniteActiveApplication,
} from "../../../src/application/activation/repositoryIdentity";
import {
  readApplicationBindingPreparationInputs,
} from "../../../src/application/activation/bindingPreparation";
import {
  validateApplicationBindingBasisInTransaction,
} from "../../../src/application/activation/bindingAcceptance";
import {
  type ApplicationBindingInput,
} from "../../../src/application/activation/contracts";
import { createPGlitePersistence } from "../../../src/database/pglite";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  beginPhysicalDefinitionDrainingEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../../../src/installation/physicalDefinitionLifecycle";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { runEffect } from "../../support/effectTestRuntime";
import {
  makePreparedHostRuntime,
  retainPreparedHost,
} from "../../../src/execution/preparation/preparedHostRuntime";
import { lockScopeClockForShareInTransactionEffect } from "../../../src/scope/scopeClock";
import {
  fxSystemIndexBuildStates,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
} from "../../../src/database/schema";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities, enablePhysicalBuilds } from "../support/readinessPreparation";
import { createAdditionalApplicationRevision } from "../support/readinessPublication";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application activation/bindingPreparation", { timeout: 30_000 }, () => {
  it("captures standalone binding evidence once outside hashing and refreshes the current head per request", async () => {
    let targetOpen = false;
    const capturedSql: string[] = [];
    const db = newTestPGlite();
    const targetPersistence = await createPGlitePersistence({ db: {
      exec: db.exec.bind(db), query: db.query.bind(db),
      transaction: run => db.transaction(tx => run({ exec: tx.exec.bind(tx),
        query: new Proxy(tx.query, { apply(query, _receiver, args: unknown[]) {
          if (targetOpen && typeof args[0] === "string") capturedSql.push(args[0]);
          return Reflect.apply(query, tx, args);
        } }),
      })),
    } });
    const fixture = await readinessFixture({ targetPersistence });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    const initial = await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    let captures = 0;
    const originalTransaction = fixture.target.drizzle.transaction.bind(fixture.target.drizzle);
    const transaction = vi.spyOn(fixture.target.drizzle, "transaction").mockImplementation(async (work, config) => {
      captures++;
      return originalTransaction(async tx => {
        targetOpen = true;
        try { return await work(tx); } finally { targetOpen = false; }
      }, config);
    });
    const originalHash = crypto.subtle.digest.bind(crypto.subtle);
    const hashBoundaries: boolean[] = [];
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
      hashBoundaries.push(targetOpen);
      return originalHash(algorithm, data);
    });
    const first = await (async () => {
      try { return await runEffect(prepareApplicationBindingSelection(activation)); }
      finally { digest.mockRestore(); transaction.mockRestore(); }
    })();
    expect(captures).toBe(1);
    const clocks = capturedSql.filter(query => query.includes('from "fx_system_scope_clock"') && query.includes("for key share"));
    expect(clocks).toEqual([expect.stringContaining("for key share")]);
    expect(clocks[0]).toContain("for key share");
    const clockIndex = capturedSql.findIndex(query => query.includes('from "fx_system_scope_clock"'));
    const headIndex = capturedSql.findIndex(query => query.includes('from "fx_system_application_active_head"'));
    expect(clockIndex).toBeGreaterThanOrEqual(0);
    expect(headIndex).toBeGreaterThan(clockIndex);
    expect(hashBoundaries.length).toBeGreaterThan(0);
    expect(hashBoundaries.every(open => !open)).toBe(true);
    expect(Result.isFailure(claimApplicationExecutableActiveSelection(first))).toBe(true);
    expect(isApplicationBindingPreparation(first)).toBe(false);
    await expect(runEffect(readApplicationBindingPreparationInputs(first, fixture.control.drizzle)))
      .rejects.toMatchObject({ reason: "invalidComposition" });
    const accept = (token: ApplicationBindingInput) => fixture.target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.input.scopeId);
      return yield* validateApplicationBindingBasisInTransaction(token, tx, clock);
    })));
    expect((await accept(first)).basis.revisionId).toBe(fixture.input.revisionId);
    const clone = Object.freeze({ ...first });
    expect(Result.isFailure(readApplicationBindingTargetProtection(clone))).toBe(true);
    await expect(accept(clone)).rejects.toMatchObject({ reason: "invalidComposition" });
    const nextRevisionId = await createAdditionalApplicationRevision(fixture);
    expect(await runEffect(fixture.repository.settle({ ...fixture.input, revisionId: nextRevisionId })))
      .toMatchObject({ status: "ready" });
    await runEffect(activation.activate({ revisionId: nextRevisionId, expectedActiveHead: initial.expectedActiveHead }));
    await expect(accept(first)).rejects.toMatchObject({ reason: "concurrentHead" });
    const refreshed = await runEffect(prepareApplicationBindingSelection(activation));
    expect((await accept(refreshed)).basis.revisionId).toBe(nextRevisionId);
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({ entryBytes: new Uint8Array([1]) })
      .where(eq(fxSystemApplicationFunctionsV1.revisionId, nextRevisionId));
    await expect(accept(refreshed)).rejects.toMatchObject({ reason: "storedState" });
  })

  it.each(["missing", "malformed", "foreign"] as const)("refuses %s capture clocks with no active head before issuing either preparation profile", async mode => {
    let capturing = false;
    const db = newTestPGlite();
    const targetPersistence = await createPGlitePersistence({ db: {
      exec: db.exec.bind(db), query: db.query.bind(db),
      transaction: run => db.transaction(tx => run({ exec: tx.exec.bind(tx),
        query: new Proxy(tx.query, { async apply(query, _receiver, args: unknown[]) {
          const result: unknown = await Reflect.apply(query, tx, args);
          // Preserve the real query and driver boundary. Represent an unavailable
          // live clock without deleting the FK-protected fixture authority graph.
          if (capturing && mode === "missing" && typeof args[0] === "string" &&
            args[0].includes('from "fx_system_scope_clock"') && args[0].includes("for key share") &&
            typeof result === "object" && result !== null) return { ...result, rows: [] };
          return result;
        } }),
      })),
    } });
    const fixture = await readinessFixture({ targetPersistence });
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    const actualTransaction = fixture.target.drizzle.transaction.bind(fixture.target.drizzle);
    const transaction = vi.spyOn(fixture.target.drizzle, "transaction").mockImplementation((work, config) =>
      actualTransaction(async tx => {
        // Placement has resolved. Change the actual transaction's live clock
        // while the absent head supplies the deliberate second fault.
        capturing = true;
        if (mode === "malformed") {
          await tx.update(fxSystemScopeExecutionAuthorities).set({ oldestAvailableCommitSeq: CommitSeqSchema.make(1n) })
            .where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.input.scopeId));
        } else if (mode === "foreign") await tx.update(fxSystemScopeExecutionAuthorities).set({ storageGenerationFence: sql`${fxSystemScopeExecutionAuthorities.storageGenerationFence} + 1` })
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, fixture.input.scopeId));
        try { return await work(tx); } finally { capturing = false; }
      }, config));
    try {
      const expected = mode === "missing" ? { _tag: "ScopeClockNotFoundError" }
        : mode === "malformed" ? { _tag: "ScopeClockCorruptionError" }
        : { _tag: "ApplicationActivationError", operation: "read", reason: "activeMissing" };
      expect(await runEffect(Effect.result(prepareApplicationBindingSelection(activation)))).toMatchObject({ _tag: "Failure", failure: expected });
      await expect(runEffect(prepareFiniteActiveApplication(activation))).rejects.toMatchObject(expected);
    } finally { transaction.mockRestore(); }
  })

  it("keeps standalone tokens request-owned under ambient host construction and rejects a closed retained issuer", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const requests = await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1 });
      const host = yield* retainPreparedHost(runtime, Effect.gen(function* () {
        const tokens: ApplicationBindingInput[] = [];
        for (let index = 0; index < 8; index++) {
          const token = yield* prepareApplicationBindingSelection(activation);
          const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(token));
          expect(lineage.lifetime).toBeUndefined();
          tokens.push(token);
        }
        return Object.freeze({ tokens });
      }));
      return yield* host.use(value => Effect.succeed(value.tokens));
    })));
    for (const token of requests) {
      expect(Result.isSuccess(readApplicationBindingTargetProtection(token))).toBe(true);
      expect(Result.isFailure(claimApplicationExecutableActiveSelection(token))).toBe(true);
    }
    const accept = (token: ApplicationBindingInput) => fixture.target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.input.scopeId);
      return yield* validateApplicationBindingBasisInTransaction(token, tx, clock);
    })));
    for (const token of requests) expect((await accept(token)).basis.revisionId).toBe(fixture.input.revisionId);
    const request = requests[0];
    if (request === undefined) throw new Error("Expected request binding");
    const clone = Object.freeze({ ...request });
    expect(Result.isFailure(readApplicationBindingTargetProtection(clone))).toBe(true);
    await expect(accept(clone)).rejects.toMatchObject({ reason: "invalidComposition" });
    const retained = await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
      const host = yield* retainPreparedHost(runtime, Effect.gen(function* () {
        const active = yield* activation.readActive();
        const binding = yield* prepareRetainedApplicationBindingSelection(activation);
        return Object.freeze({ active, binding });
      }));
      return yield* host.use(value => Effect.gen(function* () {
        const lineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(value.active.selection));
        expect(lineage.lifetime).toBeDefined();
        const bindingLineage = yield* Effect.fromResult(readApplicationBindingTargetProtection(value.binding));
        expect(bindingLineage.lifetime).toBeDefined();
        return Object.freeze({ selection: value.active.selection, binding: value.binding });
      }));
    })));
    expect(Result.isFailure(readApplicationBindingTargetProtection(retained.selection))).toBe(true);
    expect(Result.isFailure(readApplicationBindingTargetProtection(retained.binding))).toBe(true);
    await expect(accept(retained.selection)).rejects.toMatchObject({ reason: "invalidComposition" });
    await expect(accept(retained.binding)).rejects.toMatchObject({ reason: "invalidComposition" });
    // Surviving request evidence is not a cached positive business verdict.
    await fixture.target.drizzle.delete(fxSystemApplicationActiveHeads)
      .where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.input.scopeId));
    await expect(accept(request)).rejects.toMatchObject({ reason: "concurrentHead" });
  })

  it("preserves standalone canonical refusal order ahead of absent durable readiness", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const candidate = (await fixture.target.drizzle.select().from(fxSystemApplicationCandidatesV1))[0];
    if (candidate === undefined) throw new Error("Expected candidate");
    // Deliberate unprotected corruption keeps the issued head while removing
    // its durable readiness; normal FK-protected deletion cannot create it.
    await fixture.target.query("alter table fx_system_application_activation drop constraint fx_application_activation_legacy_readiness_fk");
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessFunctionsV1);
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessV1);
    await fixture.target.drizzle.update(fxSystemApplicationCandidatesV1).set({ storageGenerationFence: candidate.storageGenerationFence + 1n });
    await expect(runEffect(prepareApplicationBindingSelection(activation)))
      .rejects.toMatchObject({ operation: "readReady", reason: "authorityChanged" });
    await fixture.target.drizzle.update(fxSystemApplicationCandidatesV1).set({ storageGenerationFence: candidate.storageGenerationFence });
    await expect(runEffect(prepareApplicationBindingSelection(activation)))
      .rejects.toMatchObject({ operation: "readReady", reason: "storedState" });
  })

  it.each(["missing", "not-enabled", "draining"] as const)("accepts no business work when standalone physical readiness is %s", async mode => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" }, deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId, readiness: fixture.repository, authority: fixture.authorityPorts });
    await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const prior = await runEffect(prepareApplicationBindingSelection(activation));
    if (mode === "missing") {
      // A disposable privileged fixture withdraws the binding before removal;
      // ordinary maintained deletion is separately refused by the native guard.
      await fixture.target.drizzle.update(fxSystemIndexBuildStates).set({ maintenanceActivationSequence: null });
      await fixture.target.drizzle.delete(fxSystemIndexBuildStates);
    }
    else if (mode === "not-enabled") await fixture.target.drizzle.update(fxSystemIndexBuildStates).set({ lifecycle: "validating",
      maintenanceActivationSequence: null, });
    else {
      const requirements = await runEffect(loadPublishedPhysicalRequirementSnapshotV1(fixture.control.drizzle,
        { deploymentId: fixture.input.deploymentId, schemaVersionId }));
      const definition = requirements?.definitions[0];
      if (definition === undefined) throw new Error("Missing physical definition");
      const subject = await runEffect(preparePhysicalDefinitionLifecycleSubjectEffect(fixture.physicalDefinitionLifecycle,
        { definitionKind: "index", deploymentId: fixture.input.deploymentId, scopeId: fixture.input.scopeId,
          indexDefinitionId: definition.indexDefinitionId }));
      await runEffect(beginPhysicalDefinitionDrainingEffect(subject, { expectedTransitionFence: 0n }));
    }
    await expect(runEffect(activation.readActive())).rejects.toMatchObject({ operation: "read", reason: "notReady" });
    // Construction is inert. Existing full physical proof belongs to the fresh
    // accepting frontier, including an invalidation after an earlier capture.
    const current = await runEffect(prepareApplicationBindingSelection(activation));
    let entered = 0;
    const accept = (token: ApplicationBindingInput) => fixture.target.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.input.scopeId);
      yield* validateApplicationBindingBasisInTransaction(token, tx, clock);
      entered++;
    })));
    for (const token of [prior, current]) await expect(accept(token)).rejects.toMatchObject({ reason: "authorityChanged" });
    expect(entered).toBe(0);
    // The selected detached frontier wins this double fault before the later
    // physical proof; executable readActive retains its original frontier.
    await fixture.target.query("alter table fx_system_application_activation drop constraint fx_application_activation_legacy_readiness_fk");
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessFunctionsV1);
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessV1);
    await expect(runEffect(prepareApplicationBindingSelection(activation)))
      .rejects.toMatchObject({ operation: "readReady", reason: "storedState" });
    await expect(runEffect(activation.readActive())).rejects.toMatchObject({ operation: "read", reason: "notReady" });
  })
});
