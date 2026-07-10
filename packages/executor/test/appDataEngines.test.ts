import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createLegacyV1AppDataEngine } from "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeIdSchema,
  type LegacyV1StorageGeneration,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import {
  AppDataStorageGenerationUnavailableError,
  createLegacyOnlyAppDataEngineRegistry,
  legacyV1StorageAuthorityForPersistedSession,
  type AppDataEngineRegistry,
  type AppDataStorageAuthority,
} from "../src/appDataEngines";
import { InvokeSessionProjectMismatchError } from "../src/errors";
import { invokeSyscall } from "../src/sessions";
import {
  invokeSessionMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("app-data storage generation resolution", () => {
  it("maps persisted existing sessions to one exact legacy engine", () => {
    const persistence = memoryPersistence();
    const legacyV1 = createLegacyV1AppDataEngine(persistence);
    const registry = createLegacyOnlyAppDataEngineRegistry(legacyV1);
    const authorityA = legacyV1StorageAuthorityForPersistedSession(
      persistedSession("deployment_a", "session_a"),
    );
    const authorityB = legacyV1StorageAuthorityForPersistedSession(
      persistedSession("deployment_b", "session_b"),
    );

    expect(authorityA).toEqual({
      scopeId: "deployment_a",
      storageGeneration: "legacy_v1",
    });
    expect(authorityB).toEqual({
      scopeId: "deployment_b",
      storageGeneration: "legacy_v1",
    });
    expectTypeOf(authorityA.scopeId).toEqualTypeOf<ScopeId>();
    expectTypeOf(authorityA.storageGeneration)
      .toEqualTypeOf<LegacyV1StorageGeneration>();
    expect(registry.registeredStorageGenerations).toEqual(["legacy_v1"]);
    expect(Object.keys(registry).sort()).toEqual([
      "registeredStorageGenerations",
      "resolve",
    ]);
    expect(registry.resolve(authorityA)).toBe(legacyV1);
    expect(registry.resolve(authorityB)).toBe(legacyV1);
  });

  it("fails closed for a valid but unavailable FlarexDB generation", () => {
    const persistence = memoryPersistence();
    const getDocumentRevisionAtTs = vi.spyOn(
      persistence,
      "getDocumentRevisionAtTs",
    );
    const registry = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const authority = {
      scopeId: ScopeIdSchema.make("deployment_future"),
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    } satisfies AppDataStorageAuthority;

    let resolutionError: unknown;
    try {
      registry.resolve(authority);
    } catch (error) {
      resolutionError = error;
    }

    expect(resolutionError)
      .toBeInstanceOf(AppDataStorageGenerationUnavailableError);
    if (
      !(resolutionError instanceof AppDataStorageGenerationUnavailableError)
    ) {
      throw resolutionError;
    }
    expect(resolutionError.reason).toBe("generationUnavailable");
    expect(resolutionError.scopeId).toBe("deployment_future");
    expect(resolutionError.storageGeneration).toBe("flarexdb_v1");
    expect(getDocumentRevisionAtTs).not.toHaveBeenCalled();
  });

  it("resolves from validated persisted session state, not caller selection", async () => {
    const session = persistedSession("deployment_trusted", "session_trusted");
    const persistence = memoryPersistence([], [], [session]);
    const registry = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const resolve = vi.fn((authority: AppDataStorageAuthority) =>
      registry.resolve(authority),
    );
    const tracingRegistry = {
      registeredStorageGenerations: registry.registeredStorageGenerations,
      resolve,
    } satisfies AppDataEngineRegistry;
    const callerInput = {
      deploymentId: session.deploymentId,
      projectId: session.projectId,
      sessionId: session.sessionId,
      syscall: { op: "get", id: "1:missing" },
      storageGeneration: "flarexdb_v1",
    } as const;

    await expect(
      invokeSyscall(persistence, tracingRegistry, callerInput),
    ).resolves.toMatchObject({ value: null });
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      scopeId: "deployment_trusted",
      storageGeneration: "legacy_v1",
    });

    resolve.mockClear();
    await expect(
      invokeSyscall(persistence, tracingRegistry, {
        ...callerInput,
        projectId: "project_untrusted",
      }),
    ).rejects.toBeInstanceOf(InvokeSessionProjectMismatchError);
    expect(resolve).not.toHaveBeenCalled();
  });
});

function persistedSession(deploymentId: string, sessionId: string) {
  return invokeSessionMetadata({
    deploymentId,
    sessionId,
    projectId: `project:${deploymentId}`,
    packageId: "package_active",
    functionPath: "messages:get",
    functionKind: "query",
    partitionKey: "team:1",
    scopeJson: {
      kind: "partition",
      partitionKey: "team:1",
    },
    argsJson: { teamId: "team:1" },
    beginTs: 1781913600123,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}
