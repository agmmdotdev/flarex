import { eq } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import {
  CommitSeqSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import {
  DeploymentMetadataAlreadyExistsError,
  insertDeploymentMetadata,
  type DeploymentMetadataRecord,
  type FlarexMetadataDatabase,
} from "./deployments";
import {
  getScopeMetadata,
  getScopeMetadataByDeploymentId,
  insertScopeMetadata,
  InvalidScopeMetadataInputError,
  ScopeMetadataAlreadyExistsError,
  type ScopeMetadataRecord,
} from "./scopeMetadata";
import type { SharedDatabaseScopePhysicalLocator } from "./scopeMetadataTypes";
import { getScopeClock, type ScopeClockRecord } from "./scopeClock";
import { deployments, fxSystemScopeClocks } from "./schema";

export interface EnsureSharedScopeAuthorityInput {
  readonly deploymentId: string;
  readonly projectId: string;
}

export interface SharedScopeAuthorityProvisionerOptions {
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
  readonly randomUuid?: () => string;
}

export const SharedScopeAuthorityProvisioningStatuses = {
  created: "created",
  createdScopeAndClock: "created_scope_and_clock",
  alreadyProvisioned: "already_provisioned",
} as const;

export type SharedScopeAuthorityProvisioningStatus =
  (typeof SharedScopeAuthorityProvisioningStatuses)[keyof typeof SharedScopeAuthorityProvisioningStatuses];

export interface EnsureSharedScopeAuthorityResult {
  readonly status: SharedScopeAuthorityProvisioningStatus;
  readonly createdDeployment: boolean;
  readonly deployment: DeploymentMetadataRecord;
  readonly scope: ScopeMetadataRecord;
  readonly clock: ScopeClockRecord;
}

export interface SharedScopeAuthorityProvisioner {
  ensure(
    input: EnsureSharedScopeAuthorityInput,
  ): Promise<EnsureSharedScopeAuthorityResult>;
}

export type SharedScopeAuthorityConflict =
  | {
      readonly reason: "projectMismatch";
      readonly deploymentId: string;
      readonly expectedProjectId: string;
      readonly actualProjectId: string;
    }
  | {
      readonly reason: "physicalLocatorMismatch";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly expected: SharedDatabaseScopePhysicalLocator;
      readonly actual: ScopeMetadataRecord["physicalLocator"];
    }
  | {
      readonly reason: "clockPreexistedForNewScope";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "clockMissingForExistingScope";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "deploymentMissingForBootstrap";
      readonly deploymentId: string;
    }
  | {
      readonly reason: "deploymentReplacedDuringBootstrap";
      readonly deploymentId: string;
      readonly expectedCreatedAt: Date;
      readonly actualCreatedAt: Date;
    };

export class SharedScopeAuthorityConflictError extends Error {
  constructor(readonly conflict: SharedScopeAuthorityConflict) {
    super(sharedScopeAuthorityConflictMessage(conflict));
    this.name = "SharedScopeAuthorityConflictError";
  }
}

export class UnsupportedScopeAuthorityProvisioningTopologyError extends Error {
  constructor(readonly kind: string) {
    super(
      `S02-C1 provisions only shared_database authority, not ${kind}`,
    );
    this.name = "UnsupportedScopeAuthorityProvisioningTopologyError";
  }
}

export class InvalidGeneratedScopeAuthorityIdError extends Error {
  constructor(
    readonly field: "scopeId" | "epoch",
    readonly value: string,
  ) {
    super(
      `Generated scope authority ${field} is not a lowercase RFC 4122 UUID v4: ${value}`,
    );
    this.name = "InvalidGeneratedScopeAuthorityIdError";
  }
}

export class ScopeAuthorityIdGenerationExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
  ) {
    super(
      `Could not generate a collision-free scope ID for deployment ${deploymentId} after ${attempts} attempts`,
    );
    this.name = "ScopeAuthorityIdGenerationExhaustedError";
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SCOPE_ID_GENERATION_ATTEMPTS = 8;
const initialStorageGeneration =
  LegacyV1StorageGenerationSchema.make("legacy_v1");
const initialStorageGenerationFence = StorageGenerationFenceSchema.make(1n);
const initialCommitSeq = CommitSeqSchema.make(0n);
const initialOutboxSeq = OutboxSeqSchema.make(0n);

export const ExistingSharedScopeAuthorityBootstrapStatuses = {
  createdScopeAndClock:
    SharedScopeAuthorityProvisioningStatuses.createdScopeAndClock,
  repairedMissingClock: "repaired_missing_clock",
  alreadyProvisioned:
    SharedScopeAuthorityProvisioningStatuses.alreadyProvisioned,
} as const;

export type ExistingSharedScopeAuthorityBootstrapStatus =
  (typeof ExistingSharedScopeAuthorityBootstrapStatuses)[keyof typeof ExistingSharedScopeAuthorityBootstrapStatuses];

export interface BootstrapExistingSharedScopeAuthorityResult {
  readonly status: ExistingSharedScopeAuthorityBootstrapStatus;
  readonly deployment: DeploymentMetadataRecord;
  readonly scope: ScopeMetadataRecord;
  readonly clock: ScopeClockRecord;
}

export function createSharedScopeAuthorityProvisioner(
  db: FlarexMetadataDatabase,
  options: SharedScopeAuthorityProvisionerOptions,
): SharedScopeAuthorityProvisioner {
  const physicalLocator = captureSharedScopePhysicalLocator(
    options.physicalLocator,
  );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  return {
    ensure: (input) =>
      db.transaction((tx) =>
        ensureSharedScopeAuthorityInTransaction(
          tx,
          input,
          physicalLocator,
          randomUuid,
        ),
      ),
  } satisfies SharedScopeAuthorityProvisioner;
}

/**
 * C2-only existing-row bootstrap primitive. Unlike normal provisioning, this
 * function never recreates a missing deployment and may initialize a missing
 * clock for an already-inventoried scope. Callers must wrap exactly one
 * deployment in a short database transaction.
 */
export async function bootstrapExistingSharedScopeAuthorityInTransaction(
  tx: ScopeAuthorityBootstrapTransaction,
  expectedDeployment: DeploymentMetadataRecord,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  randomUuid: () => string,
): Promise<BootstrapExistingSharedScopeAuthorityResult> {
  const deployment = await requireExistingBootstrapDeployment(
    tx,
    expectedDeployment,
  );
  const ensuredScope = await ensureScope(
    tx,
    expectedDeployment.deploymentId,
    physicalLocator,
    randomUuid,
  );
  const ensuredClock = await ensureInitialBootstrapClock(
    tx,
    expectedDeployment.deploymentId,
    ensuredScope,
    randomUuid,
  );

  return {
    status: existingBootstrapStatus(
      ensuredScope.created,
      ensuredClock.clockCreated,
    ),
    deployment,
    scope: ensuredScope.scope,
    clock: ensuredClock.clock,
  } satisfies BootstrapExistingSharedScopeAuthorityResult;
}

type ScopeAuthorityBootstrapTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

export function captureSharedScopePhysicalLocator(
  locator: SharedDatabaseScopePhysicalLocator,
): SharedDatabaseScopePhysicalLocator {
  validateSharedPhysicalLocator(locator);
  return Object.freeze({
    kind: locator.kind,
    databaseKey: locator.databaseKey,
    schemaName: locator.schemaName,
  }) satisfies SharedDatabaseScopePhysicalLocator;
}

interface EnsureDeploymentResult {
  readonly deployment: DeploymentMetadataRecord;
  readonly created: boolean;
}

interface EnsureScopeResult {
  readonly scope: ScopeMetadataRecord;
  readonly created: boolean;
}

interface EnsureClockResult {
  readonly clock: ScopeClockRecord;
}

interface EnsureInitialBootstrapClockResult extends EnsureClockResult {
  readonly clockCreated: boolean;
}

interface InsertInitialScopeClockResult extends EnsureClockResult {
  readonly created: boolean;
}

async function ensureSharedScopeAuthorityInTransaction(
  tx: FlarexMetadataDatabase,
  input: EnsureSharedScopeAuthorityInput,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  randomUuid: () => string,
): Promise<EnsureSharedScopeAuthorityResult> {
  const ensuredDeployment = await ensureDeployment(tx, input);
  const ensuredScope = await ensureScope(
    tx,
    input.deploymentId,
    physicalLocator,
    randomUuid,
  );
  const ensuredClock = await ensureClock(
    tx,
    input.deploymentId,
    ensuredScope,
    randomUuid,
  );

  return {
    status: provisioningStatus(
      ensuredDeployment.created,
      ensuredScope.created,
    ),
    createdDeployment: ensuredDeployment.created,
    deployment: ensuredDeployment.deployment,
    scope: ensuredScope.scope,
    clock: ensuredClock.clock,
  } satisfies EnsureSharedScopeAuthorityResult;
}

async function ensureDeployment(
  tx: FlarexMetadataDatabase,
  input: EnsureSharedScopeAuthorityInput,
): Promise<EnsureDeploymentResult> {
  const existing = await lockDeploymentForAuthority(
    tx,
    input.deploymentId,
  );
  if (existing !== null) {
    return {
      deployment: requireProjectMatch(existing, input.projectId),
      created: false,
    };
  }

  try {
    return {
      deployment: await insertDeploymentMetadata(tx, input),
      created: true,
    };
  } catch (error) {
    if (!(error instanceof DeploymentMetadataAlreadyExistsError)) throw error;
    const raced = await lockDeploymentForAuthority(tx, input.deploymentId);
    if (raced === null) throw error;
    return {
      deployment: requireProjectMatch(raced, input.projectId),
      created: false,
    };
  }
}

async function lockDeploymentForAuthority(
  tx: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<DeploymentMetadataRecord | null> {
  const rows = await tx
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1)
    .for("share");
  return rows[0] ?? null;
}

async function requireExistingBootstrapDeployment(
  tx: FlarexMetadataDatabase,
  expected: DeploymentMetadataRecord,
): Promise<DeploymentMetadataRecord> {
  const rows = await tx
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, expected.deploymentId))
    .limit(1)
    .for("update");
  const existing = rows[0] ?? null;
  if (existing === null) {
    throw new SharedScopeAuthorityConflictError({
      reason: "deploymentMissingForBootstrap",
      deploymentId: expected.deploymentId,
    });
  }
  requireProjectMatch(existing, expected.projectId);
  if (existing.createdAt.getTime() !== expected.createdAt.getTime()) {
    throw new SharedScopeAuthorityConflictError({
      reason: "deploymentReplacedDuringBootstrap",
      deploymentId: expected.deploymentId,
      expectedCreatedAt: expected.createdAt,
      actualCreatedAt: existing.createdAt,
    });
  }
  return existing;
}

