import type { SessionJournalAttempt } from "../../execution/journal/contracts";
import {
  type captureHostPreparationLifetime,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import type { OriginalApplicationControlRead } from "../readiness/contracts";
import { readApplicationReadinessCapturePorts } from "../readiness/identity";
import type { prepareCapturedApplicationReadiness } from "../readiness/preparation";
import {
  readAcceptedApplicationBindingState,
  requireAcceptedApplicationBindingObservation,
} from "./acceptedBinding";
import type {
  AcceptedApplicationBinding,
  ApplicationActiveSelection,
  ApplicationBindingInput,
  ApplicationExecutableActiveSelection,
  FiniteApplicationMetadata,
  PreparedFiniteActiveApplication,
} from "./contracts";
import { activationError, type ApplicationActivationError } from "./errors";
import {
  claimApplicationExecutableActiveSelection,
  copyRelationSelectionBasis,
  copySelectionBasis,
  isApplicationBindingPreparation,
  isPreparedApplicationBinding,
  isPreparedStandaloneApplicationBinding,
  readApplicationBindingTargetProtection,
  readApplicationSelectionState,
  readLegacyApplicationBindingPreparation,
} from "./selectionIdentity";
import { copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import type { CommitSeq } from "flarex-protocol/storage-authority";

export interface FiniteActivePreparationState {
  readonly repository: object;
  readonly selection: ApplicationActiveSelection;
  readonly schema: AwaitedFiniteSchema;
  readonly originalControl: OriginalApplicationControlRead;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
  readonly originalGenerationBinding: ApplicationBindingInput | undefined;
}

export type AwaitedFiniteSchema = Extract<Effect.Success<ReturnType<typeof prepareCapturedApplicationReadiness>>, { readonly schema: unknown }>["schema"];

const finiteActivePreparations = new WeakMap<PreparedFiniteActiveApplication, FiniteActivePreparationState>();

export function readFiniteActiveApplicationPreparationState(prepared: PreparedFiniteActiveApplication) {
  return finiteActivePreparations.get(prepared);
}

export const issueFiniteActiveApplicationPreparation = Effect.fn(
  function* (state: FiniteActivePreparationState): Effect.fn.Return<PreparedFiniteActiveApplication, ApplicationActivationError> {
    // SAFETY: registry identity binds the exact repository and host construction lifetime.
    const result = Object.freeze({}) as PreparedFiniteActiveApplication;
    finiteActivePreparations.set(result, Object.freeze(state));
    yield* registerHostPreparationDisposal(() => { finiteActivePreparations.delete(result); }).pipe(
      Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, cause)));
    return result;
  },
);

/** Complete detached inspection evidence for the current validator boundary.
 * Internal activation and terminal entry use the narrower projections below. */
export function readPreparedFiniteActiveApplication(prepared: PreparedFiniteActiveApplication) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined) return Result.fail(activationError("read", "invalidComposition"));
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)),
    Result.flatMap(() => claimApplicationExecutableActiveSelection(state.selection)),
    Result.map(claimed => Object.freeze({ claimed: structuredClone(claimed), schema: structuredClone(state.schema) })),
  );
}

/** Mutation construction needs selected executable evidence and schema identity,
 * not another copy of the complete prepared schema. Accepting SQL is still fresh. */
export function readPreparedFiniteApplicationMutationConstruction(prepared: PreparedFiniteActiveApplication) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined) return Result.fail(activationError("read", "invalidComposition"));
  const selected = readApplicationSelectionState(state.selection);
  if (selected?.kind !== "legacy") return Result.fail(activationError("read", "invalidComposition"));
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)),
    Result.map(() => Object.freeze({ basis: structuredClone(selected.basis), schema: Object.freeze({
      schemaVersionId: state.schema.schemaVersionId, applicationSchemaSha256: state.schema.applicationSchemaSha256,
      schemaManifestSha256: state.schema.schemaManifestSha256,
    }) })),
  );
}

/** Construction provenance for routing only. A fresh installed accepting
 * transaction supplies placement and current authority; this lends no lease
 * or permission and avoids copying the complete schema for renewal. */
