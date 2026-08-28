import { Effect, Layer, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from
  "flarex-protocol/transaction-session";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));

import {
  ApplicationMutationSystemConfigurationError,
  ApplicationMutationSystem,
  inspectApplicationMutationAuthenticatedIdentity,
  invokeApplicationMutation,
  invokeAuthenticatedApplicationMutation,
  prepareApplicationMutationAuthenticatedIdentity,
  preflightApplicationMutationSystemConfiguration,
} from "../src/ApplicationMutationSystem";

describe("Application mutation System", () => {
  it("rejects an unregistered legacy verifier during construction preflight", () => {
    const verify = vi.fn(async () => {
      throw new Error("must not verify");
    });

    expect(() => preflightApplicationMutationSystemConfiguration(
      // @ts-expect-error Intentionally incomplete hostile configuration.
      { legacyGrantVerifier: Object.freeze({ verify }) },
    )).toThrow(ApplicationMutationSystemConfigurationError);
    expect(verify).not.toHaveBeenCalled();
  });

  it("routes root invocation only through the Application service", async () => {
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
      ApplicationMutationSystem.of({
        selectionMutation: Object.freeze({ runMutation: vi.fn() }),
        invoke,
        invokeAuthenticated: vi.fn(),
        invokeAuthenticatedAtTaskLaunch: vi.fn(),
      }),
    );

    const result = await Effect.runPromise(Effect.scoped(
      invokeApplicationMutation(
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

  it("prepares an owned authenticated identity policy for task mutation reuse", async () => {
    const identity = {
      kind: "user",
      user: {
        tokenIdentifier: "opaque-task-principal-1",
        issuer: "https://identity.example.test",
        subject: "user-1",
        email: "user-1@example.test",
        tenant: { id: "tenant-1", roles: ["editor"] },
      },
    };
    const prepared = await Effect.runPromise(
      prepareApplicationMutationAuthenticatedIdentity(identity),
    );
    const expected = await Effect.runPromise(
      canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        auth: {
          kind: "verifiedBearer",
          issuer: "https://identity.example.test",
          subject: "user-1",
          tokenIdentifier: "opaque-task-principal-1",
          claims: {
            email: "user-1@example.test",
            tenant: { id: "tenant-1", roles: ["editor"] },
          },
        },
        capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      }),
    );
    const firstEvidence = Result.getOrThrow(
      inspectApplicationMutationAuthenticatedIdentity(prepared),
    );

    identity.user.email = "attacker@example.test";
    identity.user.tenant.roles[0] = "owner";
    firstEvidence.identityAccessPolicySha256.fill(0);

    expect(
      Result.getOrThrow(
        inspectApplicationMutationAuthenticatedIdentity(prepared),
      ).identityAccessPolicySha256,
    ).toEqual(
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
        expected.sha256Hex,
      ),
    );
    expect(Result.isFailure(
      inspectApplicationMutationAuthenticatedIdentity(Object.freeze({})),
    )).toBe(true);

    await expect(Effect.runPromise(
      prepareApplicationMutationAuthenticatedIdentity({ kind: "anonymous" }),
    )).rejects.toMatchObject({
      _tag: "ApplicationMutationInputError",
      field: "identity",
    });
  });

  it("routes authenticated mutation invocation through the dedicated service operation", async () => {
    const identity = await Effect.runPromise(
      prepareApplicationMutationAuthenticatedIdentity({
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user-1",
          issuer: "issuer",
          subject: "user-1",
        },
      }),
    );
    const outcome = Object.freeze({
      status: "committed" as const,
      disposition: "replayed" as const,
      scopeUuid: "00000000-0000-4000-8000-000000000001",
      epochUuid: "00000000-0000-4000-8000-000000000002",
      commitSeq: 10n,
      value: Object.freeze({ authenticated: true }),
    });
    const invoke = vi.fn();
    const invokeAuthenticated = vi.fn(() => Effect.succeed(outcome));
    const layer = Layer.succeed(
      ApplicationMutationSystem,
      ApplicationMutationSystem.of({
        selectionMutation: Object.freeze({ runMutation: vi.fn() }),
        invoke,
        invokeAuthenticated,
        invokeAuthenticatedAtTaskLaunch: vi.fn(),
      }),
    );
    const functionRef = TransactionFunctionPathV1Schema.make("recipes:update");
    const requestKey = TransactionRequestKeyV1Schema.make(
      "request-authenticated-application-system-1",
    );

    const result = await Effect.runPromise(Effect.scoped(
      invokeAuthenticatedApplicationMutation(
        functionRef,
        { servings: 3 },
        requestKey,
        identity,
      ).pipe(Effect.provide(layer)),
    ));

    expect(result).toBe(outcome);
    expect(invoke).not.toHaveBeenCalled();
    expect(invokeAuthenticated).toHaveBeenCalledWith(
      functionRef,
      { servings: 3 },
      requestKey,
      identity,
    );
  });
});
