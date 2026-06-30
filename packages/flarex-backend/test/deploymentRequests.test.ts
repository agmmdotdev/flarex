import { Effect } from "effect";
import { DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import { describe, expect, it } from "vitest";
import {
  decodeDeploymentAbandonPushPayload,
  decodeDeploymentAnalyzedStartPushPayload,
  decodeDeploymentFinishPushPayload,
  decodePublicAbandonPushPayload,
  decodePublicAnalyzedStartPushPayload,
  decodePublicFinishPushPayload,
  decodePublicStartPushPayload,
  parseDeploymentAbandonPushPayload,
  parseDeploymentAnalyzedStartPushPayload,
  parseDeploymentFinishPushPayload,
  parsePublicAbandonPushPayload,
  parsePublicAnalyzedStartPushPayload,
  parsePublicFinishPushPayload,
  parsePublicStartPushPayload,
} from "../src/deployment/Requests";

describe("deployment request payloads", () => {
  it("decodes internal DeploymentDO push payloads through the shared source boundary", async () => {
    const analyzed = {
      sourcePackage: sourcePackage(),
      analysis: { schema: {}, functions: {} },
      diagnostics: [{ level: "warn", message: "generated warning" }],
    };
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushPayload(analyzed)))
      .resolves
      .toEqual(analyzed);
    expect(parseDeploymentAnalyzedStartPushPayload(analyzed)).toEqual(analyzed);

    await expect(Effect.runPromise(decodeDeploymentFinishPushPayload({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    expect(parseDeploymentFinishPushPayload({ activate: false }))
      .toEqual({ activate: false });

    await expect(Effect.runPromise(decodeDeploymentAbandonPushPayload({
      reason: "generated output failed",
    }))).resolves.toEqual({ reason: "generated output failed" });
    expect(parseDeploymentAbandonPushPayload({ reason: "manual cancel" }))
      .toEqual({ reason: "manual cancel" });
  });

  it("decodes public push payloads through the shared source boundary", async () => {
    const start = {
      sourcePackage: sourcePackage(),
    };
    await expect(Effect.runPromise(decodePublicStartPushPayload(start)))
      .resolves
      .toEqual(start);
    expect(parsePublicStartPushPayload(start)).toEqual(start);

    const analyzed = {
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    };
    await expect(Effect.runPromise(decodePublicAnalyzedStartPushPayload(analyzed)))
      .resolves
      .toEqual(analyzed);
    expect(parsePublicAnalyzedStartPushPayload(analyzed)).toEqual(analyzed);

    await expect(Effect.runPromise(decodePublicFinishPushPayload({ activate: true })))
      .resolves
      .toEqual({ activate: true });
    expect(parsePublicFinishPushPayload({ activate: false }))
      .toEqual({ activate: false });

    await expect(Effect.runPromise(decodePublicAbandonPushPayload({
      reason: "typecheck failed",
    }))).resolves.toEqual({ reason: "typecheck failed" });
    expect(parsePublicAbandonPushPayload({ reason: "manual cancel" }))
      .toEqual({ reason: "manual cancel" });
  });

  it("normalizes public start source package entries for backend ownership", async () => {
    const body = {
      sourcePackage: {
        modules: [{
          path: "convex/users.ts",
          environment: "isolate",
          sha256: "hash-users",
          source: "export const list = query()",
          sourceMap: "{}",
        }],
        functions: ["users:list"],
        schema: "convex/schema.ts",
        execution: "convex/users.ts",
      },
    };

    await expect(Effect.runPromise(decodePublicStartPushPayload(body)))
      .resolves
      .toEqual(body);
    expect(parsePublicStartPushPayload(body)).toEqual(body);
  });

  it("keeps deployment protocol failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushPayload({
      sourcePackage: sourcePackage(),
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodeDeploymentFinishPushPayload({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodeDeploymentAbandonPushPayload({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodePublicStartPushPayload({})))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodePublicAnalyzedStartPushPayload({
      error: "missing source package",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });
});

function sourcePackage(): {
  sourcePackage: {
    modules: Array<{
      path: string;
      environment: "isolate";
      sha256: string;
    }>;
    functions: string[];
    execution: string;
  };
}["sourcePackage"] {
  return {
    modules: [{
      path: "convex/users.ts",
      environment: "isolate",
      sha256: "hash-users",
    }],
    functions: ["users:list"],
    execution: "convex/users.ts",
  };
}
