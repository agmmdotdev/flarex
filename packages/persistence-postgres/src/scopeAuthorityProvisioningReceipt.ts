import { and, eq, sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { getScopeMetadata } from "./scopeMetadata";
import type {
  ScopeMetadataRecord,
} from "./scopeMetadata";
import {
  PublishSplitScopeAuthorityReadyStatuses,
  ReserveSplitScopeAuthorityProvisioningReceiptStatuses,
  SplitScopeAuthorityProvisioningProtocolVersions,
  SplitScopeAuthorityProvisioningStates,
  type PublishSplitScopeAuthorityReadyInput,
  type PublishSplitScopeAuthorityReadyResult,
  type ReadySplitScopeAuthorityProvisioningReceipt,
  type ReserveSplitScopeAuthorityProvisioningReceiptInput,
  type ReserveSplitScopeAuthorityProvisioningReceiptResult,
  type ReservedSplitScopeAuthorityProvisioningReceipt,
  type SplitScopeAuthorityProvisioningReceipt,
  type SplitScopeAuthorityProvisioningReceiptIdentity,
  type SplitScopeAuthorityProvisioningProtocolVersion,
} from "./scopeAuthorityProvisioningReceiptTypes";
import {
  fxControlScopeProvisioning,
  fxControlScopes,
} from "./schema";
import type { SplitScopePhysicalLocator } from "./scopeMetadataTypes";

export type ScopeAuthorityProvisioningReceiptConflict =
  | {
      readonly reason: "scopeMissing";
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "scopePlacementMismatch";
      readonly scopeId: ScopeId;
      readonly expected: SplitScopePhysicalLocator;
      readonly actual: ScopeMetadataRecord["physicalLocator"];
    }
  | {
      readonly reason: "receiptMissingForReady";
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "receiptProtocolVersionMismatch";
      readonly scopeId: ScopeId;
      readonly expected: SplitScopeAuthorityProvisioningProtocolVersion;
      readonly actual: SplitScopeAuthorityProvisioningProtocolVersion;
    }
  | {
      readonly reason: "receiptPlacementMismatch";
      readonly scopeId: ScopeId;
      readonly expected: SplitScopePhysicalLocator;
      readonly actual: SplitScopePhysicalLocator;
    }
  | {
      readonly reason: "receiptInitialEpochMismatch";
      readonly scopeId: ScopeId;
      readonly expected: ScopeEpoch;
      readonly actual: ScopeEpoch;
    };

export class ScopeAuthorityProvisioningReceiptConflictError extends Error {
  constructor(readonly conflict: ScopeAuthorityProvisioningReceiptConflict) {
    super(scopeAuthorityProvisioningReceiptConflictMessage(conflict));
    this.name = "ScopeAuthorityProvisioningReceiptConflictError";
  }
}

export type InvalidScopeAuthorityProvisioningReceiptInputField =
  | "scopeId"
  | "physicalLocator.databaseKey"
  | "physicalLocator.schemaName"
  | "candidateInitialEpoch"
  | "initialEpoch";

export class InvalidScopeAuthorityProvisioningReceiptInputError extends Error {
  constructor(
    readonly field: InvalidScopeAuthorityProvisioningReceiptInputField,
  ) {
    super(
      `Scope authority provisioning receipt ${field} must contain a non-whitespace character`,
    );
    this.name = "InvalidScopeAuthorityProvisioningReceiptInputError";
  }
}

export class UnsupportedSplitScopeAuthorityProvisioningTopologyError extends Error {
  constructor(readonly kind: string) {
    super(
      `Split scope authority provisioning supports schema_per_scope or database_per_scope, not ${kind}`,
    );
    this.name = "UnsupportedSplitScopeAuthorityProvisioningTopologyError";
  }
}

export class UnsupportedScopeAuthorityProvisioningProtocolVersionError extends Error {
  constructor(readonly protocolVersion: string) {
    super(
      `Unsupported split scope authority provisioning protocol version: ${protocolVersion}`,
    );
    this.name =
      "UnsupportedScopeAuthorityProvisioningProtocolVersionError";
  }
}

export class ScopeAuthorityProvisioningReceiptCorruptionError extends Error {
  constructor(
    readonly scopeId: string,
    readonly reason: string,
  ) {
    super(
      `Scope authority provisioning receipt ${scopeId} is invalid: ${reason}`,
    );
    this.name = "ScopeAuthorityProvisioningReceiptCorruptionError";
  }
}

/**
 * Reads control-plane provisioning evidence. A ready receipt is historical
 * publication evidence, not the current located scope clock.
 */
export async function getScopeAuthorityProvisioningReceipt(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<SplitScopeAuthorityProvisioningReceipt | null> {
  const rows = await db
    .select()
    .from(fxControlScopeProvisioning)
    .where(eq(fxControlScopeProvisioning.scopeId, scopeId))
    .limit(1);
  const receipt = rows[0];
  return receipt === undefined
    ? null
    : decodeScopeAuthorityProvisioningReceipt(receipt);
}

/**
 * C3b1-only reservation primitive. The caller must already own the short
 * control transaction that created or verified fx_control_scope. A losing
 * candidate epoch is deliberately discarded in favor of the persisted winner.
 */
export async function reserveScopeAuthorityProvisioningReceiptInTransaction(
  tx: ScopeAuthorityProvisioningReceiptTransaction,
  input: ReserveSplitScopeAuthorityProvisioningReceiptInput,
): Promise<ReserveSplitScopeAuthorityProvisioningReceiptResult> {
  requireNonBlankInput(input.scopeId, "scopeId");
  requireNonBlankInput(
    input.candidateInitialEpoch,
    "candidateInitialEpoch",
  );
  const physicalLocator = captureSplitScopePhysicalLocator(
    input.physicalLocator,
  );
  await lockAndRequireScopePlacement(tx, input.scopeId, physicalLocator);

  const existing = await lockReceiptForUpdate(tx, input.scopeId);
  if (existing !== null) {
    requireReceiptPlacement(existing, physicalLocator);
    return reserveReplayResult(existing);
  }

  const inserted = await tx
    .insert(fxControlScopeProvisioning)
    .values({
      scopeId: input.scopeId,
      protocolVersion:
        SplitScopeAuthorityProvisioningProtocolVersions.v1,
      state: SplitScopeAuthorityProvisioningStates.reserved,
      physicalLocator,
      initialEpoch: input.candidateInitialEpoch,
    })
    .onConflictDoNothing({ target: fxControlScopeProvisioning.scopeId })
    .returning();
  const insertedReceipt = inserted[0];
  if (insertedReceipt !== undefined) {
    const receipt = decodeScopeAuthorityProvisioningReceipt(insertedReceipt);
    if (receipt.state !== SplitScopeAuthorityProvisioningStates.reserved) {
      throw new ScopeAuthorityProvisioningReceiptCorruptionError(
        receipt.scopeId,
        "a newly inserted reservation is not reserved",
      );
    }
    return {
      status:
        ReserveSplitScopeAuthorityProvisioningReceiptStatuses.createdReserved,
      receipt,
    };
  }

  const winner = await lockReceiptForUpdate(tx, input.scopeId);
  if (winner === null) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      input.scopeId,
      "the concurrent reservation winner disappeared",
    );
  }
  requireReceiptPlacement(winner, physicalLocator);
  return reserveReplayResult(winner);
}

