import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  authorizePublicDeploymentPushMutationRequest,
  authorizePublicAnalyzedStartRequest,
  publicDeploymentPushAuthorizationErrorToHttpError,
  publicAnalyzedStartAuthorizationErrorToHttpError,
  PublicDeploymentPushAuthorizationError,
  PublicAnalyzedStartAuthorizationError,
} from "../src/worker/PublicAnalyzedStartAuthorization";
import type { Env } from "../src/types";

type PublicDeploymentPushAuthorizationEnv = Pick<Env, "FLAREX_ANALYZED_START_TOKEN">;

describe("public deployment push authorization", () => {
  it("requires an explicit internal deploy-push token", async () => {
    await expect(Effect.runPromise(authorizePublicDeploymentPushMutationRequest(
      new Request("https://worker.test/deployments/demo/push/start"),
      {} satisfies PublicDeploymentPushAuthorizationEnv,
    ))).rejects.toBeInstanceOf(PublicDeploymentPushAuthorizationError);

    await expect(Effect.runPromise(authorizePublicDeploymentPushMutationRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed", {
        headers: { authorization: "Bearer   " },
      }),
      { FLAREX_ANALYZED_START_TOKEN: "   " } satisfies PublicDeploymentPushAuthorizationEnv,
    ))).rejects.toBeInstanceOf(PublicDeploymentPushAuthorizationError);
  });

  it("rejects missing or mismatched bearer credentials", async () => {
    const env = {
      FLAREX_ANALYZED_START_TOKEN: "deploy-secret",
    } satisfies PublicDeploymentPushAuthorizationEnv;

    await expect(Effect.runPromise(authorizePublicDeploymentPushMutationRequest(
      new Request("https://worker.test/deployments/demo/push/start"),
      env,
    ))).rejects.toBeInstanceOf(PublicDeploymentPushAuthorizationError);

    await expect(Effect.runPromise(authorizePublicDeploymentPushMutationRequest(
      new Request("https://worker.test/deployments/demo/push/start", {
        headers: { authorization: "Bearer wrong" },
      }),
      env,
    ))).rejects.toBeInstanceOf(PublicDeploymentPushAuthorizationError);
  });

  it("allows matching bearer credentials and maps failures to public JSON errors", async () => {
    const env = {
      FLAREX_ANALYZED_START_TOKEN: "deploy-secret",
    } satisfies PublicDeploymentPushAuthorizationEnv;

    await expect(Effect.runPromise(authorizePublicDeploymentPushMutationRequest(
      new Request("https://worker.test/deployments/demo/push/start", {
        headers: { authorization: "Bearer deploy-secret" },
      }),
      env,
    ))).resolves.toBeUndefined();

    expect(publicDeploymentPushAuthorizationErrorToHttpError(
      new PublicDeploymentPushAuthorizationError(),
    )).toMatchObject({
      status: 401,
      message: "Unauthorized deployment push request.",
    });
  });

  it("keeps the analyzed-start authorization export as a compatibility alias", async () => {
    const env = {
      FLAREX_ANALYZED_START_TOKEN: "deploy-secret",
    } satisfies PublicDeploymentPushAuthorizationEnv;

    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed", {
        headers: { authorization: "Bearer deploy-secret" },
      }),
      env,
    ))).resolves.toBeUndefined();

    expect(publicAnalyzedStartAuthorizationErrorToHttpError(
      new PublicAnalyzedStartAuthorizationError(),
    )).toMatchObject({
      status: 401,
      message: "Unauthorized analyzed start-push request.",
    });
    expect(new PublicDeploymentPushAuthorizationError()).toMatchObject({
      _tag: "PublicAnalyzedStartAuthorizationError",
    });
  });
});