export function readPreparedFiniteApplicationAuthority(prepared: PreparedFiniteActiveApplication,
  database: FlarexMetadataDatabase) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined || state.originalControl.database !== database)
    return Result.fail(activationError("read", "invalidComposition"));
  const selected = readApplicationSelectionState(state.selection);
  if (selected?.kind !== "legacy") return Result.fail(activationError("read", "invalidComposition"));
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)),
    Result.map(() => Object.freeze({ ...selected.basis.authority,
      physicalLocator: Object.freeze({ ...selected.basis.authority.physicalLocator }) })));
}

/** Only this issuer and original database may project terminal construction
 * evidence. Mutable bytes stay private; decoded immutable schema is lent to
 * the trusted entry owner and detached at its execution/inspection boundary. */
export function readPreparedFiniteApplicationTerminalProjection<Failure>(prepared: PreparedFiniteActiveApplication,
  database: FlarexMetadataDatabase, functionPath: string, admitSizes: (sizes: Readonly<{
    manifestJsonByteLengthText: string; manifestCanonicalByteLengthText: string; schemaBindingByteLengthText: string;
  }>) => Result.Result<void, Failure>) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined || state.originalControl.database !== database)
    return Result.fail(activationError("read", "invalidComposition"));
  const selected = readApplicationSelectionState(state.selection);
  if (selected?.kind !== "legacy" || selected.finitePreparation === undefined)
    return Result.fail(activationError("read", "invalidComposition"));
  const schema = selected.finitePreparation.schema;
  return Result.gen(function* () {
    yield* readApplicationBindingTargetProtection(state.selection);
    const { artifact, schemaAuthority } = state.originalControl;
    yield* admitSizes(Object.freeze({ manifestJsonByteLengthText: artifact.sizes.manifestJsonByteLengthText,
      manifestCanonicalByteLengthText: artifact.sizes.manifestCanonicalByteLengthText,
      schemaBindingByteLengthText: schemaAuthority.schemaBindingByteLengthText }));
    const basis = selected.basis, binding = schemaAuthority.row;
    return Object.freeze({ basis: Object.freeze({ deploymentId: basis.deploymentId, scopeId: basis.authority.scopeId,
      schemaVersionId: basis.schemaVersionId, revisionId: basis.revisionId,
      functionDeclared: basis.manifest.functions.some(fn => fn.path === functionPath),
      applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256), schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
      schemaBindingSha256: copyBytes(basis.schemaBindingSha256) }), schemaVersion: state.schema.schemaVersion,
      artifact: Object.freeze({ sizes: Object.freeze({ deploymentId: artifact.sizes.deploymentId,
        schemaVersionId: artifact.sizes.schemaVersionId, version: artifact.sizes.version,
        manifestCodecVersion: artifact.sizes.manifestCodecVersion, manifestSha256: copyBytes(artifact.sizes.manifestSha256),
        manifestCanonicalByteLengthText: artifact.sizes.manifestCanonicalByteLengthText }),
        payload: artifact.payload === null ? null : Object.freeze({ manifestCodecVersion: artifact.payload.manifestCodecVersion,
          manifestByteLength: artifact.payload.manifestBytes.byteLength }) }),
      binding: Object.freeze({ status: binding.status, deploymentId: binding.deploymentId, schemaVersionId: binding.schemaVersionId,
        schemaVersion: binding.schemaVersion, applicationSchemaSha256: copyBytes(binding.applicationSchemaSha256),
        schemaManifestSha256: binding.schemaManifestSha256 === null ? null : copyBytes(binding.schemaManifestSha256),
        bindingSha256: binding.bindingSha256 === null ? null : copyBytes(binding.bindingSha256),
        bindingByteLength: binding.bindingBytes?.byteLength ?? null }),
      schemaBindingByteLengthText: schemaAuthority.schemaBindingByteLengthText, schema });
  });
}

/** A lent finite projection remains tied to this exact original selection and
 * its host lifetime. Copying either inert handle never supplies that identity. */
export function requirePreparedFiniteApplicationSelection(prepared: PreparedFiniteActiveApplication,
  selection: ApplicationActiveSelection) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined || state.selection !== selection)
    return Result.fail(activationError("read", "invalidComposition"));
  return readApplicationBindingTargetProtection(selection).pipe(Result.map(() => undefined));
}