/**
 * C3b1-only final control-plane CAS. Located target preparation and validation
 * must have completed before the caller opens this short transaction.
 */
export async function publishScopeAuthorityReadyInTransaction(
  tx: ScopeAuthorityProvisioningReceiptTransaction,
  input: PublishSplitScopeAuthorityReadyInput,
): Promise<PublishSplitScopeAuthorityReadyResult> {
  const expected = captureExpectedReceiptIdentity(input.expected);
  await lockAndRequireScopePlacement(
    tx,
    expected.scopeId,
    expected.physicalLocator,
  );

  const existing = await lockReceiptForUpdate(tx, expected.scopeId);
  if (existing === null) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "receiptMissingForReady",
      scopeId: expected.scopeId,
    });
  }
  requireReceiptIdentity(existing, expected);
  if (existing.state === SplitScopeAuthorityProvisioningStates.ready) {
    return {
      status: PublishSplitScopeAuthorityReadyStatuses.alreadyReady,
      receipt: existing,
    };
  }

  const updated = await tx
    .update(fxControlScopeProvisioning)
    .set({
      state: SplitScopeAuthorityProvisioningStates.ready,
      readyAt: sql`now()`,
    })
    .where(
      and(
        eq(fxControlScopeProvisioning.scopeId, expected.scopeId),
        eq(
          fxControlScopeProvisioning.protocolVersion,
          expected.protocolVersion,
        ),
        eq(
          fxControlScopeProvisioning.state,
          SplitScopeAuthorityProvisioningStates.reserved,
        ),
        eq(
          fxControlScopeProvisioning.physicalLocator,
          expected.physicalLocator,
        ),
        eq(
          fxControlScopeProvisioning.initialEpoch,
          expected.initialEpoch,
        ),
      ),
    )
    .returning();
  const updatedRow = updated[0];
  if (updatedRow !== undefined) {
    const receipt = requireReadyReceipt(
      decodeScopeAuthorityProvisioningReceipt(updatedRow),
    );
    return {
      status: PublishSplitScopeAuthorityReadyStatuses.publishedReady,
      receipt,
    };
  }

  const winner = await lockReceiptForUpdate(tx, expected.scopeId);
  if (winner === null) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "receiptMissingForReady",
      scopeId: expected.scopeId,
    });
  }
  requireReceiptIdentity(winner, expected);
  if (winner.state === SplitScopeAuthorityProvisioningStates.ready) {
    return {
      status: PublishSplitScopeAuthorityReadyStatuses.alreadyReady,
      receipt: winner,
    };
  }
  throw new ScopeAuthorityProvisioningReceiptCorruptionError(
    expected.scopeId,
    "the exact reserved-to-ready compare-and-set changed no row",
  );
}

