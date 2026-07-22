import type {
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupUsageV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import {
  DeploymentProjectScopeAuthorizationInputV1Error,
  DeploymentProjectScopeWitnessV1Error,
  makeDeploymentProjectScopeAuthorizerV1,
} from "../src/deploymentProjectScopeAuthorization";
import {
  DeploymentProjectScopeLookupNotFoundV1Error,
  type DeploymentProjectScopeLookupInputV1,
  type DeploymentProjectScopeLookupClientV1,
} from "../src/deploymentProjectScopeLookup";
import type { Env } from "../src/types";
import { PublicDeploymentPushAuthorizationError } from "../src/worker/PublicAnalyzedStartAuthorization";

const budget = Object.freeze({
  maximumLookupCalls: 1,
  maximumInputBytes: 8_192,
  maximumBodyBytes: 8_192,
  maximumCanonicalBytes: 8_192,
  maximumFrameBytes: 8_192,
  maximumElapsedMilliseconds: 1_000,
}) satisfies DeploymentProjectScopeLookupBudgetV1;
const zeroUsage = Object.freeze({
  lookupCalls: 1,
  inputBytes: 10,
  bodyBytes: 20,
  canonicalBytes: 20,
  frameBytes: 20,
  elapsedMilliseconds: 0,
}) satisfies DeploymentProjectScopeLookupUsageV1;

describe("backend deployment project-scope authorizer", () => {
  it("orders push authentication and configured project before exact lookup", async () => {
    const lookup = vi.fn((input) => Effect.succeed(Object.freeze({
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      usage: zeroUsage,
    })));
    const authorizer = unwrap(makeDeploymentProjectScopeAuthorizerV1(
      env(),
      Object.freeze({ lookup }) satisfies DeploymentProjectScopeLookupClientV1,
    ));
    const request = pushRequest("push-secret");
    const witness = await Effect.runPromise(authorizer.authorize(request, input()));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[0]).toMatchObject({
      deploymentId: "deployment-a",
      projectId: "configured-project",
    });
    const claimed = unwrap(authorizer.claim(witness, request, "deployment-a"));
    expect(claimed).toMatchObject({
      deploymentId: "deployment-a",
      projectId: "configured-project",
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      issuerIdentity: "flarex-backend/deployment-project-scope-authorizer/v1",
    });
  });

  it("short-circuits unauthorized push and missing configured project before lookup", async () => {
    const lookup = vi.fn(() => Effect.die("lookup must not run"));
    const unauthorized = unwrap(makeDeploymentProjectScopeAuthorizerV1(
      env(),
      { lookup },
    ));
    await expect(Effect.runPromise(unauthorized.authorize(
      pushRequest("wrong"),
      input(),
    ))).rejects.toBeInstanceOf(PublicDeploymentPushAuthorizationError);

    const missingProject = unwrap(makeDeploymentProjectScopeAuthorizerV1(
      env({ omitProject: true }),
      { lookup },
    ));
    await expect(Effect.runPromise(missingProject.authorize(
      pushRequest("push-secret"),
      input(),
    ))).rejects.toMatchObject({ reason: "missingExecutorProjectId" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ignores caller-authored project fields and preserves direct lookup failures", async () => {
    const failure = new DeploymentProjectScopeLookupNotFoundV1Error({
      deploymentId: "deployment-a",
    });
    const lookup = vi.fn((lookupInput: DeploymentProjectScopeLookupInputV1) => {
      expect(lookupInput.projectId).toBe("configured-project");
      return Effect.fail(failure);
    });
    const authorizer = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), { lookup }));
    const hostileInput = {
      ...input(),
      projectId: "caller-project",
    } as Parameters<typeof authorizer.authorize>[1];
    await expect(Effect.runPromise(authorizer.authorize(
      pushRequest("push-secret"),
      hostileInput,
    ))).rejects.toBe(failure);
  });

  it("enforces same-factory request-bound single-use witness ownership", async () => {
    const client = matchingClient();
    const first = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), client));
    const second = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), client));
    const request = pushRequest("push-secret");
    const witness = await Effect.runPromise(first.authorize(request, input()));

    expect(failureReason(first.claim({}, request, "deployment-a"))).toBe("invalidWitness");
    expect(failureReason(second.claim(witness, request, "deployment-a"))).toBe("invalidWitness");
    expect(failureReason(first.claim(witness, pushRequest("push-secret"), "deployment-a")))
      .toBe("wrongRequest");
    expect(failureReason(first.claim(witness, request, "deployment-b")))
      .toBe("wrongDeployment");
    expect(Result.isSuccess(first.claim(witness, request, "deployment-a"))).toBe(true);
    expect(failureReason(first.claim(witness, request, "deployment-a"))).toBe("alreadyClaimed");
    expect(JSON.stringify(witness)).toBe("{}");
  });

  it("validates mandatory cumulative and command budgets before authorization", async () => {
    const lookup = vi.fn(() => Effect.die("lookup must not run"));
    const authorizer = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), { lookup }));
    await expect(Effect.runPromise(authorizer.authorize(pushRequest("push-secret"), {
      deploymentId: "deployment-a",
      budget: { cumulative: budget, command: { ...budget, maximumLookupCalls: 2 } },
    }))).rejects.toBeInstanceOf(DeploymentProjectScopeAuthorizationInputV1Error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("requires the private executor service binding before witness issuance", () => {
    const configuredUrlOnly = env();
    delete configuredUrlOnly.FLAREX_EXECUTOR;
    configuredUrlOnly.FLAREX_EXECUTOR_URL = "https://public-executor.example.test";
    expect(unwrapFailure(makeDeploymentProjectScopeAuthorizerV1(configuredUrlOnly)))
      .toMatchObject({ reason: "missingExecutorServiceBinding" });
  });

  it("charges monotonic elapsed time and interruption mints no witness", async () => {
    const slowClient: DeploymentProjectScopeLookupClientV1 = {
      lookup: (lookupInput) => Effect.gen(function* () {
        yield* TestClock.adjust(1_001);
        return {
          deploymentId: lookupInput.deploymentId,
          projectId: lookupInput.projectId,
          deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
          usage: zeroUsage,
        };
      }),
    };
    const slow = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), slowClient));
    await expect(Effect.runPromise(slow.authorize(
      pushRequest("push-secret"),
      input(),
    ).pipe(Effect.provide(TestClock.layer())))).rejects.toMatchObject({
      field: "elapsedMilliseconds",
    });

    const interrupted = unwrap(makeDeploymentProjectScopeAuthorizerV1(env(), {
      lookup: () => Effect.never,
    }));
    const fiber = Effect.runFork(interrupted.authorize(
      pushRequest("push-secret"),
      input(),
    ));
    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