/** Only the original preparation lends detached immutable control evidence.
 * Database identity and the existing host lifetime remain with its issuer. */
export function readPreparedFiniteApplicationOriginalControl<Failure>(prepared: PreparedFiniteActiveApplication,
  database: FlarexMetadataDatabase, admitSizes: (sizes: Readonly<{
    manifestJsonByteLengthText: string; manifestCanonicalByteLengthText: string;
    schemaBindingByteLengthText: string;
  }>) => Result.Result<void, Failure>) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined || state.originalControl.database !== database)
    return Result.fail(activationError("read", "invalidComposition"));
  return Result.gen(function* () {
    yield* (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
      Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)));
    const claimed = yield* claimApplicationExecutableActiveSelection(state.selection);
    if (claimed.kind !== "legacy") return yield* Result.fail(activationError("read", "invalidComposition"));
    // The terminal owner admits only scalar sizes before any detached payload copy.
    yield* admitSizes(Object.freeze({
      manifestJsonByteLengthText: state.originalControl.artifact.sizes.manifestJsonByteLengthText,
      manifestCanonicalByteLengthText: state.originalControl.artifact.sizes.manifestCanonicalByteLengthText,
      schemaBindingByteLengthText: state.originalControl.schemaAuthority.schemaBindingByteLengthText,
    }));
    return Object.freeze({ basis: structuredClone(claimed.basis), schemaVersion: state.schema.schemaVersion,
      original: structuredClone({
      artifact: state.originalControl.artifact, schemaAuthority: state.originalControl.schemaAuthority,
    }) });
  });
}

const finiteApplicationMetadata = new WeakMap<FiniteApplicationMetadata, Readonly<{
  selection: ApplicationBindingInput;
  root: SessionJournalAttempt;
  snapshotCommitSeq: CommitSeq;
  validated: ApplicationExecutableActiveSelection;
  captureProjection: ReturnType<typeof projectFiniteApplicationCaptureMetadata>;
}>>();

/** Scalar storage mechanics belong to the original metadata issuer. They
 * contain no mutable bytes, catalog objects or live authority verdict. */
export function projectFiniteApplicationCaptureMetadata(basis: ApplicationExecutableActiveSelection["basis"]) {
  return Object.freeze({ deploymentId: basis.deploymentId, schemaVersionId: basis.schemaVersionId,
    activationSequence: basis.activationSequence.toString(), headSha256: encodeBytesToLowercaseHex(basis.headSha256),
    activationSha256: encodeBytesToLowercaseHex(basis.activationSha256),
    manifestSha256: encodeBytesToLowercaseHex(basis.schemaManifestSha256) });
}

export function captureFiniteApplicationMetadata(binding: AcceptedApplicationBinding,
  selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord,
  root: SessionJournalAttempt, snapshotCommitSeq: CommitSeq) {
  return Result.gen(function* () {
    yield* requireAcceptedApplicationBindingObservation(binding, selection, tx, clock);
    const accepted = readAcceptedApplicationBindingState(binding);
    if (accepted === undefined || snapshotCommitSeq > clock.lastCommitSeq || snapshotCommitSeq < clock.oldestAvailableCommitSeq)
      return yield* Result.fail(activationError("validateSelection", "invalidComposition"));
    // SAFETY: the entry owner alone captures this inert nominal carrier from
    // a live authenticated issuer; no caller-authored metadata is accepted.
    const metadata = Object.freeze({}) as FiniteApplicationMetadata;
    finiteApplicationMetadata.set(metadata, Object.freeze({ selection, root, snapshotCommitSeq,
      captureProjection: projectFiniteApplicationCaptureMetadata(accepted.validated.basis),
      validated: accepted.validated.kind === "legacy"
        ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(accepted.validated.basis) })
        : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(accepted.validated.basis) }) }));
    return metadata;
  });
}

