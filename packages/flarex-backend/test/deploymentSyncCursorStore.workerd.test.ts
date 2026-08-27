/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scopeB = "00000000-0000-4000-8000-000000000002";
const epochA = "00000000-0000-4000-8000-000000000003";
const epochB = "00000000-0000-4000-8000-000000000004";
const maximumSignedInt64 = "9223372036854775807";

describe("DeploymentSyncDO fenced SQLite cursor store", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    runtime = new Miniflare({
      modules: [{
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(),
      }],
      compatibilityDate: "2026-06-14",
      durableObjects: {
        DEPLOYMENT_SYNCS: {
          className: "DeploymentSyncStoreTestDO",
          useSQLite: true,
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await runtime.dispose();
  });

  it("keeps an empty actor uninitialized and creates no prototype registry tables", async () => {
    const actorScopeUuid = testScope(10);
    expect(await invoke("empty", "read", { actorScopeUuid })).toEqual({
      ok: true,
      value: { kind: "uninitialized" },
    });
    expect(await invoke("empty", "tableNames", { actorScopeUuid })).toEqual({
      tables: [{ name: "deployment_sync_scope_state" }],
    });
  });

  it("initializes exactly, replays idempotently, and preserves state on schema re-entry", async () => {
    const actorScopeUuid = testScope(11);
    const input = initialization(
      actorScopeUuid,
      epochA,
      maximumSignedInt64,
      maximumSignedInt64,
    );
    const expected = initializedState(
      actorScopeUuid,
      epochA,
      maximumSignedInt64,
      maximumSignedInt64,
    );

    expect(await invoke("maximum", "initialize", input)).toEqual({
      ok: true,
      value: expected.value.state,
    });
    expect(await invoke("maximum", "initialize", input)).toEqual({
      ok: true,
      value: expected.value.state,
    });
    expect(await invoke("maximum", "reenterSchema", input)).toEqual({ ok: true });
    expect(await invoke("maximum", "read", input)).toEqual(expected);
  });

  it("isolates actors and binds every later operation to the stored scope", async () => {
    const isolationScopeA = testScope(12);
    const isolationScopeB = testScope(13);
    await expectInitialized(
      "isolation-a",
      initialization(isolationScopeA, epochA, "2", "5"),
    );
    await expectInitialized(
      "isolation-b",
      initialization(isolationScopeB, epochB, "3", "8"),
    );

    expect(await invoke("isolation-a", "read", {
      actorScopeUuid: isolationScopeA,
    })).toEqual(
      initializedState(isolationScopeA, epochA, "2", "5"),
    );
    expect(await invoke("isolation-b", "read", {
      actorScopeUuid: isolationScopeB,
    })).toEqual(
      initializedState(isolationScopeB, epochB, "3", "8"),
    );
    expect(await invoke("isolation-a", "read", {
      actorScopeUuid: isolationScopeA,
      operationScopeUuid: isolationScopeB,
    })).toMatchObject({
      ok: false,
      error: { tag: "DeploymentSyncActorIdentityConflictError", operation: "read" },
    });
  });

  it("rejects a differing initialization without changing the durable row", async () => {
    const actorScopeUuid = testScope(14);
    const initial = initialization(actorScopeUuid, epochA, "4", "5");
    await expectInitialized("init-conflict", initial);

    expect(await invoke("init-conflict", "initialize", {
      ...initial,
      epochUuid: epochB,
    })).toEqual({
      ok: false,
      error: {
        tag: "DeploymentSyncInitializationConflictError",
        field: "epochUuid",
        expected: epochA,
        observed: epochB,
      },
    });
    expect(await invoke("init-conflict", "read", initial)).toEqual(
      initializedState(actorScopeUuid, epochA, "4", "5"),
    );
  });

  it("uses the existing cursor policy for duplicates, gaps, scope, and epoch checks", async () => {
    const actorScopeUuid = testScope(15);
    const initial = initialization(actorScopeUuid, epochA, "5", "5");
    await expectInitialized("policy", initial);

    expect(await invoke("policy", "advance", { ...initial, commitSeq: "5" })).toEqual({
      ok: true,
      value: { kind: "duplicate", observedCommitSeq: "5" },
    });
    expect(await invoke("policy", "advance", { ...initial, commitSeq: "7" })).toMatchObject({
      ok: false,
      error: {
        tag: "ScopeSyncCommitGapError",
        nextRequiredCommitSeq: "6",
        observedCommitSeq: "7",
      },
    });
    expect(await invoke("policy", "advance", {
      ...initial,
      epochUuid: epochB,
      commitSeq: "6",
    })).toMatchObject({ ok: false, error: { tag: "ScopeSyncEpochMismatchError" } });
    expect(await invoke("policy", "advance", {
      ...initial,
      operationScopeUuid: scopeB,
      commitSeq: "6",
    })).toMatchObject({
      ok: false,
      error: { tag: "DeploymentSyncActorIdentityConflictError", operation: "advance" },
    });
    expect(await invoke("policy", "advance", { ...initial, commitSeq: "6" })).toEqual({
      ok: true,
      value: { kind: "exactNext", appliedThroughCommitSeq: "6" },
    });
    expect(await invoke("policy", "read", initial)).toEqual(
      initializedState(actorScopeUuid, epochA, "5", "6"),
    );
  });

  it("reports a lost compare-and-swap without mutating the cursor", async () => {
    const actorScopeUuid = testScope(16);
    const initial = initialization(actorScopeUuid, epochA, "6", "5");
    await expectInitialized("cas", initial);
    expect(await invoke("cas", "forceCasConflict", initial)).toEqual({ ok: true });

    expect(await invoke("cas", "advance", { ...initial, commitSeq: "6" })).toEqual({
      ok: false,
      error: {
        tag: "DeploymentSyncCursorStateConflictError",
        expectedAppliedThroughCommitSeq: "5",
        candidateAppliedThroughCommitSeq: "6",
      },
    });
    expect(await invoke("cas", "read", initial)).toEqual(
      initializedState(actorScopeUuid, epochA, "6", "5"),
    );
  });

  it("leaves the prior cursor readable when the SQLite update rolls back", async () => {
    const actorScopeUuid = testScope(17);
    const initial = initialization(actorScopeUuid, epochA, "7", "5");
    await expectInitialized("rollback", initial);
    expect(await invoke("rollback", "forceRollback", initial)).toEqual({ ok: true });

    expect(await invoke("rollback", "advance", { ...initial, commitSeq: "6" })).toMatchObject({
      ok: false,
      error: { tag: "DeploymentSyncStorageError", operation: "advance" },
    });
    expect(await invoke("rollback", "read", initial)).toEqual(
      initializedState(actorScopeUuid, epochA, "7", "5"),
    );
  });

  it("rolls back and preserves unexpected callback failures as defects", async () => {
    const actorScopeUuid = testScope(21);
    const initial = initialization(actorScopeUuid, epochA, "9", "5");
    await expectInitialized("defect", initial);

    expect(await invoke("defect", "advanceDefect", {
      ...initial,
      commitSeq: "6",
    })).toEqual({ died: true, typedFailure: false });
    expect(await invoke("defect", "read", initial)).toEqual(
      initializedState(actorScopeUuid, epochA, "9", "5"),
    );
  });

  it.each([
    ["invalid", "corruptInvalid", "invalidStateRow"],
    ["duplicate", "corruptDuplicate", "duplicateStateRows"],
    ["partial", "corruptPartial", "invalidStateRow"],
  ] as const)("refuses %s state and schema re-entry does not repair it", async (
    actor,
    corruption,
    detail,
  ) => {
    const actorOrdinal = actor === "invalid" ? 18 : actor === "duplicate" ? 19 : 20;
    const initial = initialization(testScope(actorOrdinal), epochA, "8", "5");
    await expectInitialized(actor, initial);
    expect(await invoke(actor, corruption, initial)).toEqual({ ok: true });
    expect(await invoke(actor, "reenterSchema", initial)).toEqual({ ok: true });
    expect(await invoke(actor, "read", initial)).toEqual({
      ok: false,
      error: {
        tag: "DeploymentSyncStateCorruptionError",
        operation: "read",
        detail,
      },
    });
  });

  async function expectInitialized(actor: string, input: Record<string, unknown>) {
    const response = await invoke(actor, "initialize", input);
    expect(response).toMatchObject({ ok: true });
  }

  async function invoke(
    actor: string,
    operation: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await runtime.dispatchFetch("https://deployment-sync.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, operation, actor }),
    });
    expect(response.status).toBe(200);
    return await response.json() as Record<string, unknown>;
  }
});

