import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { deployments, flarexSchema } from "./schema";

export interface CreateDeploymentInput {
  deploymentId: string;
  projectId: string;
  activePackageId?: string | null;
  activeSchemaVersion?: number;
}

export type DeploymentRecord = typeof deployments.$inferSelect;

export class DeploymentAlreadyExistsError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Deployment already exists: ${deploymentId}`);
    this.name = "DeploymentAlreadyExistsError";
  }
}

export type FlarexMetadataDatabase = PgDatabase<
  PgQueryResultHKT,
  typeof flarexSchema
>;

export async function createDeployment(
  db: FlarexMetadataDatabase,
  input: CreateDeploymentInput,
): Promise<DeploymentRecord> {
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
    throw new DeploymentAlreadyExistsError(input.deploymentId);
  }

  return deployment;
}

export async function getDeployment(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<DeploymentRecord | null> {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1);

  return rows[0] ?? null;
}
