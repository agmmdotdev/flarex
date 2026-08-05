import type {
  StandardApplicationSystemTestClientV1,
  StandardApplicationSystemTestDefinitionV1,
  StandardApplicationSystemTestSetupClientV1,
} from "../environment/standardApplicationEnvironmentV1";
import type { Effect } from "effect";

/**
 * First private scenario vocabulary for one Standard Application environment.
 * It is intentionally typed and callback-based; it is not a serialized DSL.
 */
export interface StandardApplicationSystemTestScenarioV1<Setup, Proof, Error> {
  readonly version: 1;
  readonly scenarioId: string;
  readonly definition: StandardApplicationSystemTestDefinitionV1;
  readonly prepareState: (
    client: StandardApplicationSystemTestSetupClientV1,
  ) => Effect.Effect<Setup, Error>;
  readonly runWorkload: (
    client: StandardApplicationSystemTestClientV1,
    setup: Setup,
  ) => Effect.Effect<Proof, Error>;
}
