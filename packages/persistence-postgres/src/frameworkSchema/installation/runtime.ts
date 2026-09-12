import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "../../deployments";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import { runEffectTransaction } from "../../effectTransaction";
import { runDrizzleStatementEffect } from "../../drizzleStatementEffect";
import { frameworkMigrationTargetSnapshot, hasFrameworkMigrationTargetDatabase, type FrameworkMigrationTarget } from "../../migrationCoordination/targetSession";
import { withFrameworkMigrationPlanVerification } from "../../migrationCoordination/planVerificationScope";
import { withAdditiveMigrationGraphLimits } from "../../migrationCoordination/additiveLimits";
import { lockBindingInstallation } from "../binding/evidence";
import { bindingError } from "../binding/errors";
import { sameBindingValue, isSyntheticBindingReference } from "../binding/canonical";
import type { InstallationBindingReference } from "../binding/model";
import { capturePrivateJsonData } from "../../privateJsonData";
import { fxSystemFrameworkSchemaAvailabilityHeads as heads } from "./schema";
import { installationRuntimeData, type InstallationRuntimeData } from "./runtimeData";
import { collectInstallationEvidence, readInstallationEvidence, installationEvidenceMatches, installationEvidenceRowDigest,
  type InstallationEvidence, type InstallationEvidenceCoordinates } from "./runtimeEvidence";

declare const preparedInstallationBrand: unique symbol;
export interface PreparedInstallationRuntime { readonly [preparedInstallationBrand]: true }
interface PreparedState {
  readonly target: FrameworkMigrationTarget;
  readonly reference: InstallationBindingReference;
  readonly installationStorageId: bigint;
  readonly headFingerprint: string;
  readonly coordinates: InstallationEvidenceCoordinates;
  readonly evidence: InstallationEvidence;
  readonly data: InstallationRuntimeData;
}
const states = new WeakMap<object, PreparedState>();
const MAX_RETAINED_DATA_BYTES = 8_388_608;

/** One immutable description per host, with no acquired connection, transaction,
 * fiber, mutable verdict or restored graph retained. Construction failures publish no token.
 * The host owns the token's lifetime; releasing the host makes all state collectible.
 * Concurrent host constructions are independent, with no shared mutable cache. */
export const prepareInstallationRuntime = Effect.fn("InstallationRuntime.prepare")(function* (
  database: FlarexMetadataDatabase, target: FrameworkMigrationTarget, input: InstallationBindingReference,
) {
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (snapshot === undefined || !hasFrameworkMigrationTargetDatabase(target, database)) return yield* Effect.fail(bindingError("invalidAuthority"));
  const captured = yield* Effect.fromResult(capturePrivateJsonData(input, 65_536, (_reason, cause) => bindingError("invalidInput", cause)));
  if (!isSyntheticBindingReference(captured.value)) return yield* Effect.fail(bindingError("invalidInput"));
  const reference = captured.value;
  const state = yield* runEffectTransaction(
    callback => database.transaction(callback, { isolationLevel: "repeatable read" }),
    "Installation preparation failed; roll back its snapshot transaction.",
    (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      yield* runDrizzleStatementEffect(tx.execute(sql`select set_config('statement_timeout', '5000ms', true), set_config('lock_timeout', '1000ms', true)`), cause => bindingError("resourceFailure", cause));
      const restored = yield* lockBindingInstallation(tx, reference, snapshot);
      const coordinates = yield* collectInstallationEvidence(tx, restored);
      const evidence = yield* readInstallationEvidence(tx, coordinates);
      const headFingerprint = yield* lockHeadFingerprint(tx, restored.installation.storageId);
      const data = installationRuntimeData(restored);
      if (measureCanonicalJsonUtf8Bytes(data, MAX_RETAINED_DATA_BYTES).kind !== "success") return yield* Effect.fail(bindingError("resourceFailure"));
      return Object.freeze({ target, reference, installationStorageId: restored.installation.storageId, headFingerprint, coordinates, evidence, data });
    }).pipe(withAdditiveMigrationGraphLimits, withFrameworkMigrationPlanVerification,
      Effect.timeoutOrElse({ duration: 15_000, orElse: () => Effect.fail(bindingError("resourceFailure")) })),
    cause => bindingError("resourceFailure", cause),
  );
  // SAFETY: this family is authenticated only by the private registry. The token
  // contains no data and is never recognized as a restored repository capability.
  const token = Object.freeze({}) as PreparedInstallationRuntime;
  states.set(token, state);
  return token;
});

/** Always called inside the host's accepting transaction, after its scope lock.
 * A head or evidence mismatch fails closed; it never refreshes/blesses changed
 * evidence, and never falls back to a previous successful verdict. */
export const acceptPreparedInstallation = Effect.fn("InstallationRuntime.accept")(function* (
  prepared: PreparedInstallationRuntime, target: FrameworkMigrationTarget,
  reference: InstallationBindingReference, tx: FlarexMetadataTransaction,
) {
  const state = states.get(prepared);
  if (state === undefined || state.target !== target || !sameBindingValue(state.reference, reference)) return yield* Effect.fail(bindingError("invalidAuthority"));
  const fingerprint = yield* lockHeadFingerprint(tx, state.installationStorageId);
  if (fingerprint !== state.headFingerprint) return yield* Effect.fail(bindingError("unavailableInstallation"));
  const current = yield* readInstallationEvidence(tx, state.coordinates);
  if (!installationEvidenceMatches(current, state.evidence)) return yield* Effect.fail(bindingError("storedCorruption"));
  return state.data;
});

const lockHeadFingerprint = Effect.fn("InstallationRuntime.lockHead")(function* (
  tx: FlarexMetadataTransaction, installationStorageId: bigint,
) {
  const rows = yield* runDrizzleStatementEffect(tx.select({ fingerprint: installationEvidenceRowDigest(heads) })
    .from(heads).where(eq(heads.installationStorageId, installationStorageId)).limit(1).for("share"), cause => bindingError("resourceFailure", cause));
  const row = rows[0];
  if (row === undefined) return yield* Effect.fail(bindingError("missingDependency"));
  if (typeof row.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.fingerprint)) return yield* Effect.fail(bindingError("storedCorruption"));
  return row.fingerprint;
});
