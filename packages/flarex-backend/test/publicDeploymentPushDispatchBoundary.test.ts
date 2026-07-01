import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  abandonDeploymentPushEffect,
  dispatchDeploymentPushEffect,
  finishDeploymentPushEffect,
  type PublicDeploymentPushDispatchTarget,
  readDeploymentPushEffect,
  readDeploymentPushForFinishArtifactEffect,
  startAnalyzedDeploymentPushEffect,
  startDeploymentPushEffect,
} from "../src/deployment/PublicPushDispatchBoundary";
import type {
  AbandonPushRequest,
  AnalyzedStartPushRequest,
  FinishPushRequest,
} from "flarex-protocol/deployment";
import type { PublicWorkerDispatchSource } from "../src/worker/PublicRouteDispatchError";

describe("public deployment push dispatch boundary", () => {
  it("dispatches public deployment push operations to preserved internal routes", async () => {
    for (const operation of deploymentPushOperations()) {
      const requests: DispatchedRequest[] = [];
      const forwarded = Response.json({ ok: true });

      const response = await Effect.runPromise(operation.run(
        deploymentTarget(requests, async () => forwarded),
      ));

      expect(response).toBe(forwarded);
      expect(requests).toEqual([operation.expected]);
    }
  });

  it("maps deployment push dispatch failures to operation-specific worker errors", async () => {
    for (const operation of deploymentPushOperations()) {
      const failure = await Effect.runPromise(Effect.flip(operation.run(
        failingDeploymentTarget(`${operation.source} unavailable`),
      )));

      expect(failure).toMatchObject({
        _tag: "PublicWorkerDispatchError",
        source: operation.source,
        status: 500,
        message: `${operation.source} unavailable`,
      });
    }
  });

  it("runs the shared dispatch helper with operation-specific failure tagging", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ ok: true });

    const response = await Effect.runPromise(dispatchDeploymentPushEffect(
      deploymentTarget(requests, async () => forwarded),
      "deployment-read-push",
      "/push/shared-helper",
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/push/shared-helper",
      method: undefined,
      contentType: null,
      body: undefined,
    }]);

    const failure = await Effect.runPromise(Effect.flip(dispatchDeploymentPushEffect(
      failingDeploymentTarget("shared helper unavailable"),
      "deployment-finish-push",
      "/push/shared-helper/finish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(finishRequest()),
      },
    )));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-finish-push",
      status: 500,
      message: "shared helper unavailable",
    });
  });
});

type DispatchedRequest = {
  readonly input: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: BodyInit | null | undefined;
};

type DeploymentPushOperation = {
  readonly source: PublicWorkerDispatchSource;
  readonly expected: DispatchedRequest;
  readonly run: (
    deployment: PublicDeploymentPushDispatchTarget,
  ) => Effect.Effect<Response, unknown>;
};

function deploymentPushOperations(): DeploymentPushOperation[] {
  const pushId = "push/with space";
  const encodedPushId = "push%2Fwith%20space";
  const abandon = abandonRequest();
  const finish = finishRequest();
  const analyzed = analyzedStartPushRequest();

  return [
    {
      source: "deployment-read-push",
      expected: {
        input: `https://flarex.internal/push/${encodedPushId}`,
        method: undefined,
        contentType: null,
        body: undefined,
      },
      run: deployment => readDeploymentPushEffect(deployment, pushId),
    },
    {
      source: "deployment-finish-push-artifact",
      expected: {
        input: `https://flarex.internal/push/${encodedPushId}`,
        method: undefined,
        contentType: null,
        body: undefined,
      },
      run: deployment => readDeploymentPushForFinishArtifactEffect(deployment, pushId),
    },
    {
      source: "deployment-abandon-push",
      expected: {
        input: `https://flarex.internal/push/${encodedPushId}/abandon`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(abandon),
      },
      run: deployment => abandonDeploymentPushEffect(deployment, pushId, abandon),
    },
    {
      source: "deployment-finish-push",
      expected: {
        input: `https://flarex.internal/push/${encodedPushId}/finish`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(finish),
      },
      run: deployment => finishDeploymentPushEffect(deployment, pushId, finish),
    },
    {
      source: "deployment-start-push",
      expected: {
        input: "https://flarex.internal/push/start-analyzed",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(analyzed),
      },
      run: deployment => startDeploymentPushEffect(deployment, analyzed),
    },
    {
      source: "deployment-start-analyzed-push",
      expected: {
        input: "https://flarex.internal/push/start-analyzed",
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(analyzed),
      },
      run: deployment => startAnalyzedDeploymentPushEffect(deployment, analyzed),
    },
  ];
}

function deploymentTarget(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicDeploymentPushDispatchTarget {
  return {
    fetch: async (input, init) => {
      requests.push({
        input,
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body,
      });
      return respond();
    },
  };
}

function failingDeploymentTarget(message: string): PublicDeploymentPushDispatchTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}

function abandonRequest(): AbandonPushRequest {
  return { reason: "typed dispatch test" };
}

function finishRequest(): FinishPushRequest {
  return { activate: true };
}

function analyzedStartPushRequest(): AnalyzedStartPushRequest {
  return {
    sourcePackage: {
      modules: [
        {
          path: "__execution.ts",
          environment: "isolate",
          sha256: "a".repeat(64),
        },
      ],
      functions: [],
      execution: "__execution.ts",
    },
    analysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: { functions: [] },
    },
    codegenAnalysis: {
      schema: { version: 1, tables: [], indexes: [] },
      functions: [],
    },
  };
}
