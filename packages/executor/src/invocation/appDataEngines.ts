import type {
  InvokeSessionMetadataRecord,
} from "@flarex/persistence-postgres";
import type { LegacyV1AppDataEngine } from "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import {
  LegacyV1StorageGenerationSchema,
  ScopeIdSchema,
  type LegacyV1StorageGeneration,
  type ScopeId,
  type StorageGeneration,
} from "flarex-protocol/storage-authority";

export interface AppDataStorageAuthority {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
}

export interface LegacyV1AppDataStorageAuthority
  extends AppDataStorageAuthority {
  readonly storageGeneration: LegacyV1StorageGeneration;
}

export interface AppDataEngineRegistry {
  readonly registeredStorageGenerations: readonly [
    LegacyV1StorageGeneration,
  ];
  resolve(authority: AppDataStorageAuthority): LegacyV1AppDataEngine;
}

export class AppDataStorageGenerationUnavailableError extends Error {
  readonly reason = "generationUnavailable" as const;

  constructor(
    readonly scopeId: ScopeId,
    readonly storageGeneration: StorageGeneration,
  ) {
    super(
      `App-data storage generation ${storageGeneration} is unavailable for scope ${scopeId}`,
    );
    this.name = "AppDataStorageGenerationUnavailableError";
  }
}

const existingScopeStorageGeneration =
  LegacyV1StorageGenerationSchema.make("legacy_v1");

export function createLegacyOnlyAppDataEngineRegistry(
  legacyV1: LegacyV1AppDataEngine,
): AppDataEngineRegistry {
  const registeredStorageGenerations = Object.freeze([
    legacyV1.storageGeneration,
  ] as const);
  const registry = {
    registeredStorageGenerations,
    resolve: (authority) => {
      if (authority.storageGeneration === legacyV1.storageGeneration) {
        return legacyV1;
      }
      throw new AppDataStorageGenerationUnavailableError(
        authority.scopeId,
        authority.storageGeneration,
      );
    },
  } satisfies AppDataEngineRegistry;

  return registry;
}

/**
 * S01 compatibility only: the legacy data plane is deployment-qualified.
 * S02 replaces this alias with authoritative scope-clock metadata.
 */
export function legacyV1StorageAuthorityForPersistedSession(
  session: InvokeSessionMetadataRecord,
): LegacyV1AppDataStorageAuthority {
  return {
    scopeId: ScopeIdSchema.make(session.deploymentId),
    storageGeneration: existingScopeStorageGeneration,
  };
}
