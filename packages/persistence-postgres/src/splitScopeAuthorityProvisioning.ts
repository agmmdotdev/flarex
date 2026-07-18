import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  DeploymentMetadataAlreadyExistsError,
  getDeploymentMetadata,
  insertDeploymentMetadata,
  type DeploymentMetadataRecord,
  type FlarexMetadataDatabase,
} from "./deployments";
import {
  generateScopeAuthorityEpoch,
  generateScopeAuthorityScopeId,
  MAX_SCOPE_AUTHORITY_ID_GENERATION_ATTEMPTS,
  ScopeAuthorityIdGenerationExhaustedError,
} from "./scopeAuthorityIds";
import { lockDeploymentForAuthority } from "./scopeAuthorityDeploymentLock";
import {
  captureSplitScopePhysicalLocator,
  getScopeAuthorityProvisioningReceipt,
  lockExactScopeAuthorityProvisioningReceiptInTransaction,
  publishScopeAuthorityReadyInTransaction,
  reserveScopeAuthorityProvisioningReceiptInTransaction,
  ScopeAuthorityProvisioningReceiptCorruptionError,
  type ScopeAuthorityProvisioningReceiptTransaction,
} from "./scopeAuthorityProvisioningReceipt";
import {
  PublishSplitScopeAuthorityReadyStatuses,
  ReserveSplitScopeAuthorityProvisioningReceiptStatuses,
  SplitScopeAuthorityProvisioningStates,
  type ReadySplitScopeAuthorityProvisioningReceipt,
  type SplitScopeAuthorityProvisioningReceipt,
  type SplitScopeAuthorityProvisioningReceiptIdentity,
} from "./scopeAuthorityProvisioningReceiptTypes";
import { getScopeClock } from "./scopeClock";
import { isExactInitialScopeClock } from "./scopeClockInitialization";
import {
  getScopeMetadata,
  getScopeMetadataByDeploymentId,
  insertScopeMetadata,
  ScopeMetadataAlreadyExistsError,
  type ScopeMetadataRecord,
  type SplitScopeMetadataRecord,
} from "./scopeMetadata";
import type { SplitScopePhysicalLocator } from "./scopeMetadataTypes";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import {
  type LocatedSplitScopeClockTarget,
  SplitScopeInitialClockConflictError,
} from "./splitScopeClockTarget";

export interface EnsureSplitScopeAuthorityInput {
  readonly deploymentId: string;
  readonly projectId: string;
}

export interface SplitScopeAuthorityPlacementPlanner {
  plan(input: EnsureSplitScopeAuthorityInput): SplitScopePhysicalLocator;
}

export interface SplitScopeClockTargetResolver {
  resolve(
    physicalLocator: SplitScopePhysicalLocator,
  ): Promise<LocatedSplitScopeClockTarget>;
}

export interface SplitScopeAuthorityProvisionerOptions {
  readonly placementPlanner: SplitScopeAuthorityPlacementPlanner;
  readonly targetResolver: SplitScopeClockTargetResolver;
  readonly randomUuid?: () => string;
}

export const SplitScopeAuthorityProvisioningStatuses = {
  publishedReady: "published_ready",
  alreadyReady: "already_ready",
} as const satisfies Readonly<Record<string, string>>;

export interface EnsureSplitScopeAuthorityResult {
  readonly status: "published_ready" | "already_ready";
  readonly createdDeployment: boolean;
  readonly deployment: DeploymentMetadataRecord;
  readonly scope: SplitScopeMetadataRecord;
  readonly receipt: ReadySplitScopeAuthorityProvisioningReceipt;
}

export interface SplitScopeAuthorityProvisioner {
  ensure(
    input: EnsureSplitScopeAuthorityInput,
  ): Promise<EnsureSplitScopeAuthorityResult>;
}