async function ensureScope(
  tx: FlarexMetadataDatabase,
  deploymentId: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  randomUuid: () => string,
): Promise<EnsureScopeResult> {
  const existing = await getScopeMetadataByDeploymentId(tx, deploymentId);
  if (existing !== null) {
    return {
      scope: requirePhysicalLocatorMatch(existing, physicalLocator),
      created: false,
    };
  }

  for (
    let attempt = 1;
    attempt <= MAX_SCOPE_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const candidateScopeId = generateScopeId(randomUuid);
    const scopeCollision = await getScopeMetadata(tx, candidateScopeId);
    const clockCollision = await getScopeClock(tx, candidateScopeId);
    if (scopeCollision !== null || clockCollision !== null) continue;

    try {
      const scope = await insertScopeMetadata(tx, {
        scopeId: candidateScopeId,
        deploymentId,
        physicalLocator,
      });
      return { scope, created: true };
    } catch (error) {
      if (!(error instanceof ScopeMetadataAlreadyExistsError)) throw error;
      const raced = await getScopeMetadataByDeploymentId(tx, deploymentId);
      if (raced !== null) {
        return {
          scope: requirePhysicalLocatorMatch(raced, physicalLocator),
          created: false,
        };
      }
      const collided = await getScopeMetadata(tx, candidateScopeId);
      if (collided !== null) continue;
      throw error;
    }
  }

  throw new ScopeAuthorityIdGenerationExhaustedError(
    deploymentId,
    MAX_SCOPE_ID_GENERATION_ATTEMPTS,
  );
}

