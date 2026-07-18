import { eq } from "drizzle-orm";

import {
  type DeploymentMetadataRecord,
} from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { deployments } from "./schema";

/**
 * Hold an existing deployment stable while scope authority is provisioned.
 * Absence remains a caller-owned insert/race decision.
 */
export async function lockDeploymentForAuthority(
  tx: FlarexMetadataTransaction,
  deploymentId: string,
): Promise<DeploymentMetadataRecord | null> {
  const rows = await tx
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1)
    .for("share");
  return rows[0] ?? null;
}
