import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";

export interface DecodedApplicationActiveHeadBase {
  readonly evidenceByteLength: number;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly writePolicySetSha256: string | null;
  readonly writeOwnershipSha256: string | null;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export type DecodedApplicationActiveHead =
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2 | 3;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

export interface DecodedApplicationActivationBase {
  readonly evidenceByteLength: number;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly writePolicySetSha256: string | null;
  readonly writeOwnershipSha256: string | null;
  readonly activationRequestSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly activatedAt: Date;
}

export type DecodedApplicationActivation =
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2 | 3;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

export interface CoherentApplicationActiveHead {
  readonly head: DecodedApplicationActiveHead;
  readonly activation: DecodedApplicationActivation;
}

declare const checkedActiveHeadBrand: unique symbol;

/** A locked head observation. The original issuer records whether complete
 * activation coherence has been established; this handle alone is not readiness. */
export interface CheckedApplicationActiveHead {
  readonly [checkedActiveHeadBrand]: true;
}

declare const preparedHeadStructureBrand: unique symbol;

export interface PreparedApplicationActiveHeadStructure { readonly [preparedHeadStructureBrand]: true }
