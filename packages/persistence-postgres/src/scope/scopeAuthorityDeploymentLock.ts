import { eq } from "drizzle-orm";

import {
  type DeploymentMetadataRecord,
} from "../application/deployments";
import type { FlarexMetadataTransaction } from "../database/metadataTransaction";
import { deployments } from "../database/schema";

/**
 * Hold an existing deployment stable while scope authority is provisioned.
 * Normal shared provisioning also serializes scope discovery and creation.
 * Absence remains a caller-owned insert/race decision.
 */
export async function lockDeploymentForAuthority(
  tx: FlarexMetadataTransaction,
  deploymentId: string,
  mode: "share" | "no key update" = "share",
): Promise<DeploymentMetadataRecord | null> {
  const rows = await tx
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1)
    .for(mode);
  return rows[0] ?? null;
}
