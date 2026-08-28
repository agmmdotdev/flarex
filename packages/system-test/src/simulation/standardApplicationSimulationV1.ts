import type { ApplicationDefinition } from "@flarex/application-definition";
import type {
  StandardApplicationTaskDefinitionV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import type { Effect } from "effect";

import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestSetupClientV1,
} from "../environment/standardApplicationEnvironmentV1";

export interface StandardApplicationSimulationActionHostV1 {
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface StandardApplicationSimulationApplicationV1 {
  readonly applicationId: string;
  readonly revisionName: string;
  readonly define: () => ApplicationDefinition;
  readonly defineTasks?: () => ReadonlyArray<
    StandardApplicationTaskDefinitionV1<unknown, unknown>
  >;
  readonly actionHost?: StandardApplicationSimulationActionHostV1;
}

export interface StandardApplicationSimulationRuntimeExpectationsV1 {
  readonly mutations: number;
  readonly queries: number;
  readonly actions?: number;
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
  const actionHost = input.application.actionHost;
  const application = Object.freeze({
    ...input.application,
    ...(actionHost === undefined
      ? {}
      : {
          actionHost: Object.freeze({
            allowedOrigins: Object.freeze([...actionHost.allowedOrigins]),
            fetch: actionHost.fetch,
          }),
        }),
  });
  const expectedRuntimeExecutions = input.expectedRuntimeExecutions;
  let ownedRuntimeExpectations:
    StandardApplicationSimulationRuntimeExpectationsV1 | undefined;
  if (expectedRuntimeExecutions !== undefined) {
    const mutations = expectedRuntimeExecutions.mutations;
    const queries = expectedRuntimeExecutions.queries;
    const actions = expectedRuntimeExecutions.actions;
    if (
      !isNonNegativeSafeInteger(mutations) ||
      !isNonNegativeSafeInteger(queries) ||
      (actions !== undefined && !isNonNegativeSafeInteger(actions))
    ) {
      throw new RangeError(
        "Standard Application simulation runtime expectations must be non-negative safe integers.",
      );
    }
    ownedRuntimeExpectations = Object.freeze({
      mutations,
      queries,
      ...(actions === undefined ? {} : { actions }),
    });
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