async function ensureClock(
  tx: FlarexMetadataDatabase,
  deploymentId: string,
  ensuredScope: EnsureScopeResult,
  randomUuid: () => string,
): Promise<EnsureClockResult> {
  const existing = await getScopeClock(tx, ensuredScope.scope.scopeId);
  if (existing !== null) {
    if (ensuredScope.created) {
      throw new SharedScopeAuthorityConflictError({
        reason: "clockPreexistedForNewScope",
        deploymentId,
        scopeId: ensuredScope.scope.scopeId,
      });
    }
    return { clock: existing };
  }

  if (!ensuredScope.created) {
    throw new SharedScopeAuthorityConflictError({
      reason: "clockMissingForExistingScope",
      deploymentId,
      scopeId: ensuredScope.scope.scopeId,
    });
  }

  const initialized = await insertInitialScopeClock(
    tx,
    ensuredScope.scope.scopeId,
    randomUuid,
  );

  if (!initialized.created) {
    throw new SharedScopeAuthorityConflictError({
      reason: "clockPreexistedForNewScope",
      deploymentId,
      scopeId: ensuredScope.scope.scopeId,
    });
  }
  return { clock: initialized.clock };
}

async function ensureInitialBootstrapClock(
  tx: FlarexMetadataDatabase,
  deploymentId: string,
  ensuredScope: EnsureScopeResult,
  randomUuid: () => string,
): Promise<EnsureInitialBootstrapClockResult> {
  const existing = await getScopeClock(tx, ensuredScope.scope.scopeId);
  if (existing !== null) {
    if (ensuredScope.created) {
      throw new SharedScopeAuthorityConflictError({
        reason: "clockPreexistedForNewScope",
        deploymentId,
        scopeId: ensuredScope.scope.scopeId,
      });
    }
    return {
      clock: existing,
      clockCreated: false,
    };
  }

  const initialized = await insertInitialScopeClock(
    tx,
    ensuredScope.scope.scopeId,
    randomUuid,
  );

  if (!initialized.created && ensuredScope.created) {
    throw new SharedScopeAuthorityConflictError({
      reason: "clockPreexistedForNewScope",
      deploymentId,
      scopeId: ensuredScope.scope.scopeId,
    });
  }
  return {
    clock: initialized.clock,
    clockCreated: initialized.created,
  };
}

