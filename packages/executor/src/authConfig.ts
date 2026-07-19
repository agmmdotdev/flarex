import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import {
  decodeAuthConfigPromise,
  type AuthConfig,
} from "flarex-protocol/auth";

import { DeploymentAuthConfigMetadataUnavailableError } from "./errors";
import { getActiveDeploymentPackage } from "./deploymentPackages";
import type {
  FlarexExecutorControlPersistence,
  GetActiveDeploymentAuthConfigInput,
  GetActiveDeploymentAuthConfigResult,
} from "./types";

export async function getActiveDeploymentAuthConfig(
  persistence: FlarexExecutorControlPersistence,
  input: GetActiveDeploymentAuthConfigInput,
): Promise<GetActiveDeploymentAuthConfigResult> {
  const active = await getActiveDeploymentPackage(persistence, input);
  const sourcePackage = active.package.sourcePackageJson;
  const authConfig = await decodeStoredAuthConfig(
    input.deploymentId,
    active.package.packageId,
    sourcePackage,
  );
  const authConfigModule = storedAuthConfigModule(
    input.deploymentId,
    active.package.packageId,
    sourcePackage,
    authConfig,
  );

  if (authConfig === null) {
    return {
      deployment: active.deployment,
      package: active.package,
      authConfig: null,
      authConfigModule: null,
    };
  }
  assertAuthConfigModuleExists(
    input.deploymentId,
    active.package.packageId,
    sourcePackage,
    authConfigModule,
  );
  if (authConfigModule === null) {
    throw new DeploymentAuthConfigMetadataUnavailableError(
      input.deploymentId,
      active.package.packageId,
      "Stored authConfig requires an authConfigModule.",
    );
  }

  return {
    deployment: active.deployment,
    package: active.package,
    authConfig,
    authConfigModule,
  };
}

async function decodeStoredAuthConfig(
  deploymentId: string,
  packageId: string,
  sourcePackage: Record<string, unknown>,
): Promise<AuthConfig | null> {
  const value = sourcePackage.authConfig;
  if (value === undefined) return null;
  try {
    return await decodeAuthConfigPromise(value);
  } catch (cause) {
    throw new DeploymentAuthConfigMetadataUnavailableError(
      deploymentId,
      packageId,
      "Stored authConfig is not a valid auth provider configuration.",
      cause,
    );
  }
}

function storedAuthConfigModule(
  deploymentId: string,
  packageId: string,
  sourcePackage: Record<string, unknown>,
  authConfig: AuthConfig | null,
): string | null {
  const value = sourcePackage.authConfigModule;
  if (authConfig === null) {
    if (value === undefined) return null;
    throw new DeploymentAuthConfigMetadataUnavailableError(
      deploymentId,
      packageId,
      "Stored authConfigModule exists without stored authConfig.",
    );
  }
  if (!isNonEmptyString(value)) {
    throw new DeploymentAuthConfigMetadataUnavailableError(
      deploymentId,
      packageId,
      "Stored authConfig requires a non-empty authConfigModule.",
    );
  }
  return value;
}

function assertAuthConfigModuleExists(
  deploymentId: string,
  packageId: string,
  sourcePackage: Record<string, unknown>,
  authConfigModule: string | null,
): void {
  if (authConfigModule === null) {
    throw new DeploymentAuthConfigMetadataUnavailableError(
      deploymentId,
      packageId,
      "Stored authConfig requires an authConfigModule.",
    );
  }
  if (modulePaths(sourcePackage).has(authConfigModule)) return;
  throw new DeploymentAuthConfigMetadataUnavailableError(
    deploymentId,
    packageId,
    `Stored authConfigModule ${authConfigModule} is missing from sourcePackage modules.`,
  );
}

function modulePaths(sourcePackage: Record<string, unknown>): ReadonlySet<string> {
  const modules = sourcePackage.modules;
  if (!Array.isArray(modules)) return new Set();
  return new Set(
    modules.flatMap((module): string[] =>
      isRecord(module) && typeof module.path === "string" ? [module.path] : [],
    ),
  );
}
