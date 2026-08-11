import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ApplicationAnalysisPersistenceError,
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import { fxSystemApplicationAnalysesV1 } from "../src/schema";
import { runEffect } from "./effectTestRuntime";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "./sessionAuthorityTestSupport";

const ROOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const AUTHORITY: ApplicationAnalysisAuthority = Object.freeze({
  scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
});

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application Analysis persistence generation", () => {
  it("admits one pending authority and replays the request key exactly", async () => {
    const fixture = await repositoryFixture();
    const first = await runEffect(fixture.repository.begin(beginInput()));
    const replay = await runEffect(fixture.repository.begin(beginInput()));

    expect(first).toMatchObject({ status: "pending" });
    expect(replay).toEqual(first);
    expect(fixture.issued()).toBe(2);

    const conflict = await runEffect(Effect.result(fixture.repository.begin({
      ...beginInput(),
      sourceArtifactRootSha256: "c".repeat(64),
    })));
    expect(Result.isFailure(conflict)).toBe(true);
    if (Result.isFailure(conflict)) {
      expect(conflict.failure).toMatchObject({
        _tag: "ApplicationAnalysisPersistenceError",
        reason: "requestKeyReuse",
        retryable: false,
      });
    }
  });

  it("serializes concurrent admission and competing terminal contenders", async () => {
    const fixture = await repositoryFixture();
    const [firstAdmission, secondAdmission] = await Promise.all([
      runEffect(fixture.repository.begin(beginInput())),
      runEffect(fixture.repository.begin(beginInput())),
    ]);
    expect(secondAdmission).toEqual(firstAdmission);
    expect(fixture.issued()).toBe(2);

    const [firstTerminal, secondTerminal] = await Promise.all([
      runEffect(fixture.repository.settle(AUTHORITY, {
        kind: "rejected",
        candidateId: firstAdmission.candidateId,
        sourceArtifactRootSha256: ROOT,
        analyzerIdentity: "analyzer-1",
        analyzerPolicyIdentity: "policy-1",
        failureCode: "invalid_registration",
        detail: "registration is invalid",
      })),
      runEffect(fixture.repository.settle(AUTHORITY, {
        kind: "analyzed",
        candidateId: firstAdmission.candidateId,
        sourceArtifactRootSha256: ROOT,
        analyzerIdentity: "analyzer-1",
        analyzerPolicyIdentity: "policy-1",
        canonicalManifest: manifestText(),
      })),
    ]);
    expect(secondTerminal).toEqual(firstTerminal);
    const revisions = await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_revision_v2",
    );
    expect(revisions.rows).toEqual([{
      count: firstTerminal.status === "analyzed" ? "1" : "0",
    }]);
  });

  it("keeps integration retry pending and replays the first rejected terminal", async () => {
    const fixture = await repositoryFixture();
    const pending = await runEffect(fixture.repository.begin(beginInput()));

    const afterIntegrationFailure = await runEffect(
      fixture.repository.inspect(AUTHORITY, pending.candidateId),
    );
    expect(afterIntegrationFailure).toEqual(pending);

    const rejected = await runEffect(fixture.repository.settle(AUTHORITY, {
      kind: "rejected",
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      failureCode: "invalid_registration",
      detail: "registration is invalid",
    }));
    expect(rejected).toMatchObject({
      status: "rejected",
      receipt: {
        status: "rejected",
        failureCode: "invalid_registration",
      },
    });

    const attemptedReplacement = await runEffect(fixture.repository.settle(
      AUTHORITY,
      {
        kind: "analyzed",
        candidateId: pending.candidateId,
        sourceArtifactRootSha256: ROOT,
        analyzerIdentity: "analyzer-1",
        analyzerPolicyIdentity: "policy-1",
        canonicalManifest: manifestText(),
      },
    ));
    expect(attemptedReplacement).toEqual(rejected);

    const mismatchedReplay = await runEffect(Effect.result(
      fixture.repository.settle(AUTHORITY, {
        kind: "rejected",
        candidateId: pending.candidateId,
        sourceArtifactRootSha256: ROOT,
        analyzerIdentity: "different-analyzer",
        analyzerPolicyIdentity: "policy-1",
        failureCode: "invalid_registration",
        detail: "registration is invalid",
      }),
    ));
    expect(Result.isFailure(mismatchedReplay)).toBe(true);
    if (Result.isFailure(mismatchedReplay)) {
      expect(mismatchedReplay.failure.reason).toBe("terminalMismatch");
    }
    const revisions = await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_revision_v2",
    );
    expect(revisions.rows).toEqual([{ count: "0" }]);
  });

  it("settles an analyzed manifest into one inactive revision and detects corruption", async () => {
    const fixture = await repositoryFixture();
    const pending = await runEffect(fixture.repository.begin(beginInput()));
    const analyzed = await runEffect(fixture.repository.settle(AUTHORITY, {
      kind: "analyzed",
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      canonicalManifest: manifestText(),
    }));

    expect(analyzed).toMatchObject({
      status: "analyzed",
      manifest: { sourceArtifact: { rootSha256: ROOT } },
      receipt: { status: "analyzed" },
      revision: { status: "inactive" },
    });

    const settledReplay = await runEffect(fixture.repository.settle(AUTHORITY, {
      kind: "analyzed",
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      canonicalManifest: manifestText(),
    }));
    expect(settledReplay).toEqual(analyzed);
    expect(fixture.issued()).toBe(3);

    const replay = await runEffect(
      fixture.repository.inspect(AUTHORITY, pending.candidateId),
    );
    expect(replay).toEqual(analyzed);

    await fixture.persistence.drizzle.update(fxSystemApplicationAnalysesV1).set({
      receiptBytes: new TextEncoder().encode("{}"),
    });
    const corrupted = await runEffect(Effect.result(
      fixture.repository.inspect(AUTHORITY, pending.candidateId),
    ));
    expect(Result.isFailure(corrupted)).toBe(true);
    if (Result.isFailure(corrupted)) {
      expect(corrupted.failure).toBeInstanceOf(ApplicationAnalysisPersistenceError);
      expect(corrupted.failure.reason).toBe("storedState");
    }
  });

  it("rolls back settlement when revision identity issuance fails", async () => {
    const fixture = await repositoryFixture({ failUuidOnceAt: 2 });
    const pending = await runEffect(fixture.repository.begin(beginInput()));
    const terminal = {
      kind: "analyzed" as const,
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      canonicalManifest: manifestText(),
    };

    const failed = await runEffect(Effect.result(
      fixture.repository.settle(AUTHORITY, terminal),
    ));
    expect(Result.isFailure(failed)).toBe(true);
    if (Result.isFailure(failed)) {
      expect(failed.failure).toMatchObject({
        reason: "resourceFailure",
        retryable: false,
      });
    }
    expect(await runEffect(
      fixture.repository.inspect(AUTHORITY, pending.candidateId),
    )).toEqual(pending);
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_revision_v2",
    )).rows).toEqual([{ count: "0" }]);

    const retried = await runEffect(fixture.repository.settle(AUTHORITY, terminal));
    expect(retried).toMatchObject({
      status: "analyzed",
      revision: { status: "inactive" },
    });
  });

  it("captures terminal input before asynchronous transaction work", async () => {
    const fixture = await repositoryFixture();
    const pending = await runEffect(fixture.repository.begin(beginInput()));
    const transactionEntered = deferredValue<void>();
    const releaseTransaction = deferredValue<void>();
    const repository = makeApplicationAnalysisRepository(
      gateTransactionCallback(
        fixture.persistence.drizzle,
        transactionEntered,
        releaseTransaction,
      ),
    );
    const terminal = {
      kind: "rejected" as const,
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      failureCode: "invalid_registration" as const,
      detail: "captured detail",
    };
    const settlement = Effect.runPromise(repository.settle(AUTHORITY, terminal));
    await transactionEntered.promise;
    terminal.detail = "mutated detail";
    releaseTransaction.resolve(undefined);

    const rejected = await settlement;
    expect(rejected).toMatchObject({
      status: "rejected",
      receipt: { detail: "captured detail" },
    });
  });

  it("retains unexpected transaction rejection in an interruption cause", async () => {
    const fixture = await repositoryFixture();
    const transactionEntered = deferredValue<void>();
    const settlement = deferredValue<never>();
    const unexpected = new Error("unexpected interrupted settlement failure");
    const database = new Proxy(fixture.persistence.drizzle, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver);
        }
        return () => {
          transactionEntered.resolve(undefined);
          return settlement.promise;
        };
      },
    });
    const repository = makeApplicationAnalysisRepository(database);
    const fiber = Effect.runFork(repository.begin(beginInput()));
    await transactionEntered.promise;
    const completion = runEffect(Fiber.await(fiber));
    const interruption = runEffect(Fiber.interrupt(fiber));
    await nextTask();
    settlement.reject(unexpected);
    await interruption;

    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(false);
      expect(Cause.pretty(exit.cause)).toContain(unexpected.message);
    }
  });

  it("ignores only the correlated rollback sentinel during interruption", async () => {
    const fixture = await repositoryFixture();
    const rejectionEntered = deferredValue<void>();
    const releaseRejection = deferredValue<void>();
    const repository = makeApplicationAnalysisRepository(
      gateTransactionRejection(
        fixture.persistence.drizzle,
        rejectionEntered,
        releaseRejection,
      ),
      { randomUuid: () => { throw new Error("injected callback failure"); } },
    );
    const fiber = Effect.runFork(repository.begin(beginInput()));
    await rejectionEntered.promise;
    const completion = runEffect(Fiber.await(fiber));
    const interruption = runEffect(Fiber.interrupt(fiber));
    await nextTask();
    releaseRejection.resolve(undefined);
    await interruption;

    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("rejects a stale scope-clock fence without changing the pending row", async () => {
    const fixture = await repositoryFixture();
    const pending = await runEffect(fixture.repository.begin(beginInput()));
    await fixture.persistence.query(
      "update fx_system_scope_clock set storage_generation_fence = 2 where scope_id = $1",
      [AUTHORITY.scopeId],
    );

    const stale = await runEffect(Effect.result(
      fixture.repository.inspect(AUTHORITY, pending.candidateId),
    ));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({
        reason: "authorityChanged",
        retryable: false,
      });
    }

    const currentAuthority: ApplicationAnalysisAuthority = Object.freeze({
      ...AUTHORITY,
      storageGenerationFence: StorageGenerationFenceSchema.make(2n),
    });
    const freshCallerForStaleCandidate = await runEffect(Effect.result(
      fixture.repository.settle(currentAuthority, {
        kind: "rejected",
        candidateId: pending.candidateId,
        sourceArtifactRootSha256: ROOT,
        analyzerIdentity: "analyzer-1",
        analyzerPolicyIdentity: "policy-1",
        failureCode: "invalid_registration",
        detail: "registration is invalid",
      }),
    ));
    expect(Result.isFailure(freshCallerForStaleCandidate)).toBe(true);
    if (Result.isFailure(freshCallerForStaleCandidate)) {
      expect(freshCallerForStaleCandidate.failure).toMatchObject({
        reason: "authorityChanged",
        retryable: false,
      });
    }
    expect((await fixture.persistence.query<{ status: string }>(
      "select status from fx_system_application_analysis_v1 where scope_id = $1",
      [AUTHORITY.scopeId],
    )).rows).toEqual([{ status: "pending" }]);
  });
});