async function insertInitialScopeClock(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
  randomUuid: () => string,
): Promise<InsertInitialScopeClockResult> {
  const epoch = generateScopeEpoch(randomUuid);
  const inserted = await tx
    .insert(fxSystemScopeClocks)
    .values({
      scopeId,
      storageGeneration: initialStorageGeneration,
      storageGenerationFence: initialStorageGenerationFence,
      lastCommitSeq: initialCommitSeq,
      lastOutboxSeq: initialOutboxSeq,
      epoch,
    })
    .onConflictDoNothing({ target: fxSystemScopeClocks.scopeId })
    .returning({ scopeId: fxSystemScopeClocks.scopeId });
  const clock = await getScopeClock(tx, scopeId);
  if (clock === null) {
    throw new Error(`Scope clock disappeared during initialization: ${scopeId}`);
  }
  return { clock, created: inserted.length > 0 };
}

function requireProjectMatch(
  deployment: DeploymentMetadataRecord,
  expectedProjectId: string,
): DeploymentMetadataRecord {
  if (deployment.projectId !== expectedProjectId) {
    throw new SharedScopeAuthorityConflictError({
      reason: "projectMismatch",
      deploymentId: deployment.deploymentId,
      expectedProjectId,
      actualProjectId: deployment.projectId,
    });
  }
  return deployment;
}