export type ScopeAuthorityProvisioningReceiptTransaction =
  FlarexMetadataDatabase & {
    rollback(): never;
    setTransaction(config: PgTransactionConfig): Promise<void>;
  };

type ScopeAuthorityProvisioningReceiptRow =
  typeof fxControlScopeProvisioning.$inferSelect;

async function lockAndRequireScopePlacement(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
  expected: SplitScopePhysicalLocator,
): Promise<void> {
  const lockedRows = await tx
    .select({ scopeId: fxControlScopes.scopeId })
    .from(fxControlScopes)
    .where(eq(fxControlScopes.scopeId, scopeId))
    .limit(1)
    .for("share");
  if (lockedRows[0] === undefined) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "scopeMissing",
      scopeId,
    });
  }

  const scope = await getScopeMetadata(tx, scopeId);
  if (scope === null) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "scopeMissing",
      scopeId,
    });
  }
  if (!physicalLocatorsEqual(scope.physicalLocator, expected)) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "scopePlacementMismatch",
      scopeId,
      expected,
      actual: scope.physicalLocator,
    });
  }
}

async function lockReceiptForUpdate(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<SplitScopeAuthorityProvisioningReceipt | null> {
  const rows = await tx
    .select()
    .from(fxControlScopeProvisioning)
    .where(eq(fxControlScopeProvisioning.scopeId, scopeId))
    .limit(1)
    .for("update");
  const receipt = rows[0];
  return receipt === undefined
    ? null
    : decodeScopeAuthorityProvisioningReceipt(receipt);
}

function reserveReplayResult(
  receipt: SplitScopeAuthorityProvisioningReceipt,
): ReserveSplitScopeAuthorityProvisioningReceiptResult {
  switch (receipt.state) {
    case "reserved":
      return {
        status:
          ReserveSplitScopeAuthorityProvisioningReceiptStatuses.alreadyReserved,
        receipt,
      };
    case "ready":
      return {
        status:
          ReserveSplitScopeAuthorityProvisioningReceiptStatuses.alreadyReady,
        receipt,
      };
  }
}

function captureExpectedReceiptIdentity(
  expected: SplitScopeAuthorityProvisioningReceiptIdentity,
): SplitScopeAuthorityProvisioningReceiptIdentity {
  requireNonBlankInput(expected.scopeId, "scopeId");
  requireNonBlankInput(expected.initialEpoch, "initialEpoch");
  if (
    expected.protocolVersion !==
    SplitScopeAuthorityProvisioningProtocolVersions.v1
  ) {
    throw new UnsupportedScopeAuthorityProvisioningProtocolVersionError(
      String(expected.protocolVersion),
    );
  }
  return {
    scopeId: expected.scopeId,
    protocolVersion:
      SplitScopeAuthorityProvisioningProtocolVersions.v1,
    physicalLocator: captureSplitScopePhysicalLocator(
      expected.physicalLocator,
    ),
    initialEpoch: expected.initialEpoch,
  } satisfies SplitScopeAuthorityProvisioningReceiptIdentity;
}

function requireReceiptIdentity(
  actual: SplitScopeAuthorityProvisioningReceipt,
  expected: SplitScopeAuthorityProvisioningReceiptIdentity,
): void {
  if (actual.protocolVersion !== expected.protocolVersion) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "receiptProtocolVersionMismatch",
      scopeId: expected.scopeId,
      expected: expected.protocolVersion,
      actual: actual.protocolVersion,
    });
  }
  requireReceiptPlacement(actual, expected.physicalLocator);
  if (actual.initialEpoch !== expected.initialEpoch) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "receiptInitialEpochMismatch",
      scopeId: expected.scopeId,
      expected: expected.initialEpoch,
      actual: actual.initialEpoch,
    });
  }
}

