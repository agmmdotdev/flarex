import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  authorizePublicAnalyzedStartRequest,
  publicAnalyzedStartAuthorizationErrorToHttpError,
  PublicAnalyzedStartAuthorizationError,
} from "../src/worker/PublicAnalyzedStartAuthorization";
import type { Env } from "../src/types";

type PublicAnalyzedStartAuthorizationEnv = Pick<Env, "FLAREX_ANALYZED_START_TOKEN">;

describe("public analyzed start authorization", () => {
  it("requires an explicit internal analyzed-start token", async () => {
    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed"),
      {} satisfies PublicAnalyzedStartAuthorizationEnv,
    ))).rejects.toBeInstanceOf(PublicAnalyzedStartAuthorizationError);

    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed", {
        headers: { authorization: "Bearer   " },
      }),
      { FLAREX_ANALYZED_START_TOKEN: "   " } satisfies PublicAnalyzedStartAuthorizationEnv,
    ))).rejects.toBeInstanceOf(PublicAnalyzedStartAuthorizationError);
  });

  it("rejects missing or mismatched bearer credentials", async () => {
    const env = {
      FLAREX_ANALYZED_START_TOKEN: "analyzed-secret",
    } satisfies PublicAnalyzedStartAuthorizationEnv;

    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed"),
      env,
    ))).rejects.toBeInstanceOf(PublicAnalyzedStartAuthorizationError);

    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed", {
        headers: { authorization: "Bearer wrong" },
      }),
      env,
    ))).rejects.toBeInstanceOf(PublicAnalyzedStartAuthorizationError);
  });

  it("allows matching bearer credentials and maps failures to public JSON errors", async () => {
    const env = {
      FLAREX_ANALYZED_START_TOKEN: "analyzed-secret",
    } satisfies PublicAnalyzedStartAuthorizationEnv;

    await expect(Effect.runPromise(authorizePublicAnalyzedStartRequest(
      new Request("https://worker.test/deployments/demo/push/start-analyzed", {
        headers: { authorization: "Bearer analyzed-secret" },
      }),
      env,
    ))).resolves.toBeUndefined();

    expect(publicAnalyzedStartAuthorizationErrorToHttpError(
      new PublicAnalyzedStartAuthorizationError(),
    )).toMatchObject({
      status: 401,
      message: "Unauthorized analyzed start-push request.",
    });
  });
});