function requirePhysicalLocatorMatch(
  scope: ScopeMetadataRecord,
  expected: SharedDatabaseScopePhysicalLocator,
): ScopeMetadataRecord {
  const actual = scope.physicalLocator;
  if (
    actual.kind !== expected.kind ||
    actual.databaseKey !== expected.databaseKey ||
    actual.schemaName !== expected.schemaName
  ) {
    throw new SharedScopeAuthorityConflictError({
      reason: "physicalLocatorMismatch",
      deploymentId: scope.deploymentId,
      scopeId: scope.scopeId,
      expected,
      actual,
    });
  }
  return scope;
}

function validateSharedPhysicalLocator(
  locator: SharedDatabaseScopePhysicalLocator,
): void {
  if (locator.kind !== "shared_database") {
    throw new UnsupportedScopeAuthorityProvisioningTopologyError(
      String(locator.kind),
    );
  }
  if (locator.databaseKey.trim().length === 0) {
    throw new InvalidScopeMetadataInputError(
      "physicalLocator.databaseKey",
    );
  }
  if (locator.schemaName.trim().length === 0) {
    throw new InvalidScopeMetadataInputError("physicalLocator.schemaName");
  }
}

function generateScopeId(randomUuid: () => string): ScopeId {
  const uuid = requireGeneratedUuid("scopeId", randomUuid());
  return ScopeIdSchema.make(`scope_${uuid}`);
}

function generateScopeEpoch(randomUuid: () => string): ScopeEpoch {
  const uuid = requireGeneratedUuid("epoch", randomUuid());
  return ScopeEpochSchema.make(`epoch_${uuid}`);
}

function requireGeneratedUuid(
  field: "scopeId" | "epoch",
  value: string,
): string {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new InvalidGeneratedScopeAuthorityIdError(field, value);
  }
  return value;
}

function provisioningStatus(
  deploymentCreated: boolean,
  scopeCreated: boolean,
): SharedScopeAuthorityProvisioningStatus {
  if (deploymentCreated && scopeCreated) {
    return SharedScopeAuthorityProvisioningStatuses.created;
  }
  if (!deploymentCreated && scopeCreated) {
    return SharedScopeAuthorityProvisioningStatuses.createdScopeAndClock;
  }
  if (!deploymentCreated && !scopeCreated) {
    return SharedScopeAuthorityProvisioningStatuses.alreadyProvisioned;
  }
  throw new Error(
    `Invalid shared scope provisioning outcome: deploymentCreated=${deploymentCreated}, scopeCreated=${scopeCreated}`,
  );
}

function existingBootstrapStatus(
  scopeCreated: boolean,
  clockCreated: boolean,
): ExistingSharedScopeAuthorityBootstrapStatus {
  if (scopeCreated && clockCreated) {
    return ExistingSharedScopeAuthorityBootstrapStatuses.createdScopeAndClock;
  }
  if (!scopeCreated && clockCreated) {
    return ExistingSharedScopeAuthorityBootstrapStatuses.repairedMissingClock;
  }
  if (!scopeCreated && !clockCreated) {
    return ExistingSharedScopeAuthorityBootstrapStatuses.alreadyProvisioned;
  }
  throw new Error(
    `Invalid existing scope bootstrap outcome: scopeCreated=${scopeCreated}, clockCreated=${clockCreated}`,
  );
}

function sharedScopeAuthorityConflictMessage(
  conflict: SharedScopeAuthorityConflict,
): string {
  switch (conflict.reason) {
    case "projectMismatch":
      return `Deployment ${conflict.deploymentId} belongs to project ${conflict.actualProjectId}, not ${conflict.expectedProjectId}`;
    case "physicalLocatorMismatch":
      return `Scope ${conflict.scopeId} for deployment ${conflict.deploymentId} has conflicting physical locator metadata`;
    case "clockPreexistedForNewScope":
      return `Generated scope ${conflict.scopeId} already has clock authority`;
    case "clockMissingForExistingScope":
      return `Existing scope ${conflict.scopeId} for deployment ${conflict.deploymentId} is missing clock authority`;
    case "deploymentMissingForBootstrap":
      return `Deployment ${conflict.deploymentId} disappeared during existing-authority bootstrap`;
    case "deploymentReplacedDuringBootstrap":
      return `Deployment ${conflict.deploymentId} was replaced while existing-authority bootstrap was running`;
  }
}
