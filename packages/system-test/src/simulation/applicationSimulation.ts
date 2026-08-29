import type {
  ApplicationDefinition,
  TaskDefinitionHandle,
} from "@flarex/application-definition";
import type {
  StandardApplicationTaskDefinitionV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import type { Effect } from "effect";

import type {
  SimulationClient,
  SimulationSetupClient,
} from "../environment/applicationEnvironment.js";

export interface SimulationActionHost {
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly fetch: (request: Request) => Promise<Response>;
}

export interface SimulationApplication {
  readonly applicationId: string;
  readonly revisionName: string;
  readonly define: () => ApplicationDefinition;
  readonly defineTasks?: () => ReadonlyArray<
    | TaskDefinitionHandle
    | StandardApplicationTaskDefinitionV1<unknown, unknown>
  >;
  readonly actionHost?: SimulationActionHost;
}

export interface SimulationRuntimeExpectations {
  readonly mutations: number;
  readonly queries: number;
  readonly actions?: number;
}

/**
 * Private author-owned configuration for one real-system Application
 * simulation. Database and host lanes remain runner-owned inputs.
 */
export interface Simulation<Setup, Proof, Error> {
  readonly simulationId: string;
  readonly application: SimulationApplication;
  readonly setup: (
    client: SimulationSetupClient,
  ) => Effect.Effect<Setup, Error>;
  readonly workload: (
    client: SimulationClient,
    setup: Setup,
  ) => Effect.Effect<Proof, Error>;
  readonly expectedRuntimeExecutions?: SimulationRuntimeExpectations;
}

/**
 * Establishes one consistent private authoring boundary while preserving the
 * exact setup, proof, and typed-error inference of each simulation.
 */
export function defineSimulation<Setup, Proof, Error>(
  input: Simulation<Setup, Proof, Error>,
): Simulation<Setup, Proof, Error> {
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
  let ownedRuntimeExpectations: SimulationRuntimeExpectations | undefined;
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
    simulationId: input.simulationId,
    application,
    setup: input.setup,
    workload: input.workload,
    ...(ownedRuntimeExpectations === undefined
      ? {}
      : { expectedRuntimeExecutions: ownedRuntimeExpectations }),
  });
}
