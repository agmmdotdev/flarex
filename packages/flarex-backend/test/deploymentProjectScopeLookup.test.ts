import {
  decodeDeploymentProjectScopeLookupBudgetHeaderV1,
  decodeDeploymentProjectScopeLookupRequestV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupBudgetFailureHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  encodeDeploymentProjectScopeLookupResponseV1,
  type DeploymentProjectScopeLookupBudgetV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  deploymentProjectScopeLookupResourceCauseV1,
  DeploymentProjectScopeLookupCorruptionV1Error,
  DeploymentProjectScopeLookupResourceV1Error,
  makeDeploymentProjectScopeLookupClientV1,
} from "../src/deploymentProjectScopeLookup";
import { makeDeploymentProjectScopeLookupHostV1 } from "../../../apps/executor/src/deploymentProjectScopeLookup";

const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 8_192,
  maximumBodyBytes: 8_192,
  maximumCanonicalBytes: 8_192,
  maximumFrameBytes: 8_192,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;

describe("backend deployment project-scope lookup adapter", () => {
  it("completes the real client-to-host path with exactly one admitted lookup", async () => {
    const host = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: async (deploymentId) => ({
        deploymentId,
        projectId: "project-a",
        activePackageId: null,
        activeSchemaVersion: 0,
        createdAt: new Date("2026-07-22T00:00:00.000Z"),
      }),
    });
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: { fetch: host } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    await expect(Effect.runPromise(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget,
    }))).resolves.toMatchObject({
      deploymentId: "deployment-a",
      projectId: "project-a",
    });
  });

  it("sends the private token and strictly decodes a matching settled response", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe("Bearer executor-secret");
      const commandBudget = unwrap(decodeDeploymentProjectScopeLookupBudgetHeaderV1(
        request.headers.get(deploymentProjectScopeLookupBudgetHeaderV1),
      ));
      const decoded = unwrap(decodeDeploymentProjectScopeLookupRequestV1(
        new Uint8Array(await request.arrayBuffer()),
        commandBudget,
      ));
      const response = unwrap(encodeDeploymentProjectScopeLookupResponseV1({
        codecVersion: 1,
        kind: "matched",
        deploymentId: decoded.value.deploymentId,
        projectId: decoded.value.projectId,
        deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      }, commandBudget));
      return new Response(copyBytesToArrayBuffer(response.bytes), {
        status: 200,
        headers: { "content-type": deploymentProjectScopeLookupMediaTypeV1 },
      });
    });
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: { fetch } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));

    const match = await Effect.runPromise(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget,
    }));
    expect(match).toMatchObject({
      deploymentId: "deployment-a",
      projectId: "project-a",
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(match.usage.lookupCalls).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a foreign transport rejection privately and redacts the typed error", async () => {
    const cause = new Error("secret executor transport detail");
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: {
        fetch: async () => {
          throw cause;
        },
      } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    const failure = await rejected(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget,
    }));
    expect(failure).toBeInstanceOf(DeploymentProjectScopeLookupResourceV1Error);
    expect(deploymentProjectScopeLookupResourceCauseV1(
      failure as DeploymentProjectScopeLookupResourceV1Error,
    )).toBe(cause);
    expect(JSON.stringify(failure)).not.toContain("secret executor transport detail");
  });

  it("classifies malformed settled evidence as corruption and preserves defects", async () => {
    const malformed = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: {
        fetch: async () => new Response("{}", {
          status: 200,
          headers: { "content-type": deploymentProjectScopeLookupMediaTypeV1 },
        }),
      } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    await expect(Effect.runPromise(malformed.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget,
    }))).rejects.toBeInstanceOf(DeploymentProjectScopeLookupCorruptionV1Error);

    const defect = new Error("unexpected getter defect");
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "FLAREX_EXECUTOR", {
      get: () => {
        throw defect;
      },
    });
    expect(() => makeDeploymentProjectScopeLookupClientV1(
      hostile as Parameters<typeof makeDeploymentProjectScopeLookupClientV1>[0],
    )).toThrow(defect);
  });

  it("retains executor budget exhaustion in the typed budget channel", async () => {
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: {
        fetch: async () => Response.json(
          { error: "deployment_scope_lookup_budget_exhausted" },
          {
            status: 422,
            headers: {
              [deploymentProjectScopeLookupBudgetFailureHeaderV1]: "canonicalBytes",
            },
          },
        ),
      } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    await expect(Effect.runPromise(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget,
    }))).rejects.toMatchObject({
      _tag: "DeploymentProjectScopeLookupBudgetV1Error",
      field: "canonicalBytes",
    });
  });

  it("fails closed when executor budget evidence is missing or malformed", async () => {
    for (const field of [null, "maximumBodyBytes"]) {
      const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
        FLAREX_EXECUTOR: {
          fetch: async () => Response.json(
            { error: "deployment_scope_lookup_budget_exhausted" },
            {
              status: 422,
              ...(field === null
                ? {}
                : { headers: {
                    [deploymentProjectScopeLookupBudgetFailureHeaderV1]: field,
                  } }),
            },
          ),
        } as unknown as Fetcher,
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
      }));
      await expect(Effect.runPromise(client.lookup({
        deploymentId: "deployment-a",
        projectId: "project-a",
        budget,
      }))).rejects.toBeInstanceOf(DeploymentProjectScopeLookupCorruptionV1Error);
    }
  });

  it("preserves the exact elapsed budget field across the real client-host seam", async () => {
    const host = makeDeploymentProjectScopeLookupHostV1({
      getDeploymentMetadata: () => new Promise(() => undefined),
    });
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: { fetch: host } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    await expect(Effect.runPromise(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget: { ...budget, maximumElapsedMilliseconds: 5 },
    }))).rejects.toMatchObject({
      _tag: "DeploymentProjectScopeLookupBudgetV1Error",
      field: "elapsedMilliseconds",
    });
  });

  it("bounds a never-settling executor fetch by monotonic elapsed budget", async () => {
    const client = unwrap(makeDeploymentProjectScopeLookupClientV1({
      FLAREX_EXECUTOR: {
        fetch: () => new Promise(() => undefined),
      } as unknown as Fetcher,
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    await expect(Effect.runPromise(client.lookup({
      deploymentId: "deployment-a",
      projectId: "project-a",
      budget: { ...budget, maximumElapsedMilliseconds: 5 },
    }))).rejects.toMatchObject({
      _tag: "DeploymentProjectScopeLookupBudgetV1Error",
      field: "elapsedMilliseconds",
    });
  });
});

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

async function rejected<A, E>(effect: Effect.Effect<A, E>): Promise<unknown> {
  try {
    await Effect.runPromise(effect);
  } catch (error) {
    return error;
  }
  throw new Error("expected effect to reject");
}
