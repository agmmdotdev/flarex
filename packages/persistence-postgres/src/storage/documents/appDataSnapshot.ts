import {
  SnapshotTokenSchema,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import { Effect } from "effect";

import {
  captureExactTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type ExactTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeSelection,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
} from "../../scope/scopeAuthorityResolution";

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
   * Resolves the current snapshot for a trusted session or grant selection.
   * Neither identity may come directly from untrusted request input.
   */
  readonly resolveCurrent: (
    selection: TrustedScopeSelection,
  ) => Effect.Effect<
    ResolvedAppDataSnapshot,
    TrustedScopeAuthorityError
  >;
}

/**
 * Binds snapshot resolution to trusted construction-time authority readers.
 * Control metadata locates the data plane; one located scope-clock read
 * supplies the token, generation, and fence together.
 */
export function createAppDataSnapshotResolver(
  ports: ExactTrustedScopeAuthorityResolutionPorts,
): AppDataSnapshotResolver {
  const authorityPorts = captureExactTrustedScopeAuthorityResolutionPorts(ports);
  return Object.freeze({
    resolveCurrent: Effect.fn("AppDataSnapshot.resolveCurrent")(function* (
      selection: TrustedScopeSelection,
    ): Effect.fn.Return<
      ResolvedAppDataSnapshot,
      TrustedScopeAuthorityError
    > {
      const { authority } = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        selection,
        authorityPorts,
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
    }),
  }) satisfies AppDataSnapshotResolver;
}