export type SplitScopeAuthorityConflict =
  | {
      readonly reason: "deploymentMissingDuringReservation";
      readonly deploymentId: string;
    }
  | {
      readonly reason: "deploymentMissingDuringFinalization";
      readonly deploymentId: string;
    }
  | {
      readonly reason: "deploymentReplacedDuringReservation";
      readonly deploymentId: string;
      readonly expectedCreatedAt: Date;
      readonly actualCreatedAt: Date;
    }
  | {
      readonly reason: "deploymentReplacedDuringFinalization";
      readonly deploymentId: string;
      readonly expectedCreatedAt: Date;
      readonly actualCreatedAt: Date;
    }
  | {
      readonly reason: "projectMismatch";
      readonly deploymentId: string;
      readonly expectedProjectId: string;
      readonly actualProjectId: string;
    }
  | {
      readonly reason: "existingDeploymentMissingScope";
      readonly deploymentId: string;
    }
  | {
      readonly reason: "unsupportedExistingScopeTopology";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly actual: ScopeMetadataRecord["physicalLocator"];
    }
  | {
      readonly reason: "existingScopeMissingReceipt";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "scopeMissingDuringFinalization";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
    }
  | {
      readonly reason: "scopeChangedDuringFinalization";
      readonly deploymentId: string;
      readonly expected: SplitScopeMetadataRecord;
      readonly actual: ScopeMetadataRecord;
    }
  | {
      readonly reason: "locatedClockMissingAfterReady";
      readonly scopeId: ScopeId;
      readonly physicalLocator: SplitScopePhysicalLocator;
    }
  | {
      readonly reason: "locatedClockScopeMismatch";
      readonly expectedScopeId: ScopeId;
      readonly actualScopeId: ScopeId;
      readonly physicalLocator: SplitScopePhysicalLocator;
    };

export class SplitScopeAuthorityConflictError extends Error {
  constructor(readonly conflict: SplitScopeAuthorityConflict) {
    super(splitScopeAuthorityConflictMessage(conflict));
    this.name = "SplitScopeAuthorityConflictError";
  }
}

export class SplitScopeAuthorityPlacementPlanningError extends Error {
  constructor(readonly planningCause: unknown) {
    super("Trusted split scope placement planning failed");
    this.name = "SplitScopeAuthorityPlacementPlanningError";
  }
}

export type SplitScopeAuthorityTargetResolutionConflict =
  | {
      readonly reason: "resolverFailed";
      readonly expected: SplitScopePhysicalLocator;
      readonly resolutionCause: unknown;
    }
  | {
      readonly reason: "resolvedLocatorInvalid";
      readonly expected: SplitScopePhysicalLocator;
      readonly resolutionCause: unknown;
    }
  | {
      readonly reason: "resolvedLocatorMismatch";
      readonly expected: SplitScopePhysicalLocator;
      readonly actual: SplitScopePhysicalLocator;
    };

export class SplitScopeAuthorityTargetResolutionError extends Error {
  constructor(
    readonly conflict: SplitScopeAuthorityTargetResolutionConflict,
  ) {
    super(splitScopeAuthorityTargetResolutionMessage(conflict));
    this.name = "SplitScopeAuthorityTargetResolutionError";
  }
}

interface ControlAuthority {
  readonly createdDeployment: boolean;
  readonly deployment: DeploymentMetadataRecord;
  readonly scope: SplitScopeMetadataRecord;
  readonly receipt: SplitScopeAuthorityProvisioningReceipt;
}

interface ReadyControlAuthority
  extends Omit<ControlAuthority, "receipt"> {
  readonly receipt: ReadySplitScopeAuthorityProvisioningReceipt;
}

interface EnsureDeploymentResult {
  readonly deployment: DeploymentMetadataRecord;
  readonly created: boolean;
}

type SplitScopeAuthorityTransaction =
  ScopeAuthorityProvisioningReceiptTransaction;

class CandidateScopeAuthorityIdCollisionError extends Error {}

