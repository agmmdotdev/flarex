import {
  decodeActivePointMutationTargetMetadataV1,
  decodePointMutationCurrentScopeAuthorityV1,
  preparePointMutationStartEvidenceV1,
  type ActivePointMutationTargetMetadataV1,
  type PointMutationCurrentScopeAuthorityV1,
  type PreparedPointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

export interface ExecutorPointMutationStartCandidateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly args: unknown;
  /** Already server-namespaced text received over the trusted private route. */
  readonly requestKey: TransactionRequestKeyV1;
}

export interface ExecutorPointMutationStartPreparationRuntimeV1 {
  readonly loadActiveTargetMetadata: (
    deploymentId: TransactionGrantDeploymentIdV1,
    functionPath: TransactionFunctionPathV1,
  ) => Promise<unknown | null>;
  readonly loadCurrentScopeAuthority: (
    deploymentId: TransactionGrantDeploymentIdV1,
  ) => Promise<unknown>;
}

export type ExecutorPointMutationTargetMetadataV1Issue =
  | "missing"
  | "corrupt";

export class ExecutorPointMutationTargetMetadataV1Error extends Error {
  readonly name = "ExecutorPointMutationTargetMetadataV1Error";

  constructor(readonly issue: ExecutorPointMutationTargetMetadataV1Issue) {
    super(`Executor point-mutation metadata failed: ${issue}.`);
  }
}

export type ExecutorPointMutationScopeAuthorityV1Issue =
  | "corrupt"
  | "deploymentMismatch"
  | "scopeMismatch";

export class ExecutorPointMutationScopeAuthorityV1Error extends Error {
  readonly name = "ExecutorPointMutationScopeAuthorityV1Error";

  constructor(readonly issue: ExecutorPointMutationScopeAuthorityV1Issue) {
    super(`Executor point-mutation scope authority failed: ${issue}.`);
  }
}

const executorPreparedPointMutationStartBrand: unique symbol = Symbol(
  "FlarexExecutor/ExecutorPreparedPointMutationStartV1",
);

export interface ExecutorPreparedPointMutationStartV1 {
  readonly [executorPreparedPointMutationStartBrand]: true;
}

const executorPreparedEvidenceByHandle = new WeakMap<
  object,
  PreparedPointMutationStartEvidenceV1
>();

export class InvalidExecutorPreparedPointMutationStartV1Error extends Error {
  readonly name = "InvalidExecutorPreparedPointMutationStartV1Error";

  constructor() {
    super("Value is not a process-local executor-prepared point-mutation start.");
  }
}

export interface ExecutorPointMutationStartPreparationV1 {
  readonly prepare: (
    candidate: ExecutorPointMutationStartCandidateV1,
  ) => Promise<ExecutorPreparedPointMutationStartV1>;
}

export function createExecutorPointMutationStartPreparationV1(
  runtime: ExecutorPointMutationStartPreparationRuntimeV1,
): ExecutorPointMutationStartPreparationV1 {
  const loadActiveTargetMetadata = runtime.loadActiveTargetMetadata;
  const loadCurrentScopeAuthority = runtime.loadCurrentScopeAuthority;

  return Object.freeze({
    prepare: async (
      candidate: ExecutorPointMutationStartCandidateV1,
    ): Promise<ExecutorPreparedPointMutationStartV1> => {
      const deploymentId = candidate.deploymentId;
      const functionPath = candidate.functionPath;
      const requestKey = candidate.requestKey;
      const args = candidate.args;
      const snapshottedArgs = normalizeFlarexValueV1(args).value;
      const unresolvedMetadata = await loadActiveTargetMetadata(
        deploymentId,
        functionPath,
      );
      if (unresolvedMetadata === null) {
        throw new ExecutorPointMutationTargetMetadataV1Error("missing");
      }
      const metadata = decodeTargetMetadata(unresolvedMetadata);
      const unresolvedAuthority = await loadCurrentScopeAuthority(
        deploymentId,
      );
      const authority = decodeScopeAuthority(unresolvedAuthority);
      if (authority.deploymentId !== metadata.deploymentId) {
        throw new ExecutorPointMutationScopeAuthorityV1Error(
          "deploymentMismatch",
        );
      }
      if (authority.scopeId !== metadata.scopeId) {
        throw new ExecutorPointMutationScopeAuthorityV1Error(
          "scopeMismatch",
        );
      }

      const evidence = await preparePointMutationStartEvidenceV1(
        metadata,
        {
          deploymentId,
          functionPath,
          args: snapshottedArgs,
          requestKey,
        },
        authority.authorizationRevocationEpoch,
      );
      const handle = Object.freeze({
        [executorPreparedPointMutationStartBrand]: true as const,
      });
      executorPreparedEvidenceByHandle.set(handle, evidence);
      return handle;
    },
  });
}

function decodeTargetMetadata(
  value: unknown,
): ActivePointMutationTargetMetadataV1 {
  try {
    return decodeActivePointMutationTargetMetadataV1(value);
  } catch {
    throw new ExecutorPointMutationTargetMetadataV1Error("corrupt");
  }
}

function decodeScopeAuthority(
  value: unknown,
): PointMutationCurrentScopeAuthorityV1 {
  try {
    return decodePointMutationCurrentScopeAuthorityV1(value);
  } catch {
    throw new ExecutorPointMutationScopeAuthorityV1Error("corrupt");
  }
}

export function inspectExecutorPreparedPointMutationStartV1(
  value: unknown,
): PreparedPointMutationStartEvidenceV1 {
  if (typeof value !== "object" || value === null) {
    throw new InvalidExecutorPreparedPointMutationStartV1Error();
  }
  const evidence = executorPreparedEvidenceByHandle.get(value);
  if (evidence === undefined) {
    throw new InvalidExecutorPreparedPointMutationStartV1Error();
  }
  return evidence;
}