function requireReceiptPlacement(
  receipt: SplitScopeAuthorityProvisioningReceipt,
  expected: SplitScopePhysicalLocator,
): void {
  if (!physicalLocatorsEqual(receipt.physicalLocator, expected)) {
    throw new ScopeAuthorityProvisioningReceiptConflictError({
      reason: "receiptPlacementMismatch",
      scopeId: receipt.scopeId,
      expected,
      actual: receipt.physicalLocator,
    });
  }
}

function requireReadyReceipt(
  receipt: SplitScopeAuthorityProvisioningReceipt,
): ReadySplitScopeAuthorityProvisioningReceipt {
  if (receipt.state !== SplitScopeAuthorityProvisioningStates.ready) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      receipt.scopeId,
      "ready publication returned a non-ready receipt",
    );
  }
  return receipt;
}

function decodeScopeAuthorityProvisioningReceipt(
  row: ScopeAuthorityProvisioningReceiptRow,
): SplitScopeAuthorityProvisioningReceipt {
  if (row.scopeId.trim().length === 0) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      row.scopeId,
      "scope ID is empty",
    );
  }
  if (
    row.protocolVersion !==
    SplitScopeAuthorityProvisioningProtocolVersions.v1
  ) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      row.scopeId,
      "protocol version is unsupported",
    );
  }
  if (row.initialEpoch.trim().length === 0) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      row.scopeId,
      "initial epoch is empty",
    );
  }
  requireValidDate(row.scopeId, row.reservedAt, "reserved timestamp");
  const scopeId = ScopeIdSchema.make(row.scopeId);
  const base = {
    scopeId,
    protocolVersion:
      SplitScopeAuthorityProvisioningProtocolVersions.v1,
    physicalLocator: decodeSplitScopePhysicalLocator(
      row.physicalLocator,
      row.scopeId,
    ),
    initialEpoch: ScopeEpochSchema.make(row.initialEpoch),
    reservedAt: row.reservedAt,
  } satisfies Omit<
    ReservedSplitScopeAuthorityProvisioningReceipt,
    "state" | "readyAt"
  >;

  switch (row.state) {
    case "reserved":
      if (row.readyAt !== null) {
        throw new ScopeAuthorityProvisioningReceiptCorruptionError(
          row.scopeId,
          "a reserved receipt has a ready timestamp",
        );
      }
      return {
        ...base,
        state: SplitScopeAuthorityProvisioningStates.reserved,
        readyAt: null,
      } satisfies ReservedSplitScopeAuthorityProvisioningReceipt;
    case "ready":
      if (row.readyAt === null) {
        throw new ScopeAuthorityProvisioningReceiptCorruptionError(
          row.scopeId,
          "a ready receipt has no ready timestamp",
        );
      }
      requireValidDate(row.scopeId, row.readyAt, "ready timestamp");
      if (row.readyAt.getTime() < row.reservedAt.getTime()) {
        throw new ScopeAuthorityProvisioningReceiptCorruptionError(
          row.scopeId,
          "ready timestamp precedes the reservation timestamp",
        );
      }
      return {
        ...base,
        state: SplitScopeAuthorityProvisioningStates.ready,
        readyAt: row.readyAt,
      } satisfies ReadySplitScopeAuthorityProvisioningReceipt;
    default:
      throw new ScopeAuthorityProvisioningReceiptCorruptionError(
        row.scopeId,
        "state is unsupported",
      );
  }
}