export function createSplitScopeAuthorityProvisioner(
  controlDb: FlarexMetadataDatabase,
  options: SplitScopeAuthorityProvisionerOptions,
): SplitScopeAuthorityProvisioner {
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  return {
    ensure: async (input) => {
      const observedDeployment = await getDeploymentMetadata(
        controlDb,
        input.deploymentId,
      );
      const control =
        observedDeployment === null
          ? await reserveNewControlAuthority(
              controlDb,
              input,
              options.placementPlanner,
              randomUuid,
            )
          : await controlDb.transaction((tx) =>
              requireExistingControlAuthorityInTransaction(
                tx,
                input,
                observedDeployment.createdAt,
              ),
            );
      return reconcileSplitScopeAuthority(
        controlDb,
        options.targetResolver,
        input,
        control,
      );
    },
  } satisfies SplitScopeAuthorityProvisioner;
}

async function reserveNewControlAuthority(
  controlDb: FlarexMetadataDatabase,
  input: EnsureSplitScopeAuthorityInput,
  planner: SplitScopeAuthorityPlacementPlanner,
  randomUuid: () => string,
): Promise<ControlAuthority> {
  const physicalLocator = planPhysicalLocator(planner, input);
  for (
    let attempt = 1;
    attempt <= MAX_SCOPE_AUTHORITY_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const candidateScopeId = generateScopeAuthorityScopeId(randomUuid);
    const candidateInitialEpoch = generateScopeAuthorityEpoch(randomUuid);
    try {
      return await controlDb.transaction(async (tx) => {
        const ensuredDeployment = await ensureDeploymentInTransaction(
          tx,
          input,
        );
        if (!ensuredDeployment.created) {
          return requireExistingControlAuthorityForDeploymentInTransaction(
            tx,
            input,
            ensuredDeployment.deployment,
          );
        }

        const scopeCollision = await getScopeMetadata(tx, candidateScopeId);
        const clockCollision = await getScopeClock(tx, candidateScopeId);
        if (scopeCollision !== null || clockCollision !== null) {
          throw new CandidateScopeAuthorityIdCollisionError();
        }

        let scope: ScopeMetadataRecord;
        try {
          scope = await insertScopeMetadata(tx, {
            scopeId: candidateScopeId,
            deploymentId: input.deploymentId,
            physicalLocator,
          });
        } catch (error) {
          if (error instanceof ScopeMetadataAlreadyExistsError) {
            throw new CandidateScopeAuthorityIdCollisionError();
          }
          throw error;
        }
        const splitScope = requireSplitScopeMetadata(scope);
        const reserved =
          await reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
            scopeId: splitScope.scopeId,
            physicalLocator: splitScope.physicalLocator,
            candidateInitialEpoch,
          });
        if (
          reserved.status !==
            ReserveSplitScopeAuthorityProvisioningReceiptStatuses.createdReserved ||
          reserved.receipt.state !== SplitScopeAuthorityProvisioningStates.reserved
        ) {
          throw new ScopeAuthorityProvisioningReceiptCorruptionError(
            splitScope.scopeId,
            "a newly created split scope did not create a reserved receipt",
          );
        }
        return {
          createdDeployment: true,
          deployment: ensuredDeployment.deployment,
          scope: splitScope,
          receipt: reserved.receipt,
        } satisfies ControlAuthority;
      });
    } catch (error) {
      if (error instanceof CandidateScopeAuthorityIdCollisionError) continue;
      throw error;
    }
  }
  throw new ScopeAuthorityIdGenerationExhaustedError(
    input.deploymentId,
    MAX_SCOPE_AUTHORITY_ID_GENERATION_ATTEMPTS,
  );
}