function beginInput() {
  return Object.freeze({
    authority: AUTHORITY,
    requestKey: "request:application-analysis:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
  });
}

function manifestText(): string {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "functions.js",
      schemaModulePath: null,
      modules: [{
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: SOURCE,
        sourceByteLength: 18,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  })).canonicalText;
}

async function repositoryFixture(
  options: { readonly failUuidOnceAt?: number } = {},
) {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const uuids = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000005",
    "10000000-0000-4000-8000-000000000006",
    "10000000-0000-4000-8000-000000000007",
    "10000000-0000-4000-8000-000000000008",
  ];
  let issued = 0;
  let uuidFailureInjected = false;
  const repository = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: () => {
      if (
        !uuidFailureInjected &&
        options.failUuidOnceAt !== undefined &&
        issued === options.failUuidOnceAt
      ) {
        uuidFailureInjected = true;
        throw new Error("Injected revision identity failure.");
      }
      const value = uuids[issued];
      if (value === undefined) throw new Error("UUID fixture exhausted.");
      issued += 1;
      return value;
    },
  });
  return Object.freeze({
    persistence,
    repository,
    issued: () => issued,
  });
}

interface DeferredValue<A> {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
  readonly reject: (cause: unknown) => void;
}

function deferredValue<A>(): DeferredValue<A> {
  let resolve!: (value: A) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, resolve, reject });
}

function gateTransactionCallback(
  database: FlarexMetadataDatabase,
  entered: DeferredValue<void>,
  release: DeferredValue<void>,
): FlarexMetadataDatabase {
  const transaction = database.transaction.bind(database);
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (
        callback: Parameters<FlarexMetadataDatabase["transaction"]>[0],
        config?: Parameters<FlarexMetadataDatabase["transaction"]>[1],
      ) => transaction(async tx => {
        entered.resolve(undefined);
        await release.promise;
        return callback(tx);
      }, config);
    },
  });
}

function gateTransactionRejection(
  database: FlarexMetadataDatabase,
  entered: DeferredValue<void>,
  release: DeferredValue<void>,
): FlarexMetadataDatabase {
  const transaction = database.transaction.bind(database);
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (
        callback: Parameters<FlarexMetadataDatabase["transaction"]>[0],
        config?: Parameters<FlarexMetadataDatabase["transaction"]>[1],
      ) => transaction(callback, config).catch(async cause => {
        entered.resolve(undefined);
        await release.promise;
        throw cause;
      });
    },
  });
}

function nextTask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
