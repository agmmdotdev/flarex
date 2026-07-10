import type {
  FlarexExecutorPersistence,
  ReadyDeploymentAuthorityProvisioner,
} from "./types";

export type FlarexExecutorPersistenceWithoutDeploymentAuthority = Omit<
  FlarexExecutorPersistence,
  "ensureDeploymentAuthority"
>;

export type FlarexExecutorPersistenceCompositionInput =
  FlarexExecutorPersistenceWithoutDeploymentAuthority & {
    readonly insertDeploymentMetadata?: unknown;
  };

/**
 * Builds the executor-facing persistence facade. The low-level deployment
 * insertion method remains available to migration/bootstrap owners, but it is
 * deliberately omitted from the object handed to the executor.
 */
export function withReadyDeploymentAuthority(
  persistence: FlarexExecutorPersistenceCompositionInput,
  provisioner: ReadyDeploymentAuthorityProvisioner,
): FlarexExecutorPersistence {
  const {
    insertDeploymentMetadata: _bareDeploymentWriter,
    ...executorPersistence
  } = persistence;

  return {
    ...executorPersistence,
    ensureDeploymentAuthority: async (input) => {
      const ensured = await provisioner.ensure(input);
      return {
        deployment: ensured.deployment,
        createdDeployment: ensured.createdDeployment,
      };
    },
  };
}