function initialization(
  actorScopeUuid: string,
  epochUuid: string,
  storageGenerationFence: string,
  commitSeq: string,
): Record<string, unknown> {
  return { actorScopeUuid, epochUuid, storageGenerationFence, commitSeq };
}

function initializedState(
  scopeUuid: string,
  epochUuid: string,
  storageGenerationFence: string,
  appliedThroughCommitSeq: string,
) {
  return {
    ok: true,
    value: {
      kind: "initialized",
      state: {
        localSchemaRevision: 1,
        scopeUuid,
        epochUuid,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence,
        appliedThroughCommitSeq,
      },
    },
  };
}

function testScope(ordinal: number): string {
  return `00000000-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

async function bundleWorker(): Promise<string> {
  const backendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(
          backendDirectory,
          "test/deploymentSyncCursorStore.workerd.worker.ts",
        ),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(chunk =>
    chunk.type === "chunk" && chunk.fileName === "worker.js"
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Deployment sync store worker bundle missing.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-deployment-sync-store-test-resolution",
    resolveId(id) {
      if (
        id === "@flarex/persistence-postgres" ||
        id.startsWith("@flarex/persistence-postgres/") ||
        id === "flarex-protocol" ||
        id.startsWith("flarex-protocol/")
      ) return fileURLToPath(import.meta.resolve(id));
      return undefined;
    },
  };
}