async function ensureDeploymentInTransaction(
  tx: SplitScopeAuthorityTransaction,
  input: EnsureSplitScopeAuthorityInput,
): Promise<EnsureDeploymentResult> {
  const existing = await lockDeploymentForAuthority(tx, input.deploymentId);
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

async function requireExistingControlAuthorityInTransaction(
  tx: SplitScopeAuthorityTransaction,
  input: EnsureSplitScopeAuthorityInput,
  expectedCreatedAt: Date,
): Promise<ControlAuthority> {
  const deployment = await lockDeploymentForAuthority(tx, input.deploymentId);
  if (deployment === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "deploymentMissingDuringReservation",
      deploymentId: input.deploymentId,
    });
  }
  requireProjectMatch(deployment, input.projectId);
  if (deployment.createdAt.getTime() !== expectedCreatedAt.getTime()) {
    throw new SplitScopeAuthorityConflictError({
      reason: "deploymentReplacedDuringReservation",
      deploymentId: input.deploymentId,
      expectedCreatedAt,
      actualCreatedAt: deployment.createdAt,
    });
  }
  return requireExistingControlAuthorityForDeploymentInTransaction(
    tx,
    input,
    deployment,
  );
}

async function requireExistingControlAuthorityForDeploymentInTransaction(
  tx: SplitScopeAuthorityTransaction,
  input: EnsureSplitScopeAuthorityInput,
  deployment: DeploymentMetadataRecord,
): Promise<ControlAuthority> {
  const existingScope = await getScopeMetadataByDeploymentId(
    tx,
    input.deploymentId,
  );
  if (existingScope === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "existingDeploymentMissingScope",
      deploymentId: input.deploymentId,
    });
  }
  const splitScope = requireSplitScopeMetadata(existingScope);
  const observedReceipt = await getScopeAuthorityProvisioningReceipt(
    tx,
    splitScope.scopeId,
  );
  if (observedReceipt === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "existingScopeMissingReceipt",
      deploymentId: input.deploymentId,
      scopeId: splitScope.scopeId,
    });
  }
  const lockedReceipt =
    await reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
      scopeId: splitScope.scopeId,
      physicalLocator: splitScope.physicalLocator,
      candidateInitialEpoch: observedReceipt.initialEpoch,
    });
  const refreshedScope = await getScopeMetadata(tx, splitScope.scopeId);
  if (refreshedScope === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "scopeMissingDuringFinalization",
      deploymentId: input.deploymentId,
      scopeId: splitScope.scopeId,
    });
  }
  const refreshedSplitScope = requireSplitScopeMetadata(refreshedScope);
  requireScopeIdentity(splitScope, refreshedSplitScope);
  return {
    createdDeployment: false,
    deployment,
    scope: refreshedSplitScope,
    receipt: lockedReceipt.receipt,
  } satisfies ControlAuthority;
}

async function reconcileSplitScopeAuthority(
  controlDb: FlarexMetadataDatabase,
  resolver: SplitScopeClockTargetResolver,
  input: EnsureSplitScopeAuthorityInput,
  control: ControlAuthority,
): Promise<EnsureSplitScopeAuthorityResult> {
  if (control.receipt.state === SplitScopeAuthorityProvisioningStates.ready) {
    const target = await resolveTarget(
      resolver,
      control.receipt.physicalLocator,
    );
    await requireCurrentLocatedClock(target, control.receipt.scopeId);
    const ready = await readExactControlAuthority(controlDb, input, control);
    return ensureResult(
      SplitScopeAuthorityProvisioningStatuses.alreadyReady,
      ready,
    );
  }

  let target: LocatedSplitScopeClockTarget;
  try {
    target = await resolveTarget(
      resolver,
      control.receipt.physicalLocator,
    );
    const initialClock = {
      scopeId: control.receipt.scopeId,
      initialEpoch: control.receipt.initialEpoch,
    };
    const initialized = await target.ensureInitialClock(initialClock);
    if (!isExactInitialScopeClock(initialized.clock, initialClock)) {
      throw new SplitScopeInitialClockConflictError(
        initialClock,
        initialized.clock,
      );
    }
  } catch (error) {
    return recoverReadyAfterTargetError(
      controlDb,
      resolver,
      input,
      control,
      error,
    );
  }

  const published = await publishExactControlAuthority(
    controlDb,
    input,
    control,
  );
  await requireCurrentLocatedClock(target, published.receipt.scopeId);
  const ready = await readExactControlAuthority(controlDb, input, published);
  return ensureResult(
    publishedPublicationStatus(published),
    ready,
  );
}

