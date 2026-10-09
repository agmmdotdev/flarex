import { Effect } from "effect";

import type {
  PointCommitPublicationCommandV1,
  PointCommitPublisherPortV1,
  PointCommitRollbackProofPortV1,
  PointCommitTransactionCommandV1,
} from "@flarex/persistence-postgres/point-commit-transaction";

import type {
  StoredPointCommitPlanningV1,
  StoredPointCommitPublisherV1,
  StoredPointCommitRollbackProofV1,
} from "../storedAttemptAuthentication";
import type {
  PreparedPointCommitCapabilityStateV1,
  StoredPointMutationCapabilityVaultV1,
} from "./capabilityState";
import {
  InvalidPreparedPointCommitV1Error,
  type PreparedPointCommitV1,
} from "./planningOperations";

export interface StoredPointCommitRollbackProofOperationDependenciesV1 {
  readonly base: StoredPointCommitPlanningV1;
  readonly pointCommit: PointCommitRollbackProofPortV1;
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly captureTransactionCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitTransactionCommandV1;
}

export interface StoredPointCommitPublicationOperationDependenciesV1 {
  readonly base: StoredPointCommitRollbackProofV1;
  readonly pointCommit: PointCommitPublisherPortV1;
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly capturePublicationCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitPublicationCommandV1;
}

export function makeStoredPointCommitRollbackProofOperationsV1(
  dependencies: StoredPointCommitRollbackProofOperationDependenciesV1,
): StoredPointCommitRollbackProofV1 {
  const {
    base,
    pointCommit,
    preparedPointCommitStates,
    captureTransactionCommand,
  } = dependencies;

  const provePointCommitRollback:
    StoredPointCommitRollbackProofV1["provePointCommitRollback"] = Effect.fn(
      "StoredAttemptAuthentication.provePointCommitRollback",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      return yield* pointCommit.prove(captureTransactionCommand(state));
    });

  return Object.freeze({
    ...base,
    provePointCommitRollback,
  } satisfies StoredPointCommitRollbackProofV1);
}

export function makeStoredPointCommitPublicationOperationsV1(
  dependencies: StoredPointCommitPublicationOperationDependenciesV1,
): StoredPointCommitPublisherV1 {
  const {
    base,
    pointCommit,
    preparedPointCommitStates,
    capturePublicationCommand,
  } = dependencies;

  const publishPointCommit:
    StoredPointCommitPublisherV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishPointCommit",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      return yield* pointCommit.publish(capturePublicationCommand(state));
    });

  return Object.freeze({
    ...base,
    publishPointCommit,
  } satisfies StoredPointCommitPublisherV1);
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  value: PreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}
