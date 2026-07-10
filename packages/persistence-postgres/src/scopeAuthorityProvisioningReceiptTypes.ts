import type {
  ScopeEpoch,
  ScopeId,
} from "flarex-protocol/storage-authority";

import type { SplitScopePhysicalLocator } from "./scopeMetadataTypes";

export const SplitScopeAuthorityProvisioningProtocolVersions = {
  v1: "split_scope_authority_v1",
} as const satisfies Readonly<Record<string, string>>;

export type SplitScopeAuthorityProvisioningProtocolVersion =
  (typeof SplitScopeAuthorityProvisioningProtocolVersions)[keyof typeof SplitScopeAuthorityProvisioningProtocolVersions];

export const SplitScopeAuthorityProvisioningStates = {
  reserved: "reserved",
  ready: "ready",
} as const satisfies Readonly<Record<string, string>>;

export type SplitScopeAuthorityProvisioningState =
  (typeof SplitScopeAuthorityProvisioningStates)[keyof typeof SplitScopeAuthorityProvisioningStates];

export interface SplitScopeAuthorityProvisioningReceiptIdentity {
  readonly scopeId: ScopeId;
  readonly protocolVersion: SplitScopeAuthorityProvisioningProtocolVersion;
  readonly physicalLocator: SplitScopePhysicalLocator;
  readonly initialEpoch: ScopeEpoch;
}

interface SplitScopeAuthorityProvisioningReceiptBase
  extends SplitScopeAuthorityProvisioningReceiptIdentity {
  readonly reservedAt: Date;
}

export interface ReservedSplitScopeAuthorityProvisioningReceipt
  extends SplitScopeAuthorityProvisioningReceiptBase {
  readonly state: "reserved";
  readonly readyAt: null;
}

export interface ReadySplitScopeAuthorityProvisioningReceipt
  extends SplitScopeAuthorityProvisioningReceiptBase {
  readonly state: "ready";
  readonly readyAt: Date;
}

export type SplitScopeAuthorityProvisioningReceipt =
  | ReservedSplitScopeAuthorityProvisioningReceipt
  | ReadySplitScopeAuthorityProvisioningReceipt;

export interface ReserveSplitScopeAuthorityProvisioningReceiptInput {
  readonly scopeId: ScopeId;
  readonly physicalLocator: SplitScopePhysicalLocator;
  readonly candidateInitialEpoch: ScopeEpoch;
}

export interface PublishSplitScopeAuthorityReadyInput {
  readonly expected: SplitScopeAuthorityProvisioningReceiptIdentity;
}

export const ReserveSplitScopeAuthorityProvisioningReceiptStatuses = {
  createdReserved: "created_reserved",
  alreadyReserved: "already_reserved",
  alreadyReady: "already_ready",
} as const satisfies Readonly<Record<string, string>>;

export type ReserveSplitScopeAuthorityProvisioningReceiptResult =
  | {
      readonly status: "created_reserved" | "already_reserved";
      readonly receipt: ReservedSplitScopeAuthorityProvisioningReceipt;
    }
  | {
      readonly status: "already_ready";
      readonly receipt: ReadySplitScopeAuthorityProvisioningReceipt;
    };

export const PublishSplitScopeAuthorityReadyStatuses = {
  publishedReady: "published_ready",
  alreadyReady: "already_ready",
} as const satisfies Readonly<Record<string, string>>;

export interface PublishSplitScopeAuthorityReadyResult {
  readonly status:
    | "published_ready"
    | "already_ready";
  readonly receipt: ReadySplitScopeAuthorityProvisioningReceipt;
}