async function recoverReadyAfterTargetError(
  controlDb: FlarexMetadataDatabase,
  resolver: SplitScopeClockTargetResolver,
  input: EnsureSplitScopeAuthorityInput,
  control: ControlAuthority,
  targetError: unknown,
): Promise<EnsureSplitScopeAuthorityResult> {
  const observed = await readExactControlAuthorityState(
    controlDb,
    input,
    control,
  );
  if (observed.receipt.state === SplitScopeAuthorityProvisioningStates.reserved) {
    throw targetError;
  }
  const target = await resolveTarget(
    resolver,
    observed.receipt.physicalLocator,
  );
  await requireCurrentLocatedClock(target, observed.receipt.scopeId);
  const ready = await readExactControlAuthority(controlDb, input, observed);
  return ensureResult(
    SplitScopeAuthorityProvisioningStatuses.alreadyReady,
    ready,
  );
}

async function publishExactControlAuthority(
  controlDb: FlarexMetadataDatabase,
  input: EnsureSplitScopeAuthorityInput,
  expected: ControlAuthority,
): Promise<
  ReadyControlAuthority & {
    readonly publicationStatus: "published_ready" | "already_ready";
  }
> {
  return controlDb.transaction(async (tx) => {
    const deployment = await lockAndRequireFinalDeployment(
      tx,
      input,
      expected.deployment,
    );
    const published = await publishScopeAuthorityReadyInTransaction(tx, {
      expected: receiptIdentity(expected.receipt),
    });
    const scope = await requireFinalScope(tx, expected.scope);
    return {
      createdDeployment: expected.createdDeployment,
      deployment,
      scope,
      receipt: published.receipt,
      publicationStatus: published.status,
    };
  });
}

async function readExactControlAuthority(
  controlDb: FlarexMetadataDatabase,
  input: EnsureSplitScopeAuthorityInput,
  expected: ControlAuthority,
): Promise<ReadyControlAuthority> {
  const authority = await readExactControlAuthorityState(
    controlDb,
    input,
    expected,
  );
  if (authority.receipt.state !== SplitScopeAuthorityProvisioningStates.ready) {
    throw new ScopeAuthorityProvisioningReceiptCorruptionError(
      authority.scope.scopeId,
      "ready reconciliation returned a reserved receipt",
    );
  }
  return {
    ...authority,
    receipt: authority.receipt,
  };
}

async function readExactControlAuthorityState(
  controlDb: FlarexMetadataDatabase,
  input: EnsureSplitScopeAuthorityInput,
  expected: ControlAuthority,
): Promise<ControlAuthority> {
  return controlDb.transaction(async (tx) => {
    const deployment = await lockAndRequireFinalDeployment(
      tx,
      input,
      expected.deployment,
    );
    const receipt =
      await lockExactScopeAuthorityProvisioningReceiptInTransaction(tx, {
        expected: receiptIdentity(expected.receipt),
      });
    const scope = await requireFinalScope(tx, expected.scope);
    return {
      createdDeployment: expected.createdDeployment,
      deployment,
      scope,
      receipt,
    };
  });
}

async function lockAndRequireFinalDeployment(
  tx: SplitScopeAuthorityTransaction,
  input: EnsureSplitScopeAuthorityInput,
  expected: DeploymentMetadataRecord,
): Promise<DeploymentMetadataRecord> {
  const deployment = await lockDeploymentForAuthority(
    tx,
    expected.deploymentId,
  );
  if (deployment === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "deploymentMissingDuringFinalization",
      deploymentId: expected.deploymentId,
    });
  }
  requireProjectMatch(deployment, input.projectId);
  if (deployment.createdAt.getTime() !== expected.createdAt.getTime()) {
    throw new SplitScopeAuthorityConflictError({
      reason: "deploymentReplacedDuringFinalization",
      deploymentId: expected.deploymentId,
      expectedCreatedAt: expected.createdAt,
      actualCreatedAt: deployment.createdAt,
    });
  }
  return deployment;
}