function matchingClient(): DeploymentProjectScopeLookupClientV1 {
  return Object.freeze({
    lookup: (lookupInput: DeploymentProjectScopeLookupInputV1) => Effect.succeed(Object.freeze({
      deploymentId: lookupInput.deploymentId,
      projectId: lookupInput.projectId,
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      usage: zeroUsage,
    })),
  });
}

function input() {
  return Object.freeze({
    deploymentId: "deployment-a",
    budget: Object.freeze({ cumulative: budget, command: budget }),
  });
}

function env(options: { readonly omitProject?: boolean } = {}): Env {
  return {
    FLAREX_ANALYZED_START_TOKEN: "push-secret",
    ...(options.omitProject === true ? {} : { FLAREX_PROJECT_ID: "configured-project" }),
    FLAREX_EXECUTOR_TOKEN: "executor-secret",
    FLAREX_EXECUTOR: { fetch: async () => new Response() } as unknown as Fetcher,
  } as Env;
}

function pushRequest(token: string): Request {
  return new Request("https://backend.test/api/deployments/deployment-a/push", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

function failureReason(
  result: Result.Result<unknown, DeploymentProjectScopeWitnessV1Error>,
): DeploymentProjectScopeWitnessV1Error["reason"] | undefined {
  return Result.isFailure(result) ? result.failure.reason : undefined;
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function unwrapFailure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error("expected Result failure");
  return result.failure;
}
