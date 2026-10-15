import type { FlarexMetadataDatabase } from "../application/deployments";
import {
  acquireCoLocatedInstallationAdmission,
  acquireInstallationAdmission,
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
  type PreparedCoLocatedReadInstallation,
  type PreparedInstallation,
} from "../installation/installationLifecycle";
import type { PreparedInstalledAttemptScopeAuthority } from "../scope/scopeAuthorityControlRead";
import type { RunLocatedReadCommittedTransactionV1 } from "./locatedTransactionIdentity";
import { Effect, Result } from "effect";
import { withExecutionDiagnosticDefaults } from "../execution/diagnostics/operation";
import type { ScopeId } from "flarex-protocol/storage-authority";

import { createReadCommittedTransactionRunner } from "./readCommittedTransactionRunner";

/**
 * Package-internal construction seam shared by narrowly located persistence
 * capabilities. Its package route is restricted to trusted construction.
 */
export function createDefaultLocatedReadCommittedTransactionRunnerV1(
  db: FlarexMetadataDatabase,
  installation?: Readonly<{ kind: "coLocated"; installation: PreparedCoLocatedReadInstallation }> |
    Readonly<{ kind: "direct"; installation: PreparedInstallation }>,
  accepting?: Readonly<{ owner: PreparedInstalledAttemptScopeAuthority;
    selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>; protection: "share" | "attempt" }>,
): RunLocatedReadCommittedTransactionV1 {
  const run = createReadCommittedTransactionRunner(db, async tx => {
    if (accepting !== undefined) Result.getOrThrowWith(accepting.owner.requireDatabase(db), cause => cause);
    if (accepting === undefined) await Effect.runPromise(withExecutionDiagnosticDefaults(installation === undefined ? lockInstallationForCurrentTransaction(tx)
      : installation.kind === "coLocated" ? acquireCoLocatedInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid)
      : acquireInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid)));
  }, tx => {
    accepting?.owner.closeAcceptedTransaction(tx);
    closeInstallationAdmission(tx);
  });
  return work => run(async tx => {
    const result = await work(tx);
    if (accepting !== undefined) Result.getOrThrowWith(
      accepting.owner.requireAcceptedTransaction(tx, accepting.selection, accepting.protection), cause => cause);
    return result;
  });
}
