import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { fxSystemApplicationActiveHeads } from "../../application/applicationActivationSchema";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { fxSystemDataBindingHeads } from "../../installation/frameworkSchema/binding/schema";
import { requireCoLocatedInstallationAdmission, type PreparedCoLocatedReadInstallation } from "../../installation/installationLifecycle";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { fxSystemLogicalSourceInitializations } from "../catalog/logicalStorageInitialization";

type ApplicationHead = typeof fxSystemApplicationActiveHeads.$inferSelect;
type BindingHead = typeof fxSystemDataBindingHeads.$inferSelect;
type SourceInitialization = typeof fxSystemLogicalSourceInitializations.$inferSelect;
export type SourceInitializationReadReceipt = Pick<SourceInitialization,
  "sourceKey" | "stepId" | "sourceSha256" | "contractSha256" | "datasetSha256" | "rowCount">;
export interface StandaloneReadSnapshot {
  readonly sourceInitialization?: Readonly<{ sourceKey: string; stepId: string;
    receipt: SourceInitializationReadReceipt | null }>;
  readonly applicationHead: Readonly<{
    sequence: ApplicationHead["activationSequence"];
    readinessContractVersion: ApplicationHead["readinessContractVersion"];
    revisionId: string;
    headSha256: Uint8Array;
    activationSha256: Uint8Array;
    readinessSha256: Uint8Array;
  }> | null;
  readonly bindingHead: Readonly<Omit<BindingHead, "canonicalBytes"> & { canonicalBytes: Uint8Array | null }> | null;
}
const snapshots = new WeakMap<FlarexMetadataTransaction, Readonly<{
  database: FlarexMetadataDatabase;
  scopeId: ScopeId;
  snapshot: StandaloneReadSnapshot;
}>>();

/** The accepting kernel supplies rows from its bounded, locked guard query.
 * This observation expires with that callback and never becomes host state. */
export const withStandaloneReadSnapshot = Effect.fn("StandaloneReadSnapshot.with")(
  function* <Value, Failure, Requirements>(pair: PreparedCoLocatedReadInstallation,
    database: FlarexMetadataDatabase, tx: FlarexMetadataTransaction, scopeId: ScopeId,
    snapshot: StandaloneReadSnapshot, work: () => Effect.Effect<Value, Failure, Requirements>) {
    yield* requireCoLocatedInstallationAdmission(pair, database, tx);
    if (snapshots.has(tx)) return yield* Effect.die(new Error("Standalone read snapshot already opened"));
    snapshots.set(tx, Object.freeze({ database, scopeId, snapshot }));
    return yield* Effect.suspend(work).pipe(Effect.ensuring(Effect.sync(() => snapshots.delete(tx))));
  },
);

export function readStandaloneReadSnapshot(tx: FlarexMetadataTransaction,
  database: FlarexMetadataDatabase, scopeId: string): StandaloneReadSnapshot | undefined {
  const observed = snapshots.get(tx);
  return observed?.database === database && observed.scopeId === scopeId ? observed.snapshot : undefined;
}

export function readStandaloneSourceInitialization(tx: FlarexMetadataTransaction,
  scopeId: ScopeId, sourceKey: string, stepId: string): SourceInitializationReadReceipt | null | undefined {
  const observed = snapshots.get(tx);
  const initialization = observed?.scopeId === scopeId ? observed.snapshot.sourceInitialization : undefined;
  return initialization?.sourceKey === sourceKey && initialization.stepId === stepId ? initialization.receipt : undefined;
}