async function requireFinalScope(
  tx: SplitScopeAuthorityTransaction,
  expected: SplitScopeMetadataRecord,
): Promise<SplitScopeMetadataRecord> {
  const scope = await getScopeMetadata(tx, expected.scopeId);
  if (scope === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "scopeMissingDuringFinalization",
      deploymentId: expected.deploymentId,
      scopeId: expected.scopeId,
    });
  }
  const splitScope = requireSplitScopeMetadata(scope);
  requireScopeIdentity(expected, splitScope);
  return splitScope;
}

function requireProjectMatch(
  deployment: DeploymentMetadataRecord,
  expectedProjectId: string,
): DeploymentMetadataRecord {
  if (deployment.projectId !== expectedProjectId) {
    throw new SplitScopeAuthorityConflictError({
      reason: "projectMismatch",
      deploymentId: deployment.deploymentId,
      expectedProjectId,
      actualProjectId: deployment.projectId,
    });
  }
  return deployment;
}

function requireSplitScopeMetadata(
  scope: ScopeMetadataRecord,
): SplitScopeMetadataRecord {
  switch (scope.isolationKind) {
    case "schema_per_scope":
      return scope;
    case "database_per_scope":
      return scope;
    case "shared_database":
      throw new SplitScopeAuthorityConflictError({
        reason: "unsupportedExistingScopeTopology",
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        actual: scope.physicalLocator,
      });
  }
}

function requireScopeIdentity(
  expected: SplitScopeMetadataRecord,
  actual: SplitScopeMetadataRecord,
): void {
  if (
    expected.scopeId !== actual.scopeId ||
    expected.deploymentId !== actual.deploymentId ||
    expected.createdAt.getTime() !== actual.createdAt.getTime() ||
    !scopePhysicalLocatorsEqual(
      expected.physicalLocator,
      actual.physicalLocator,
    )
  ) {
    throw new SplitScopeAuthorityConflictError({
      reason: "scopeChangedDuringFinalization",
      deploymentId: expected.deploymentId,
      expected,
      actual,
    });
  }
}

function planPhysicalLocator(
  planner: SplitScopeAuthorityPlacementPlanner,
  input: EnsureSplitScopeAuthorityInput,
): SplitScopePhysicalLocator {
  try {
    return captureSplitScopePhysicalLocator(planner.plan(input));
  } catch (error) {
    throw new SplitScopeAuthorityPlacementPlanningError(error);
  }
}

async function resolveTarget(
  resolver: SplitScopeClockTargetResolver,
  expected: SplitScopePhysicalLocator,
): Promise<LocatedSplitScopeClockTarget> {
  const capturedExpected = captureSplitScopePhysicalLocator(expected);
  let target: LocatedSplitScopeClockTarget;
  try {
    target = await resolver.resolve(capturedExpected);
  } catch (error) {
    throw new SplitScopeAuthorityTargetResolutionError({
      reason: "resolverFailed",
      expected: capturedExpected,
      resolutionCause: error,
    });
  }
  let actual: SplitScopePhysicalLocator;
  try {
    actual = captureSplitScopePhysicalLocator(target.physicalLocator);
  } catch (error) {
    throw new SplitScopeAuthorityTargetResolutionError({
      reason: "resolvedLocatorInvalid",
      expected: capturedExpected,
      resolutionCause: error,
    });
  }
  if (!scopePhysicalLocatorsEqual(capturedExpected, actual)) {
    throw new SplitScopeAuthorityTargetResolutionError({
      reason: "resolvedLocatorMismatch",
      expected: capturedExpected,
      actual,
    });
  }
  return target;
}