function captureSplitScopePhysicalLocator(
  locator: SplitScopePhysicalLocator,
): SplitScopePhysicalLocator {
  const kind: string = locator.kind;
  if (kind !== "schema_per_scope" && kind !== "database_per_scope") {
    throw new UnsupportedSplitScopeAuthorityProvisioningTopologyError(kind);
  }
  requireNonBlankInput(
    locator.databaseKey,
    "physicalLocator.databaseKey",
  );
  requireNonBlankInput(locator.schemaName, "physicalLocator.schemaName");

  switch (kind) {
    case "schema_per_scope":
      return Object.freeze({
        kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
    case "database_per_scope":
      return Object.freeze({
        kind,
        databaseKey: locator.databaseKey,
        schemaName: locator.schemaName,
      });
  }
}

function decodeSplitScopePhysicalLocator(
  value: unknown,
  scopeId: string,
): SplitScopePhysicalLocator {
  if (!isJsonObject(value)) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      scopeId,
      "physical locator is not an object",
    );
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("kind") ||
    !keys.includes("databaseKey") ||
    !keys.includes("schemaName")
  ) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      scopeId,
      "physical locator must contain only kind, databaseKey, and schemaName",
    );
  }
  if (
    typeof value.databaseKey !== "string" ||
    value.databaseKey.trim().length === 0 ||
    typeof value.schemaName !== "string" ||
    value.schemaName.trim().length === 0
  ) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      scopeId,
      "physical locator databaseKey and schemaName must be non-empty strings",
    );
  }

  switch (value.kind) {
    case "schema_per_scope":
      return {
        kind: value.kind,
        databaseKey: value.databaseKey,
        schemaName: value.schemaName,
      };
    case "database_per_scope":
      return {
        kind: value.kind,
        databaseKey: value.databaseKey,
        schemaName: value.schemaName,
      };
    default:
      throw new ScopeAuthorityProvisioningReceiptCorruptionError(
        scopeId,
        "physical locator is not a supported split placement",
      );
  }
}

function physicalLocatorsEqual(
  left: ScopeMetadataRecord["physicalLocator"],
  right: SplitScopePhysicalLocator,
): boolean {
  return (
    left.kind === right.kind &&
    left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName
  );
}

function requireValidDate(
  scopeId: string,
  value: Date,
  field: string,
): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      scopeId,
      `${field} is invalid`,
    );
  }
}

function requireNonBlankInput(
  value: string,
  field: InvalidScopeAuthorityProvisioningReceiptInputField,
): void {
  if (value.trim().length === 0) {
    throw new InvalidScopeAuthorityProvisioningReceiptInputError(field);
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeAuthorityProvisioningReceiptConflictMessage(
  conflict: ScopeAuthorityProvisioningReceiptConflict,
): string {
  switch (conflict.reason) {
    case "scopeMissing":
      return `Scope ${conflict.scopeId} does not exist for authority reservation`;
    case "scopePlacementMismatch":
      return `Scope ${conflict.scopeId} has conflicting split placement metadata`;
    case "receiptMissingForReady":
      return `Scope ${conflict.scopeId} has no provisioning receipt to publish ready`;
    case "receiptProtocolVersionMismatch":
      return `Scope ${conflict.scopeId} has a conflicting provisioning protocol version`;
    case "receiptPlacementMismatch":
      return `Scope ${conflict.scopeId} has conflicting provisioning receipt placement`;
    case "receiptInitialEpochMismatch":
      return `Scope ${conflict.scopeId} has a conflicting provisioning receipt epoch`;
  }
}
