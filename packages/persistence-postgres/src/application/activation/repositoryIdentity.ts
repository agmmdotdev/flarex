import {
  captureHostPreparationLifetime,
  withoutRetainedHostPreparation,
} from "../../execution/preparation/preparedHostRuntime";
import type {
  LocatedReadCommittedTransactionFailureV1,
} from "../../execution/readCommittedTransactionFailure";
import type { LocatedReadCommittedAttemptTargetV1 } from "../../execution/transactionSessionAttemptKernel";
import type {
  ExactTrustedScopeAuthorityResolutionPorts,
  TrustedScopeAuthorityError,
  TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import type { LockScopeClockForShareError } from "../../scope/scopeClock";
import type { FlarexMetadataDatabase } from "../deployments";
import type { ApplicationReadinessProtection } from "../readiness/contracts";
import type { ReadApplicationReadinessError } from "../readiness/errors";
import type {
  ApplicationActivationRepository,
  ApplicationBindingInput,
  ApplicationBindingSelectionReader,
  ApplicationReadBindingSelectionReader,
  ApplicationRelationActivationRepository,
  ApplicationStandaloneBindingSelectionReader,
  PreparedFiniteActiveApplication,
  PreparedStandaloneApplicationBinding,
} from "./contracts";
import {
  activationError,
  activationFailure,
  type ApplicationActivationError,
  type BindingPreparationError,
} from "./errors";
import {
  closeStandaloneApplicationBindingSelectionReaderIdentity,
  readStandaloneApplicationBindingSelectionReaderState,
} from "./selectionIdentity";
import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

export interface ApplicationActivationRepositoryState {
  readonly readinessKind: "legacy" | "composite";
  readonly readiness: unknown;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly controlDatabase: FlarexMetadataDatabase | undefined;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  > & ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
}

const activationRepositoryStates = new WeakMap<
  object,
  ApplicationActivationRepositoryState
>();

export function readApplicationActivationRepositoryState(repository: ApplicationBindingSelectionReader<unknown>) {
  return activationRepositoryStates.get(repository);
}

export function registerApplicationActivationRepository<SchemaFailure, ColdFailure>(
  repository: ApplicationActivationRepository<SchemaFailure, ColdFailure> | ApplicationRelationActivationRepository<SchemaFailure, ColdFailure>,
  state: ApplicationActivationRepositoryState,
): void {
  activationRepositoryStates.set(repository, state);
}

const finiteActivePreparationReaders = new WeakMap<object, (originalGenerationBinding?: ApplicationBindingInput) => Effect.Effect<PreparedFiniteActiveApplication,
  ReadApplicationReadinessError | ApplicationActivationError | LocatedReadCommittedTransactionFailureV1 |
  TrustedScopeAuthorityError | LockScopeClockForShareError>>();

export const prepareFiniteActiveApplication = Effect.fn("ApplicationActivation.prepareFiniteActive")(
function* (repository: ApplicationActivationRepository<unknown, unknown>, originalGenerationBinding?: ApplicationBindingInput) {
  const prepare = finiteActivePreparationReaders.get(repository);
  if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
  return yield* prepare(originalGenerationBinding);
});

const standaloneBindingPreparationReaders = new WeakMap<object, () => Effect.Effect<PreparedStandaloneApplicationBinding,
  ApplicationActivationError | ReadApplicationReadinessError | TrustedScopeAuthorityError | LockScopeClockForShareError>>();

/** The serving Scope retires its private reader before installed resources close. */
export function closeApplicationStandaloneBindingSelectionReader(reader: ApplicationStandaloneBindingSelectionReader): void {
  closeStandaloneApplicationBindingSelectionReaderIdentity(reader);
  standaloneBindingPreparationReaders.delete(reader);
}

/** Exact indexed publication capture under the existing retained host lease. */
export const prepareStandaloneApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareStandaloneBinding")(
  function* <Failure>(repository: ApplicationReadBindingSelectionReader<Failure>) {
    const prepare = standaloneBindingPreparationReaders.get(repository);
    if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
    return yield* prepare();
  },
);

const bindingPreparationReaders = new WeakMap<object, (profile: "request" | "retained",
  originalGenerationProtection?: ApplicationReadinessProtection) => Effect.Effect<ApplicationBindingInput, BindingPreparationError>>();

export function readApplicationBindingPreparationReader(repository: ApplicationBindingSelectionReader<unknown>) {
  return bindingPreparationReaders.get(repository);
}

export function registerApplicationBindingPreparationReader<SchemaFailure, ColdFailure>(
  repository: ApplicationActivationRepository<SchemaFailure, ColdFailure> | ApplicationRelationActivationRepository<SchemaFailure, ColdFailure>,
  reader: NonNullable<ReturnType<typeof readApplicationBindingPreparationReader>>): void {
  bindingPreparationReaders.set(repository, reader);
}

export function registerStandaloneApplicationBindingPreparationReader(repository: ApplicationReadBindingSelectionReader<unknown>,
  reader: () => Effect.Effect<PreparedStandaloneApplicationBinding,
    ApplicationActivationError | ReadApplicationReadinessError | TrustedScopeAuthorityError | LockScopeClockForShareError>): void {
  standaloneBindingPreparationReaders.set(repository, reader);
}

export function registerFiniteActivePreparationReader<SchemaFailure, ColdFailure>(repository: ApplicationActivationRepository<SchemaFailure, ColdFailure>,
  reader: (originalGenerationBinding?: ApplicationBindingInput) => Effect.Effect<PreparedFiniteActiveApplication,
    ReadApplicationReadinessError | ApplicationActivationError | LocatedReadCommittedTransactionFailureV1 |
    TrustedScopeAuthorityError | LockScopeClockForShareError>): void {
  finiteActivePreparationReaders.set(repository, reader);
}

/** Binding-only consumers construct request evidence; acceptance remains with the business transaction. */
export const prepareApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareBindingSelection")(
  function* <Failure>(repository: ApplicationBindingSelectionReader<Failure>) {
    const prepare = bindingPreparationReaders.get(repository);
    if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
    return yield* withoutRetainedHostPreparation(prepare("request"));
  },
);

/** Host construction captures immutable binding inputs under its existing
 * allocation. Every use still authenticates the live target and binding. */
export const prepareRetainedApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareRetainedBindingSelection")(
  function* <Failure>(repository: ApplicationBindingSelectionReader<Failure>) {
    const prepare = bindingPreparationReaders.get(repository);
    const lifetime = yield* captureHostPreparationLifetime();
    if (prepare === undefined || lifetime === undefined)
      return yield* activationFailure("read", "invalidComposition");
    yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", undefined, false, cause)));
    return yield* prepare("retained");
  },
);

export function hasApplicationBindingComposition<Failure>(repository: ApplicationReadBindingSelectionReader<Failure>,
  authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> |
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>): boolean {
  return activationRepositoryStates.get(repository)?.authority === authority ||
    readStandaloneApplicationBindingSelectionReaderState(repository)?.authority === authority;
}
