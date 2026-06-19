import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { deployments, flarexSchema } from "./schema";

export interface InsertDeploymentMetadataInput {
  deploymentId: string;
  projectId: string;
  activePackageId?: string | null;
  activeSchemaVersion?: number;
}

export type DeploymentMetadataRecord = typeof deployments.$inferSelect;

export class DeploymentMetadataAlreadyExistsError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Deployment metadata already exists: ${deploymentId}`);
    this.name = "DeploymentMetadataAlreadyExistsError";
  }
}

export type FlarexMetadataDatabase = PgDatabase<
  PgQueryResultHKT,
  typeof flarexSchema
>;

export async function insertDeploymentMetadata(
  db: FlarexMetadataDatabase,
  input: InsertDeploymentMetadataInput,
): Promise<DeploymentMetadataRecord> {
  const rows = await db
    .insert(deployments)
    .values({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      activePackageId: input.activePackageId ?? null,
      activeSchemaVersion: input.activeSchemaVersion ?? 0,
    })
    .onConflictDoNothing({ target: deployments.deploymentId })
    .returning();

  const deployment = rows[0];
  if (deployment === undefined) {
    throw new DeploymentMetadataAlreadyExistsError(input.deploymentId);
  }

  return deployment;
}

export async function getDeploymentMetadata(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<DeploymentMetadataRecord | null> {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1);

  return rows[0] ?? null;
}
