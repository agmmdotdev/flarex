import {
  decodeDeploymentProjectScopeLookupResponseV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  encodeDeploymentProjectScopeLookupBudgetHeaderV1,
  encodeDeploymentProjectScopeLookupRequestV1,
  type DeploymentProjectScopeLookupBudgetV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { createPGlitePersistence } from "@flarex/persistence-postgres/pglite";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { makeDeploymentProjectScopeLookupHostV1 } from "../src/deploymentProjectScopeLookup";

const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 4_096,
  maximumBodyBytes: 4_096,
  maximumCanonicalBytes: 4_096,
  maximumFrameBytes: 4_096,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

describe("deployment project-scope lookup PGlite proof", () => {
  it("reads the exact deployment relationship without any durable write", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const inserted = await persistence.insertDeploymentMetadata({
      deploymentId: "deployment-pglite-scope",
      projectId: "project-pglite-scope",
    });
    const before = await persistence.listDeploymentMetadata({ limit: 10 });
    const host = makeDeploymentProjectScopeLookupHostV1(persistence);

    const matched = await host(request("deployment-pglite-scope", "project-pglite-scope"));
    const missing = await host(request("deployment-pglite-missing", "project-pglite-scope"));
    const mismatch = await host(request("deployment-pglite-scope", "wrong-project"));
    expect(matched.status).toBe(200);
    expect(missing.status).toBe(404);
    expect(mismatch.status).toBe(409);
    expect(unwrap(decodeDeploymentProjectScopeLookupResponseV1(
      new Uint8Array(await matched.arrayBuffer()),
      budget,
    )).value).toEqual({
      codecVersion: 1,
      kind: "matched",
      deploymentId: inserted.deploymentId,
      projectId: inserted.projectId,
      deploymentCreatedAt: inserted.createdAt.toISOString(),
    });
    expect(await persistence.listDeploymentMetadata({ limit: 10 })).toEqual(before);
  });
});

function request(deploymentId: string, projectId: string): Request {
  const body = unwrap(encodeDeploymentProjectScopeLookupRequestV1({
    codecVersion: 1,
    deploymentId,
    projectId,
  }, budget));
  return new Request("https://executor.test/internal/v1/deployment-project-scope/lookup", {
    method: "POST",
    headers: {
      "content-type": deploymentProjectScopeLookupMediaTypeV1,
      [deploymentProjectScopeLookupBudgetHeaderV1]: unwrap(
        encodeDeploymentProjectScopeLookupBudgetHeaderV1(budget),
      ),
    },
    body: copyBytesToArrayBuffer(body.bytes),
  });
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
