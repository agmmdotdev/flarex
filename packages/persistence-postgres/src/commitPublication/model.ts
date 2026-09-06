import { Data } from "effect";
import type { Effect, Result } from "effect";
import type { RelationalPhysicalTable } from "../relationalSchema/physical/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../frameworkSchema/installation/storedMetadataRestoration";

export class PublicationAdmissionError extends Data.TaggedError(
  "PublicationAdmissionError",
)<{
  readonly reason:
    | "invalidReceiptAuthority"
    | "incompleteReceiptSet"
    | "receiptAdmissionClosed"
    | "limitExceeded"
    | "unadmittedFinalization";
}> {}
export const publicationError = (reason: PublicationAdmissionError["reason"]) =>
  new PublicationAdmissionError({ reason });
declare const receiptBrand: unique symbol;
declare const attemptBrand: unique symbol;
declare const sealBrand: unique symbol;
export interface RelationalMutationReceipt {
  readonly [receiptBrand]: true;
}
export interface RelationalMutationAttempt {
  readonly [attemptBrand]: true;
}
export interface PublicationSeal {
  readonly [sealBrand]: true;
}
export type ScalarMutationOperation = "insert" | "update" | "delete";
export interface ReceiptObservation {
  readonly ordinal: number;
  readonly operation: ScalarMutationOperation;
  readonly table: RelationalPhysicalTable["identity"];
  readonly key: string;
  readonly affectedRows: 0 | 1;
}
export interface PublicationPins {
  readonly lifetime: object;
  readonly transaction: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly admission: RestoredFrameworkSchemaAvailabilityHead;
}
export interface MutationRecorder {
  readonly reserve: (
    table: RelationalPhysicalTable,
    operation: ScalarMutationOperation,
    key: string,
  ) => Effect.Effect<RelationalMutationAttempt, PublicationAdmissionError>;
  readonly complete: (
    attempt: RelationalMutationAttempt,
    returnedKeys: readonly string[],
  ) => Effect.Effect<RelationalMutationReceipt, PublicationAdmissionError>;
}
export interface PublicationOwner {
  readonly seal: (
    mutationAttempted: boolean,
  ) => Effect.Effect<PublicationSeal, PublicationAdmissionError>;
  /** Trusted diagnostics: validates real receipt membership, never grants publication. */
  readonly inspect: (
    seal: PublicationSeal,
    candidates?: readonly RelationalMutationReceipt[],
  ) => Effect.Effect<readonly ReceiptObservation[], PublicationAdmissionError>;
  readonly admit: (
    seal: PublicationSeal,
    candidates?: readonly RelationalMutationReceipt[],
  ) => Effect.Effect<void, PublicationAdmissionError>;
  readonly close: Effect.Effect<void>;
  /** Owned copy of token membership for internal refusal tests; no issuer or finalizer reaches commands. */
  readonly receipts: () => readonly RelationalMutationReceipt[];
}
export interface PublicationCollectionInput {
  readonly beforeComplete?: (
    ordinal: number,
  ) => Effect.Effect<void, PublicationAdmissionError>;
  readonly pins: PublicationPins;
  readonly canRecord: () => boolean;
  readonly canSeal: () => boolean;
  readonly onFailure: () => void;
  readonly charge: (
    bytes: number,
  ) => Result.Result<void, PublicationAdmissionError>;
}
/** Source-private fault/observation composition, never a command or package API. */
export interface PublicationTestHooks {
  readonly onCollection?: (owner: PublicationOwner) => void;
  readonly beforeComplete?: PublicationCollectionInput["beforeComplete"];
  readonly beforeAdmission?: (
    owner: PublicationOwner,
    seal: PublicationSeal,
  ) => Effect.Effect<void, PublicationAdmissionError>;
}
export const MAX_RECEIPT_IDENTITY_BYTES = 262_144;
export const MAX_MUTATION_RECEIPTS = 64;
