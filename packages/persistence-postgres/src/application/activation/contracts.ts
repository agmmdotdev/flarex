import type {
  TrustedScopeAuthority,
  TrustedScopeAuthorityError,
} from "../../scope/scopeAuthorityResolution";
import type {
  LockScopeClockForShareError,
  LockScopeClockForUpdateError,
  ScopeClockRecord,
} from "../../scope/scopeClock";
import type {
  AppSchemaCandidateWriteGuardPlanningHead,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import type { ApplicationReadinessActivationBasis } from "../readiness/contracts";
import type { ReadApplicationReadinessError, SettleApplicationReadinessError } from "../readiness/errors";
import type {
  ApplicationRelationReadinessActivationBasis,
  ReadApplicationRelationReadinessFoldError,
  SettleApplicationRelationReadinessFoldError,
} from "../relations/applicationRelationReadinessFold";
import type {
  ApplicationActivationError,
  CurrentApplicationEntryFailure,
  CurrentApplicationPreparationFailure,
} from "./errors";
import type { Effect, Result, Scope } from "effect";

export interface ApplicationActiveCasToken {
  readonly activationSequence: bigint;
  readonly headSha256: string;
}

export interface ApplicationActivationReceipt {
  readonly status: "activated";
  readonly disposition: "inserted" | "replayed";
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly revisionId: string;
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly readinessSha256: string;
  readonly activationSha256: string;
  readonly activationRequestSha256: string;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly activatedAt: Date;
}

export declare const applicationActiveSelectionBrand: unique symbol;

export interface ApplicationActiveSelection {
  readonly [applicationActiveSelectionBrand]: true;
}

export interface ApplicationActiveSelectionBasis
  extends ApplicationReadinessActivationBasis {
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface CoherentActiveApplication {
  readonly selection: ApplicationActiveSelection;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationActiveSelectionBasis;
}

export interface ApplicationRelationActiveSelectionBasis
  extends ApplicationRelationReadinessActivationBasis {
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export type ApplicationExecutableActiveSelection =
  | Readonly<{
      readonly kind: "legacy";
      readonly basis: ApplicationActiveSelectionBasis;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly basis: ApplicationRelationActiveSelectionBasis;
    }>;

export interface ApplicationRelationActiveSelectionSnapshot {
  readonly authority: TrustedScopeAuthority;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly schemaVersionId: ApplicationRelationActiveSelectionBasis[
    "schemaVersionId"
  ];
  readonly readinessSha256: Uint8Array;
  readonly relationFrontierCommitSeq: string;
  readonly relationSetReadinessSha256: Uint8Array;
  readonly relationCount: number;
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface CoherentActiveRelationApplication {
  readonly selection: ApplicationActiveSelection;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationRelationActiveSelectionSnapshot;
}

export interface ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  readonly activate: (input: {
    readonly revisionId: string;
    readonly expectedActiveHead: ApplicationActiveCasToken | null;
  }) => Effect.Effect<
    ApplicationActivationReceipt,
    | ApplicationActivationError
    | SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
  readonly readActive: () => Effect.Effect<
    CoherentActiveApplication,
    | ApplicationActivationError
    | ReadApplicationReadinessError
    | TrustedScopeAuthorityError
    | LockScopeClockForShareError
  >;
}

export interface ApplicationRelationActivationRepository<
  SchemaFailure,
  ColdFailure,
> {
  readonly activate: (input: {
    readonly revisionId: string;
    readonly expectedActiveHead: ApplicationActiveCasToken | null;
  }) => Effect.Effect<
    ApplicationActivationReceipt,
    | ApplicationActivationError
    | SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    | SettleApplicationRelationReadinessFoldError
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
  readonly readActive: () => Effect.Effect<
    CoherentActiveApplication | CoherentActiveRelationApplication,
    | ApplicationActivationError
    | ReadApplicationReadinessError
    | ReadApplicationRelationReadinessFoldError
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
}

export declare const finiteActivePreparationBrand: unique symbol;

export interface PreparedFiniteActiveApplication {
  readonly [finiteActivePreparationBrand]: true;
}

export const bindingPreparationBrand: unique symbol = Symbol("ApplicationBindingPreparation");

export interface ApplicationBindingPreparation { readonly [bindingPreparationBrand]: true }

export declare const legacyBindingPreparationBrand: unique symbol;

/** Immutable construction evidence; it grants no executable Application selection. */
export interface PreparedApplicationBinding { readonly [legacyBindingPreparationBrand]: true }

export declare const standaloneApplicationBindingBrand: unique symbol;

export interface PreparedStandaloneApplicationBinding { readonly [standaloneApplicationBindingBrand]: true }

export type ApplicationBindingInput = ApplicationActiveSelection | ApplicationBindingPreparation | PreparedApplicationBinding | PreparedStandaloneApplicationBinding;

export declare const standaloneSelectionReaderBrand: unique symbol;

/** Protected standalone selection has no full-proof read or activation method. */
export interface ApplicationStandaloneBindingSelectionReader { readonly [standaloneSelectionReaderBrand]: true }

export type ApplicationReadBindingSelectionReader<Failure> = ApplicationBindingSelectionReader<Failure> | ApplicationStandaloneBindingSelectionReader;

export declare const currentPreparationRefreshBrand: unique symbol;

/** Only its lexical entry owner recognizes this pre-business verdict. */
export interface CurrentApplicationPreparationRefresh { readonly [currentPreparationRefreshBrand]: true }

export declare const currentFiniteEntryBrand: unique symbol;

/** An inert loan from the original generation borrower. Only its native
 * accepting owner can use it; no transaction survives the loan. */
export interface CurrentApplicationFiniteEntry { readonly [currentFiniteEntryBrand]: true }

export interface CurrentApplicationGenerationContext {
  readonly authority: TrustedScopeAuthority;
  readonly planningHead: AppSchemaCandidateWriteGuardPlanningHead | undefined;
}

export interface CurrentApplicationTransactionEntry {
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly checked: CheckedApplicationActiveHead;
}

export type CurrentApplicationEntry = <Value, InstallationFailure, SetupFailure, BusinessFailure, SetupRequirements, BusinessRequirements>(
  tx: AppRowTransaction, requireInstallation: Effect.Effect<void, InstallationFailure>,
  beforeClock: Effect.Effect<void, SetupFailure, SetupRequirements>,
  work: (entry: CurrentApplicationTransactionEntry) => Effect.Effect<Value, BusinessFailure, BusinessRequirements>,
  clockAccess?: "snapshotRead" | "ordinaryWrite" | "update",
) => Effect.Effect<Result.Result<Value, CurrentApplicationPreparationRefresh>,
  InstallationFailure | SetupFailure | BusinessFailure | CurrentApplicationEntryFailure, SetupRequirements | BusinessRequirements>;

export interface CurrentApplicationPreparation<Payload, ConstructionFailure, ConstructionRequirements> {
  readonly acquireFreshFinitePreparation: Effect.Effect<
    Readonly<{ binding: ApplicationBindingInput; payload: Payload }>,
    ConstructionFailure | CurrentApplicationPreparationFailure,
    ConstructionRequirements | Scope.Scope
  >;
  readonly withEntry: <Value, Failure, Requirements>(work: (
    graph: Readonly<{ binding: ApplicationBindingInput; payload: Payload }>, enter: CurrentApplicationEntry,
    finite: CurrentApplicationFiniteEntry,
  ) => Effect.Effect<Result.Result<Value, CurrentApplicationPreparationRefresh>, Failure, Requirements>) =>
    Effect.Effect<Value, Failure | ConstructionFailure | CurrentApplicationPreparationFailure, Requirements | ConstructionRequirements>;
  readonly withFiniteEntry: <Value, Failure, Requirements>(work: (
    graph: Readonly<{ binding: ApplicationBindingInput; payload: Payload }>, entry: CurrentApplicationFiniteEntry,
  ) => Effect.Effect<Value, Failure, Requirements>) =>
    Effect.Effect<Value, Failure | ConstructionFailure | CurrentApplicationPreparationFailure, Requirements | ConstructionRequirements>;
}

export declare const acceptedBindingBrand: unique symbol;

/** Only valid inside the accepting callback; deliberately not an executable selection. */
export interface AcceptedApplicationBinding { readonly [acceptedBindingBrand]: true }

/** A loan from exactly one original issuer. A checked head is not readiness;
 * only full acceptance can produce the callback's AcceptedApplicationBinding. */
export type ApplicationBindingObservation = AcceptedApplicationBinding | CheckedApplicationActiveHead;

export declare const finiteApplicationMetadataBrand: unique symbol;

/** Immutable Application content accepted at entry; live execution authority
 * and the metadata/history reservation remain with the outer attempt owner. */
export interface FiniteApplicationMetadata { readonly [finiteApplicationMetadataBrand]: true }

/** Private identity check for read-only binding composition, including both readiness contracts. */
export interface ApplicationBindingSelectionReader<Failure> {
  readonly readActive: () => Effect.Effect<CoherentActiveApplication | CoherentActiveRelationApplication, Failure>;
}
