import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));

import {
  ApplicationMutationSystemConfigurationError,
  ApplicationMutationSystem,
  preflightApplicationMutationSystemConfiguration,
} from "../src/ApplicationMutationSystem";
import { invokeStandardApplicationPointMutationV1 } from "../src/v1";

describe("Application mutation System", () => {
  it("rejects an unregistered legacy verifier during construction preflight", () => {
    const verify = vi.fn(async () => {
      throw new Error("must not verify");
    });

    expect(() => preflightApplicationMutationSystemConfiguration({
      legacyGrantVerifier: Object.freeze({ verify }),
    })).toThrow(ApplicationMutationSystemConfigurationError);
    expect(verify).not.toHaveBeenCalled();
  });

  it("routes the Standard entrypoint only through the unversioned Application service", async () => {
    const invoke = vi.fn(() => Effect.succeed(Object.freeze({
      status: "committed" as const,
      disposition: "replayed" as const,
      scopeUuid: "00000000-0000-4000-8000-000000000001",
      epochUuid: "00000000-0000-4000-8000-000000000002",
      commitSeq: 9n,
      value: Object.freeze({ ok: true }),
    })));
    const layer = Layer.succeed(
      ApplicationMutationSystem,
      ApplicationMutationSystem.of({ invoke }),
    );

    const result = await Effect.runPromise(Effect.scoped(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:update"),
        { servings: 2 },
        TransactionRequestKeyV1Schema.make("request-application-system-1"),
      ).pipe(Effect.provide(layer)),
    ));

    expect(result).toMatchObject({
      status: "committed",
      disposition: "replayed",
      commitSeq: 9n,
      value: { ok: true },
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
});
