import {
  type DeploymentProjectScopeLookupBudgetV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { Effect, Result } from "effect";

import { makeDeploymentProjectScopeLookupClientV1 } from "../src/deploymentProjectScopeLookup";

interface TestEnv {
  readonly FLAREX_EXECUTOR: Fetcher;
  readonly FLAREX_EXECUTOR_TOKEN: string;
}

const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 8_192,
  maximumBodyBytes: 8_192,
  maximumCanonicalBytes: 8_192,
  maximumFrameBytes: 8_192,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const input = await request.json() as { deploymentId?: unknown; projectId?: unknown };
    const client = makeDeploymentProjectScopeLookupClientV1(env);
    if (Result.isFailure(client)) {
      return Response.json({ kind: "configurationFailure" }, { status: 500 });
    }
    const effect = client.success.lookup({
      deploymentId: String(input.deploymentId),
      projectId: String(input.projectId),
      budget,
    }).pipe(
      Effect.map((match) => ({
        kind: "matched" as const,
        deploymentId: match.deploymentId,
        projectId: match.projectId,
        deploymentCreatedAt: match.deploymentCreatedAt,
      })),
      Effect.catch((error) => Effect.succeed({
        kind: error._tag,
      })),
    );
    return Response.json(await Effect.runPromise(effect));
  },
};
