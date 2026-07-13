import {
  SnapshotTokenSchema,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";

import {
  resolveTrustedScopeAuthority,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";

/**
 * An ephemeral exact snapshot selection and its storage-generation fences.
 *
 * This is not a commit authorization or a durable session pin. Session
 * identity, package/schema/policy identity, leases, and stale-selection
 * validation belong to later OCC gates.
 */
export interface ResolvedAppDataSnapshot {
  readonly snapshotToken: SnapshotToken;
  readonly storageGeneration: TrustedScopeAuthority["storageGeneration"];
  readonly storageGenerationFence:
    TrustedScopeAuthority["storageGenerationFence"];
}

export interface AppDataSnapshotResolver {
  /**
   * Resolves the current snapshot for a server-authorized deployment. The
   * caller must not derive deployment identity from untrusted request input.
   */
  resolveCurrent(deploymentId: string): Promise<ResolvedAppDataSnapshot>;
}

/**
 * Binds snapshot resolution to trusted construction-time authority readers.
 * Control metadata locates the data plane; one located scope-clock read
 * supplies the token, generation, and fence together.
 */
export function createAppDataSnapshotResolver(
  ports: TrustedScopeAuthorityResolutionPorts,
): AppDataSnapshotResolver {
  return Object.freeze({
    resolveCurrent: async (deploymentId: string) => {
      const authority = await resolveTrustedScopeAuthority(
        deploymentId,
        ports,
      );
      const snapshotToken = Object.freeze(
        SnapshotTokenSchema.make({
          scopeId: authority.scopeId,
          epoch: authority.epoch,
          commitSeq: authority.lastCommitSeq,
        }),
      );

      return Object.freeze({
        snapshotToken,
        storageGeneration: authority.storageGeneration,
        storageGenerationFence: authority.storageGenerationFence,
      }) satisfies ResolvedAppDataSnapshot;
    },
  }) satisfies AppDataSnapshotResolver;
}