/** Entry projection derives from this genuine immutable content, never a new active-head observation. */
export function readCapturedFiniteApplicationMetadata(metadata: FiniteApplicationMetadata, root: SessionJournalAttempt) {
  const state = finiteApplicationMetadata.get(metadata);
  if (state === undefined || state.root !== root) return Result.fail(activationError("validateSelection", "invalidComposition"));
  return readApplicationBindingTargetProtection(state.selection).pipe(Result.map(() => state.validated.kind === "legacy"
    ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.validated.basis) })
    : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(state.validated.basis) })));
}

/** Borrow the issuer's immutable storage projection only while the original
 * root and preparation remain authentic and open. The detached public reader
 * above keeps its distinct byte/catalog ownership contract. */
export function readFiniteApplicationStorageCaptureMetadata(metadata: FiniteApplicationMetadata, root: SessionJournalAttempt) {
  const state = finiteApplicationMetadata.get(metadata);
  if (state === undefined || state.root !== root) return Result.fail(activationError("validateSelection", "invalidComposition"));
  return readApplicationBindingTargetProtection(state.selection).pipe(Result.map(() => state.captureProjection));
}

/** Fresh compatibility placement reuses the original entry's genuine issuer. */
export function readFiniteApplicationCapturePorts(metadata: FiniteApplicationMetadata, root: SessionJournalAttempt):
  Result.Result<Result.Result.Success<ReturnType<typeof readApplicationReadinessCapturePorts>>, ApplicationActivationError> {
  const captured = finiteApplicationMetadata.get(metadata);
  // SAFETY: the exact issuer registry authenticates either opaque binding form.
  const selected = captured === undefined ? undefined : readLegacyApplicationBindingPreparation(captured.selection) ??
    readApplicationSelectionState(captured.selection as ApplicationActiveSelection);
  if (captured === undefined || captured.root !== root || selected?.kind !== "legacy")
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  return readApplicationReadinessCapturePorts(selected.readinessRepository, selected.readiness).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", undefined, false, cause)));
}

/** Exact captured root identity and the original preparation lifetime remain mandatory. */
export function readPreparedFiniteApplicationMetadataProjections(metadata: FiniteApplicationMetadata, root: SessionJournalAttempt) {
  const state = finiteApplicationMetadata.get(metadata);
  if (state === undefined || state.root !== root || isApplicationBindingPreparation(state.selection) ||
    isPreparedApplicationBinding(state.selection) || isPreparedStandaloneApplicationBinding(state.selection))
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  const selected = readApplicationSelectionState(state.selection);
  if (selected?.kind !== "legacy" || selected.finitePreparation === undefined)
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  const projections = selected.finitePreparation;
  return readApplicationBindingTargetProtection(state.selection).pipe(Result.map(() => projections));
}

/** Lend genuine catalogue capabilities only from the exact admitted Application
 * selection/root and its still-open bounded preparation lifetime. */
export function readPreparedFiniteApplicationPublicationDefinitions(metadata: FiniteApplicationMetadata,
  application: ApplicationBindingInput, root: SessionJournalAttempt) {
  const state = finiteApplicationMetadata.get(metadata);
  if (state === undefined || state.root !== root || state.selection !== application ||
    isApplicationBindingPreparation(state.selection) || isPreparedApplicationBinding(state.selection) ||
    isPreparedStandaloneApplicationBinding(state.selection))
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  const selected = readApplicationSelectionState(state.selection);
  if (selected?.kind !== "legacy" || selected.finitePreparation === undefined)
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  return readApplicationBindingTargetProtection(state.selection).pipe(
    Result.map(() => selected.finitePreparation!.publicationDefinitions));
}

/** Immutable selector for the outer reservation; no checked head escapes. */
export function inspectFiniteApplicationMetadata(metadata: FiniteApplicationMetadata, root: SessionJournalAttempt) {
  const state = finiteApplicationMetadata.get(metadata);
  if (state === undefined || state.root !== root) return null;
  const basis = state.validated.basis;
  return Object.freeze({ revisionId: basis.revisionId, activationSequence: basis.activationSequence.toString(),
    headSha256: encodeBytesToLowercaseHex(basis.headSha256), activationSha256: encodeBytesToLowercaseHex(basis.activationSha256),
    schemaVersionId: basis.schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(basis.schemaManifestSha256) });
}
