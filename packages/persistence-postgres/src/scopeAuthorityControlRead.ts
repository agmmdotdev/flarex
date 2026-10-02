import { Effect } from "effect";
import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction } from "./installationLifecycle";
import { getScopeMetadata, getScopeMetadataByDeploymentId } from "./scopeMetadata";
import { getScopeAuthorityProvisioningReceipt } from "./scopeAuthorityProvisioningReceipt";
import type { ExactScopeMetadataReader, ScopeMetadataReader, ScopeProvisioningReceiptReader } from "./scopeAuthorityResolution";

/** The control owner borrows one short transaction for each fresh observation.
 * Target resolution begins only after this transaction has settled. Raw
 * transaction-scoped getters retain their existing caller-owned lock order. */
export function makeInstallationProtectedScopeAuthorityControlReader(database: FlarexMetadataDatabase): Readonly<{
  scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader;
  provisioningReceipts: ScopeProvisioningReceiptReader;
}> {
  const scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader = {
    getScopeMetadata: scopeId => read(tx => getScopeMetadata(tx, scopeId)),
    getScopeMetadataByDeploymentId: deploymentId => read(tx => getScopeMetadataByDeploymentId(tx, deploymentId)),
  };
  const provisioningReceipts: ScopeProvisioningReceiptReader = {
    getScopeAuthorityProvisioningReceipt: scopeId => read(tx => getScopeAuthorityProvisioningReceipt(tx, scopeId)),
  };
  return Object.freeze({ scopeMetadata: Object.freeze(scopeMetadata),
    provisioningReceipts: Object.freeze(provisioningReceipts) });

  // Promise boundary required by the existing authority ports. Await work and
  // settlement without converting the raw readers' decoding/error identity.
  function read<Value>(work: (tx: FlarexMetadataTransaction) => Promise<Value>): Promise<Value> {
    return database.transaction(async tx => {
      try {
        await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
        return await work(tx);
      } finally { closeInstallationAdmission(tx); }
    });
  }
}