async function requireCurrentLocatedClock(
  target: LocatedSplitScopeClockTarget,
  scopeId: ScopeId,
): Promise<void> {
  const clock = await target.getCurrentClock(scopeId);
  if (clock === null) {
    throw new SplitScopeAuthorityConflictError({
      reason: "locatedClockMissingAfterReady",
      scopeId,
      physicalLocator: target.physicalLocator,
    });
  }
  if (clock.scopeId !== scopeId) {
    throw new SplitScopeAuthorityConflictError({
      reason: "locatedClockScopeMismatch",
      expectedScopeId: scopeId,
      actualScopeId: clock.scopeId,
      physicalLocator: target.physicalLocator,
    });
  }
}

function receiptIdentity(
  receipt: SplitScopeAuthorityProvisioningReceipt,
): SplitScopeAuthorityProvisioningReceiptIdentity {
  return {
    scopeId: receipt.scopeId,
    protocolVersion: receipt.protocolVersion,
    physicalLocator: receipt.physicalLocator,
    initialEpoch: receipt.initialEpoch,
  };
}

function ensureResult(
  status: "published_ready" | "already_ready",
  authority: ReadyControlAuthority,
): EnsureSplitScopeAuthorityResult {
  return {
    status,
    createdDeployment: authority.createdDeployment,
    deployment: authority.deployment,
    scope: authority.scope,
    receipt: authority.receipt,
  };
}

function publishedPublicationStatus(
  authority: ReadyControlAuthority & {
    readonly publicationStatus: "published_ready" | "already_ready";
  },
): "published_ready" | "already_ready" {
  return authority.publicationStatus ===
    PublishSplitScopeAuthorityReadyStatuses.publishedReady
    ? SplitScopeAuthorityProvisioningStatuses.publishedReady
    : SplitScopeAuthorityProvisioningStatuses.alreadyReady;
}

function splitScopeAuthorityConflictMessage(
  conflict: SplitScopeAuthorityConflict,
): string {
  switch (conflict.reason) {
    case "deploymentMissingDuringReservation":
      return `Deployment ${conflict.deploymentId} disappeared during split authority reservation`;
    case "deploymentMissingDuringFinalization":
      return `Deployment ${conflict.deploymentId} disappeared during split authority finalization`;
    case "deploymentReplacedDuringReservation":
      return `Deployment ${conflict.deploymentId} was replaced during split authority reservation`;
    case "deploymentReplacedDuringFinalization":
      return `Deployment ${conflict.deploymentId} was replaced during split authority finalization`;
    case "projectMismatch":
      return `Deployment ${conflict.deploymentId} belongs to project ${conflict.actualProjectId}, not ${conflict.expectedProjectId}`;
    case "existingDeploymentMissingScope":
      return `Existing deployment ${conflict.deploymentId} has no scope authority and requires explicit bootstrap`;
    case "unsupportedExistingScopeTopology":
      return `Existing scope ${conflict.scopeId} for deployment ${conflict.deploymentId} is not a split topology`;
    case "existingScopeMissingReceipt":
      return `Existing split scope ${conflict.scopeId} has no recoverable provisioning receipt`;
    case "scopeMissingDuringFinalization":
      return `Scope ${conflict.scopeId} disappeared during split authority finalization`;
    case "scopeChangedDuringFinalization":
      return `Scope ${conflict.expected.scopeId} changed during split authority finalization`;
    case "locatedClockMissingAfterReady":
      return `Ready split scope ${conflict.scopeId} is missing its located clock authority`;
    case "locatedClockScopeMismatch":
      return `Located clock ${conflict.actualScopeId} does not belong to expected scope ${conflict.expectedScopeId}`;
  }
}

function splitScopeAuthorityTargetResolutionMessage(
  conflict: SplitScopeAuthorityTargetResolutionConflict,
): string {
  switch (conflict.reason) {
    case "resolverFailed":
      return "Trusted split scope clock target resolution failed";
    case "resolvedLocatorInvalid":
      return "Trusted split scope clock target returned invalid locator metadata";
    case "resolvedLocatorMismatch":
      return "Trusted split scope clock target does not match persisted locator metadata";
  }
}
