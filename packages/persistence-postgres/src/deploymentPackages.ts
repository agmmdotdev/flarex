import { and, eq } from "drizzle-orm";

import { deploymentPackages } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export interface InsertDeploymentPackageMetadataInput {
  deploymentId: string;
  packageId: string;
  sourcePackageHash: string;
  executionModule: string;
  sourcePackageJson: Record<string, unknown>;
  analysisJson?: Record<string, unknown> | null;
}

export type DeploymentPackageMetadataRecord =
  typeof deploymentPackages.$inferSelect;

export class DeploymentPackageMetadataAlreadyExistsError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly packageId: string,
  ) {
    super(
      `Deployment package metadata already exists: ${deploymentId}/${packageId}`,
    );
    this.name = "DeploymentPackageMetadataAlreadyExistsError";
  }
}

export async function insertDeploymentPackageMetadata(
  db: FlarexMetadataDatabase,
  input: InsertDeploymentPackageMetadataInput,
): Promise<DeploymentPackageMetadataRecord> {
  const rows = await db
    .insert(deploymentPackages)
    .values({
      deploymentId: input.deploymentId,
      packageId: input.packageId,
      sourcePackageHash: input.sourcePackageHash,
      executionModule: input.executionModule,
      sourcePackageJson: input.sourcePackageJson,
      analysisJson: input.analysisJson ?? null,
    })
    .onConflictDoNothing({
      target: [deploymentPackages.deploymentId, deploymentPackages.packageId],
    })
    .returning();

  const deploymentPackage = rows[0];
  if (deploymentPackage === undefined) {
    throw new DeploymentPackageMetadataAlreadyExistsError(
      input.deploymentId,
      input.packageId,
    );
  }

  return deploymentPackage;
}

export async function getDeploymentPackageMetadata(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  packageId: string,
): Promise<DeploymentPackageMetadataRecord | null> {
  const rows = await db
    .select()
    .from(deploymentPackages)
    .where(
      and(
        eq(deploymentPackages.deploymentId, deploymentId),
        eq(deploymentPackages.packageId, packageId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
