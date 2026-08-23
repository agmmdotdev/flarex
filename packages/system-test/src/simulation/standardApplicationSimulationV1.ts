import type {
  StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import type {
  StandardApplicationTaskDefinitionV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import type { Effect } from "effect";

import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
} from "../environment/standardApplicationEnvironmentV1";

export interface StandardApplicationSimulationApplicationV1 {
  readonly applicationId: string;
  readonly revisionName: string;
  readonly define: () => StandardApplicationDefinitionInputV1;
  readonly defineTasks?: () => ReadonlyArray<
    StandardApplicationTaskDefinitionV1<unknown, unknown>
  >;
}

export interface StandardApplicationSimulationRuntimeExpectationsV1 {
  readonly mutations: number;
  readonly queries: number;
}

/**
 * Private author-owned configuration for one real-system Standard Application
 * simulation. Database and host lanes remain runner-owned inputs.
 */
export interface StandardApplicationSimulationV1<Setup, Proof, Error> {
  readonly version: 1;
  readonly simulationId: string;
  readonly application: StandardApplicationSimulationApplicationV1;
  readonly setup: (
    client: StandardApplicationSystemTestSetupClientV1,
  ) => Effect.Effect<Setup, Error>;
  readonly workload: (
    client: StandardApplicationSystemTestClientV1,
    setup: Setup,
  ) => Effect.Effect<Proof, Error>;
  readonly expectedRuntimeExecutions?:
    StandardApplicationSimulationRuntimeExpectationsV1;
}

/**
 * Establishes one consistent private authoring boundary while preserving the
 * exact setup, proof, and typed-error inference of each simulation.
 */
export function defineStandardApplicationSimulationV1<Setup, Proof, Error>(
  input: StandardApplicationSimulationV1<Setup, Proof, Error>,
): StandardApplicationSimulationV1<Setup, Proof, Error> {
  const application = Object.freeze({ ...input.application });
  const expectedRuntimeExecutions = input.expectedRuntimeExecutions;
  let ownedRuntimeExpectations:
    StandardApplicationSimulationRuntimeExpectationsV1 | undefined;
  if (expectedRuntimeExecutions !== undefined) {
    const mutations = expectedRuntimeExecutions.mutations;
    const queries = expectedRuntimeExecutions.queries;
    if (
      !isNonNegativeSafeInteger(mutations) ||
      !isNonNegativeSafeInteger(queries)
    ) {
      throw new RangeError(
        "Standard Application simulation runtime expectations must be non-negative safe integers.",
      );
    }
    ownedRuntimeExpectations = Object.freeze({ mutations, queries });
  }

  return Object.freeze({
    version: 1,
    simulationId: input.simulationId,
    application,
    setup: input.setup,
    workload: input.workload,
    ...(ownedRuntimeExpectations === undefined
      ? {}
      : { expectedRuntimeExecutions: ownedRuntimeExpectations }),
  });
}
