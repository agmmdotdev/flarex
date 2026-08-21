import type {
  ReconcileTaskChildMutationDispositionInput,
  TaskChildMutationEffectInput,
  TaskChildMutationEffectProjection,
} from "@flarex/persistence-postgres/internal/task-external-effect-authority";
import {
  decodeApplicationTaskRunCreationAuthorityV1,
  decodeApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import type {
  ApplicationTaskMutationCallbackAuthority,
} from "flarex-backend/internal/task-compute-delivery";
import {
  decodeTaskRuntimeLaunchRequest,
  type ApplicationTaskRuntimeLaunchSubject,
} from "flarex-backend/internal/task-runtime-launch";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import type { Json } from "flarex-protocol/json";
import {
  applicationTaskMutationRequestKeyV1FromDigest,
  encodeApplicationTaskMutationStableKeyPreimageV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));

import {
  ApplicationTaskMutationLaunchError,
  ApplicationMutationOutcomeUnavailableError,
  type ApplicationMutationSystemApi,
} from "../src/ApplicationMutationSystem";
import {
  ApplicationTaskMutationExternalEffectError,
  makeApplicationTaskMutationAuthority,
  type ApplicationTaskMutationExternalEffectAuthority,
  type ApplicationTaskMutationExternalEffectSession,
} from "../src/ApplicationTaskMutationAuthority";

describe("Application Task mutation authority", () => {
  it("binds one launch and publishes or exactly replays one mutation", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const mutationCalls: unknown[][] = [];
    const mutation = mutationPort((...args) => {
      mutationCalls.push(args);
      return Effect.succeed(committed({ updated: true }));
    });
    const authority = makeApplicationTaskMutationAuthority({
      externalEffect: effects,
      mutation,
      sha256: SHA256,
      maximumCloseMilliseconds: 1_000,
    });
    const session = await Effect.runPromise(authority.bindLaunch(launch));

    launch.creationAuthority.activeHeadSha256[0] ^= 0xff;
    launch.runtimeTarget.taskCatalogSha256[0] ^= 0xff;
    launch.executionIdentity.user.subject = "attacker";

    await expect(Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ))).resolves.toEqual({ updated: true });
    await expect(Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ))).resolves.toEqual({ updated: true });

    expect(effects.states.get(1n)?.state).toBe("confirmed");
    expect(effects.declarations).toBe(1);
    expect(effects.confirmations).toBe(2);
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[0]?.[0]).toBe("recipes:update");
    expect(mutationCalls[0]?.[2]).toMatch(/^task-mutation:v1:[0-9a-f]{64}$/);
    expect(mutationCalls[0]?.[4]).toMatchObject({
      creationAuthority: { activationSequence: 7n },
      executionIdentity: {
        user: { subject: "user-1", tokenIdentifier: "task-user-1" },
      },
    });
  });

  it("does not let the external-effect adapter retarget replay identity", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const mutation = mutationPort(() =>
      Effect.succeed(committed({ updated: true }))
    );
    const first = await bind(launch, effects, mutation);
    await Effect.runPromise(first.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ));

    const mutatingBind:
      ApplicationTaskMutationExternalEffectAuthority["bind"] = request => {
        request.applicationTaskRuntimeTargetSha256.fill(0xee);
        return effects.bind();
      };
    const mutatingAdapter: ApplicationTaskMutationExternalEffectAuthority =
      Object.freeze({ bind: mutatingBind });
    const replay = await bind(launch, mutatingAdapter, mutation);

    await expect(Effect.runPromise(replay.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ))).resolves.toEqual({ updated: true });
    expect(launch.request.applicationTaskRuntimeTargetSha256).toEqual(
      digest(0x43),
    );
  });

  it("records failed-before-dispatch when interruption is pending at prepare settlement", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const prepareEntered = Deferred.makeUnsafe<void>();
    const releasePrepare = Deferred.makeUnsafe<void>();
    const gated = wrapExternalSession(effects, session => Object.freeze({
      ...session,
      prepare: (input: TaskChildMutationEffectInput) =>
        Deferred.succeed(prepareEntered, undefined).pipe(
        Effect.andThen(Deferred.await(releasePrepare)),
        Effect.andThen(session.prepare(input)),
      ),
    }));
    const session = await bind(
      launch,
      gated,
      mutationPort(() => Effect.die("mutation must remain unreachable")),
    );

    const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const operation = yield* session.runMutation(
        1n,
        "recipes:update",
        { servings: 4 },
      ).pipe(Effect.forkChild);
      yield* Deferred.await(prepareEntered);
      const interruption = yield* Fiber.interrupt(operation).pipe(
        Effect.forkChild,
      );
      yield* Deferred.succeed(releasePrepare, undefined);
      yield* Fiber.join(interruption);
      return yield* Fiber.await(operation);
    })));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(effects.states.get(1n)?.state).toBe("failed_before_dispatch");
  });

  it("reconciles a definite declaration failure before invoking the mutation", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const declarationFailure = wrapExternalSession(effects, session =>
      Object.freeze({
        ...session,
        declareDispatch: () => Effect.fail(
          new ApplicationTaskMutationExternalEffectError({
            operation: "declareDispatch",
            reason: "integrationFailure",
          }),
        ),
      })
    );
    const invoke = vi.fn(() => Effect.succeed(committed({ unreachable: true })));
    const session = await bind(
      launch,
      declarationFailure,
      mutationPort(invoke),
    );

    await expect(Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ))).rejects.toMatchObject({ reason: "outcomeUncertain" });
    expect(invoke).not.toHaveBeenCalled();
    expect(effects.states.get(1n)).toMatchObject({
      state: "failed_before_dispatch",
      terminalCode: "task_mutation_failed_before_dispatch",
    });
  });

  it("waits for post-dispatch reconciliation before revoking the subject", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const mutationEntered = Deferred.makeUnsafe<void>();
    const session = await bind(
      launch,
      effects,
      mutationPort(() => Deferred.succeed(mutationEntered, undefined).pipe(
        Effect.andThen(Effect.never),
      )),
    );

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const operation = yield* session.runMutation(
        1n,
        "recipes:update",
        { servings: 4 },
      ).pipe(Effect.forkChild);
      yield* Deferred.await(mutationEntered);
      const closing = yield* session.close.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const closesBeforeInterruption = effects.closes;
      yield* Fiber.interrupt(operation);
      const operationExit = yield* Fiber.await(operation);
      const closeExit = yield* Fiber.await(closing);
      return { closesBeforeInterruption, operationExit, closeExit };
    })));

    expect(result.closesBeforeInterruption).toBe(0);
    expect(Exit.isFailure(result.operationExit)).toBe(true);
    expect(Exit.isSuccess(result.closeExit)).toBe(true);
    expect(effects.states.get(1n)?.state).toBe("uncertain");
    expect(effects.closes).toBe(1);
  });

  it("recovers an exact outcome when the confirmation response is lost", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const failingConfirm = wrapExternalSession(effects, session =>
      Object.freeze({
        ...session,
        confirm: () => Effect.fail(new ApplicationTaskMutationExternalEffectError({
          operation: "confirm",
          reason: "integrationFailure",
        })),
      })
    );
    const session = await bind(
      launch,
      failingConfirm,
      mutationPort(() => Effect.succeed(committed({ updated: true }))),
    );

    const result = await Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ));

    expect(result).toEqual({ updated: true });
    expect(effects.states.get(1n)?.state).toBe("confirmed");
  });

  it("classifies invalid successful hash output as a mutation failure", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const authority = makeApplicationTaskMutationAuthority({
      externalEffect: effects,
      mutation: mutationPort(() => Effect.die("mutation must remain unreachable")),
      sha256: Object.freeze({ hash: () => Effect.succeed(new Uint8Array(31)) }),
      maximumCloseMilliseconds: 1_000,
    });
    const session = await Effect.runPromise(authority.bindLaunch(launch));

    await expect(Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ))).rejects.toMatchObject({ reason: "mutationFailed" });
    expect(effects.states.size).toBe(0);
  });

  it("rejects contradictory reuse before another mutation invocation", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const invoke = vi.fn(() => Effect.succeed(committed({ ok: true })));
    const session = await bind(launch, effects, mutationPort(invoke));

    await Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ));
    const failure = await Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      { servings: 5 },
    ).pipe(Effect.flip));

    expect(failure.reason).toBe("replayConflict");
    expect(invoke).toHaveBeenCalledOnce();
    expect(effects.confirmations).toBe(1);
  });

  it("preserves stale-launch and uncertain post-dispatch outcomes", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const staleSession = await bind(
      launch,
      effects,
      mutationPort(() => Effect.fail(
        new ApplicationTaskMutationLaunchError({
          reason: "staleLaunch",
        }),
      )),
    );

    const stale = await Effect.runPromise(staleSession.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ).pipe(Effect.flip));
    expect(stale.reason).toBe("outcomeUncertain");
    expect(effects.states.get(1n)?.state).toBe("uncertain");

    const retryLaunch = launchSubject(2n);
    const retryEffects = new ExternalEffectProbe(
      retryLaunch.request.identity.scopeId,
      retryLaunch.request.identity.runId,
    );
    const uncertainSession = await bind(
      retryLaunch,
      retryEffects,
      mutationPort(() => Effect.fail(
        new ApplicationMutationOutcomeUnavailableError({
          reason: "inProgress",
        }),
      )),
    );
    const uncertain = await Effect.runPromise(uncertainSession.runMutation(
      1n,
      "recipes:update",
      { servings: 4 },
    ).pipe(Effect.flip));
    expect(uncertain.reason).toBe("outcomeUncertain");
    expect(retryEffects.states.get(1n)?.state).toBe("uncertain");
  });

  it("rejects mismatched launch evidence and revokes a closed session", async () => {
    const launch = launchSubject();
    const effects = new ExternalEffectProbe(
      launch.request.identity.scopeId,
      launch.request.identity.runId,
    );
    const authority = makeApplicationTaskMutationAuthority({
      externalEffect: effects,
      mutation: mutationPort(() => Effect.succeed(committed(null))),
      sha256: SHA256,
      maximumCloseMilliseconds: 1_000,
    });
    const mismatchedRequest = applicationRequest({
      ...launch.request,
      applicationTaskRuntimeTargetSha256: digest(0xee),
    });
    const mismatched = {
      ...launch,
      request: mismatchedRequest,
    };
    await expect(Effect.runPromise(authority.bindLaunch(mismatched)))
      .rejects.toMatchObject({
        _tag: "ApplicationTaskMutationCallbackBindError",
        reason: "invalidComposition",
      });
    expect(effects.binds).toBe(0);

    const session = await Effect.runPromise(authority.bindLaunch(launch));
    await Effect.runPromise(session.close);
    await Effect.runPromise(session.close);
    expect(effects.closes).toBe(1);
    await expect(Effect.runPromise(session.runMutation(
      1n,
      "recipes:update",
      null,
    ))).rejects.toMatchObject({ reason: "staleLaunch" });
  });

  it.each([1_500, 0, -1, Number.NaN])(
    "rejects invalid persistence settlement budget %s",
    async settlementBudgetMilliseconds => {
      const launch = launchSubject();
      const effects = new ExternalEffectProbe(
        launch.request.identity.scopeId,
        launch.request.identity.runId,
        settlementBudgetMilliseconds,
      );
      const authority = makeApplicationTaskMutationAuthority({
        externalEffect: effects,
        mutation: mutationPort(() => Effect.succeed(committed(null))),
        sha256: SHA256,
        maximumCloseMilliseconds: 1_000,
      });

      await expect(Effect.runPromise(authority.bindLaunch(launch)))
        .rejects.toMatchObject({
          _tag: "ApplicationTaskMutationCallbackBindError",
          reason: "invalidComposition",
        });
      expect(effects.closes).toBe(1);
    },
  );
});

class ExternalEffectProbe implements ApplicationTaskMutationExternalEffectAuthority {
  readonly states = new Map<bigint, TaskChildMutationEffectProjection>();
  binds = 0;
  closes = 0;
  declarations = 0;
  confirmations = 0;

  constructor(
    private readonly scopeId: TaskChildMutationEffectProjection["scopeId"],
    private readonly runId: string,
    private readonly settlementBudgetMilliseconds = 500,
  ) {}

  bind = () => Effect.sync(() => {
    this.binds += 1;
    const owner = this;
    const session: ApplicationTaskMutationExternalEffectSession = Object.freeze({
      settlementBudgetMilliseconds: owner.settlementBudgetMilliseconds,
      prepare: Effect.fn("ExternalEffectProbe.prepare")(function* (input) {
        const stableRequestKey = yield* stableKey(
          owner.scopeId,
          owner.runId,
          input.effectOrdinal,
        );
        const current = owner.states.get(input.effectOrdinal);
        if (current !== undefined) {
          if (
            current.stableRequestKey !== stableRequestKey ||
            current.functionPath !== input.functionPath ||
            !bytesEqual(current.argumentsSha256, input.argumentsSha256) ||
            !bytesEqual(
              current.requestIdentitySha256,
              input.requestIdentitySha256,
            )
          ) return yield* externalFailure("prepare", "replayConflict");
          return current;
        }
        const projection = projectionFromInput(
          owner.scopeId,
          stableRequestKey,
          input,
          "prepared",
        );
        owner.states.set(input.effectOrdinal, projection);
        return projection;
      }),
      declareDispatch: Effect.fn("ExternalEffectProbe.declare")(ordinal =>
        Effect.sync(() => {
          owner.declarations += 1;
          return owner.transition(ordinal, "dispatching");
        })
      ),
      confirm: Effect.fn("ExternalEffectProbe.confirm")((ordinal, digestValue) =>
        Effect.sync(() => {
          owner.confirmations += 1;
          const current = owner.require(ordinal);
          if (
            current.state === "confirmed" &&
            current.outcomeSha256 !== null &&
            !bytesEqual(current.outcomeSha256, digestValue)
          ) throw new Error("contradictory outcome");
          const confirmed = Object.freeze({
            ...current,
            state: "confirmed" as const,
            settledAt: new Date(),
            outcomeSha256: new Uint8Array(digestValue),
          });
          owner.states.set(ordinal, confirmed);
          return confirmed;
        })
      ),
      reconcile: Effect.fn("ExternalEffectProbe.reconcile")(function* (input) {
        const current = owner.states.get(input.effectOrdinal);
        if (current === undefined) {
          return Object.freeze({ kind: "missing" as const });
        }
        yield* owner.requireExactReconciliation(current, input);
        switch (current.state) {
          case "prepared":
            if (input.outcomeSha256 !== null) {
              return yield* externalFailure("reconcile", "replayConflict");
            }
            return owner.terminalReceipt(
              owner.transition(input.effectOrdinal, "failed_before_dispatch"),
              "applied",
            );
          case "dispatching":
            if (input.outcomeSha256 === null) {
              return owner.terminalReceipt(
                owner.transition(input.effectOrdinal, "uncertain"),
                "applied",
              );
            }
            owner.confirmations += 1;
            return owner.terminalReceipt(
              owner.confirmProjection(input.effectOrdinal, input.outcomeSha256),
              "applied",
            );
          case "confirmed":
            if (
              input.outcomeSha256 === null ||
              current.outcomeSha256 === null ||
              !bytesEqual(current.outcomeSha256, input.outcomeSha256)
            ) return yield* externalFailure("reconcile", "replayConflict");
            return owner.terminalReceipt(current, "replayed");
          case "failed_before_dispatch":
          case "uncertain":
            if (input.outcomeSha256 !== null) {
              return yield* externalFailure("reconcile", "replayConflict");
            }
            return owner.terminalReceipt(current, "replayed");
        }
      }),
      close: Effect.sync(() => {
        owner.closes += 1;
      }),
    });
    return session;
  });

  private require(ordinal: bigint): TaskChildMutationEffectProjection {
    const current = this.states.get(ordinal);
    if (current === undefined) throw new Error("missing effect");
    return current;
  }

  private transition(
    ordinal: bigint,
    state: TaskChildMutationEffectProjection["state"],
  ): TaskChildMutationEffectProjection {
    const current = this.require(ordinal);
    const next = Object.freeze({
      ...current,
      state,
      dispatchDeclaredAt: state === "dispatching" || state === "uncertain"
        ? new Date()
        : current.dispatchDeclaredAt,
      settledAt: state === "failed_before_dispatch" || state === "uncertain"
        ? new Date()
        : current.settledAt,
      terminalCode: state === "failed_before_dispatch" || state === "uncertain"
        ? state === "failed_before_dispatch"
          ? "task_mutation_failed_before_dispatch"
          : "task_mutation_dispatch_outcome_uncertain"
        : current.terminalCode,
    });
    this.states.set(ordinal, next);
    return next;
  }

  private confirmProjection(
    ordinal: bigint,
    outcomeSha256: Uint8Array,
  ): TaskChildMutationEffectProjection {
    const current = this.require(ordinal);
    const confirmed = Object.freeze({
      ...current,
      state: "confirmed" as const,
      settledAt: new Date(),
      outcomeSha256: new Uint8Array(outcomeSha256),
    });
    this.states.set(ordinal, confirmed);
    return confirmed;
  }

  private requireExactReconciliation(
    current: TaskChildMutationEffectProjection,
    input: ReconcileTaskChildMutationDispositionInput,
  ): Effect.Effect<void, ApplicationTaskMutationExternalEffectError> {
    return current.stableRequestKey === input.stableRequestKey &&
        current.functionPath === input.functionPath &&
        bytesEqual(current.argumentsSha256, input.argumentsSha256) &&
        bytesEqual(
          current.requestIdentitySha256,
          input.requestIdentitySha256,
        )
      ? Effect.void
      : externalFailure("reconcile", "replayConflict");
  }

  private terminalReceipt(
    effect: TaskChildMutationEffectProjection,
    disposition: "applied" | "replayed",
  ) {
    if (
      effect.state !== "failed_before_dispatch" &&
      effect.state !== "confirmed" &&
      effect.state !== "uncertain"
    ) throw new Error("expected terminal external-effect projection");
    return Object.freeze({
      kind: "terminal" as const,
      disposition,
      effect: Object.freeze({ ...effect, state: effect.state }),
    });
  }
}

function projectionFromInput(
  scopeId: TaskChildMutationEffectProjection["scopeId"],
  stableRequestKey: TaskChildMutationEffectProjection["stableRequestKey"],
  input: TaskChildMutationEffectInput,
  state: TaskChildMutationEffectProjection["state"],
): TaskChildMutationEffectProjection {
  return Object.freeze({
    scopeId,
    subjectIdentitySha256: digest(0x51),
    subjectFence: 1n,
    effectOrdinal: input.effectOrdinal,
    stableRequestKey,
    requestIdentitySha256: new Uint8Array(input.requestIdentitySha256),
    functionPath: input.functionPath,
    argumentsSha256: new Uint8Array(input.argumentsSha256),
    state,
    preparedAt: new Date(),
    dispatchDeclaredAt: null,
    settledAt: null,
    outcomeSha256: null,
    terminalCode: null,
  });
}

function mutationPort(
  invoke: ApplicationMutationSystemApi["invokeAuthenticatedAtTaskLaunch"],
): Pick<ApplicationMutationSystemApi, "invokeAuthenticatedAtTaskLaunch"> {
  const owner: Pick<
    ApplicationMutationSystemApi,
    "invokeAuthenticatedAtTaskLaunch"
  > = {
    invokeAuthenticatedAtTaskLaunch(
      functionRef,
      args,
      requestKey,
      identity,
      launch,
    ) {
      expect(this).toBe(owner);
      return invoke(functionRef, args, requestKey, identity, launch);
    },
  };
  return Object.freeze(owner);
}

async function bind(
  launch: ReturnType<typeof launchSubject>,
  externalEffect: ApplicationTaskMutationExternalEffectAuthority,
  mutation: Pick<ApplicationMutationSystemApi, "invokeAuthenticatedAtTaskLaunch">,
) {
  const authority = makeApplicationTaskMutationAuthority({
    externalEffect,
    mutation,
    sha256: SHA256,
    maximumCloseMilliseconds: 1_000,
  });
  return Effect.runPromise(authority.bindLaunch(launch));
}

function wrapExternalSession(
  owner: ApplicationTaskMutationExternalEffectAuthority,
  wrap: (
    session: ApplicationTaskMutationExternalEffectSession,
  ) => ApplicationTaskMutationExternalEffectSession,
): ApplicationTaskMutationExternalEffectAuthority {
  const bindOwner = owner.bind;
  const adapter: ApplicationTaskMutationExternalEffectAuthority = {
    bind(request) {
      return bindOwner.call(owner, request).pipe(Effect.map(wrap));
    },
  };
  return Object.freeze(adapter);
}

function committed(value: Json) {
  return Object.freeze({
    status: "committed" as const,
    disposition: "published" as const,
    scopeUuid: "00000000-0000-4000-8000-000000000001",
    epochUuid: "00000000-0000-4000-8000-000000000002",
    commitSeq: 1n,
    value,
  });
}

function launchSubject(attempt = 1n) {
  const scopeId = "scope_00000000-0000-4000-8000-000000000001";
  const runtimeTargetSha256 = digest(0x43);
  const target = Result.getOrThrow(decodeApplicationTaskRuntimeTargetV1({
    version: 1,
    scopeId,
    revisionId: "revision-task-mutation",
    candidateId: "candidate-task-mutation",
    analysisId: "analysis-task-mutation",
    sourceArtifactRootSha256: "11".repeat(32),
    publicationSha256: "22".repeat(32),
    applicationTaskCatalogBindingSha256: digest(0x31),
    applicationTaskDefinitionBindingSha256: digest(0x32),
    taskCatalogSha256: digest(0x33),
    taskId: "recipes.task",
    canonicalTaskManifestSha256: digest(0x34),
    handler: {
      logicalModulePath: "tasks/recipes",
      sourceModulePath: "tasks/recipes.js",
      exportName: "run",
    },
    runtimeHostIdentity: "flarex.application-task-runtime",
    compatibilityDate: "2026-06-14",
  }));
  const creationAuthority = Result.getOrThrow(
    decodeApplicationTaskRunCreationAuthorityV1({
      version: 1,
      scopeId,
      activationSequence: 7n,
      activeHeadSha256: digest(0x41),
      readinessSha256: digest(0x42),
      runtimeTarget: target,
      applicationTaskRuntimeTargetSha256: runtimeTargetSha256,
    }),
  );
  const request = applicationRequest({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId,
      runId: "run_00000000-0000-4000-8000-000000000001",
      requestedEffectSequence: 1n,
      attemptId:
        `attempt_00000000-0000-4000-8000-${attempt.toString().padStart(12, "0")}`,
      executionFence: attempt,
    },
    applicationTaskRuntimeTargetSha256: runtimeTargetSha256,
    attemptNumber: Number(attempt),
    leaseVersion: attempt,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: 30_000,
  });
  return {
    request,
    creationAuthority,
    runtimeTarget: target,
    executionIdentity: {
      kind: "user" as const,
      user: {
        tokenIdentifier: "task-user-1",
        issuer: "https://issuer.example",
        subject: "user-1",
        tenant: { role: "member" },
      },
    },
  };
}

function applicationRequest(
  input: unknown,
): ApplicationTaskRuntimeLaunchSubject["request"] {
  const request = Result.getOrThrow(decodeTaskRuntimeLaunchRequest(input));
  if (request.taskDefinitionRevisionId !== undefined) {
    throw new Error("Expected an Application Task dispatch request fixture.");
  }
  return request;
}

function stableKey(scopeId: string, runId: string, ordinal: bigint) {
  return Effect.gen(function* () {
    const preimage = Result.getOrThrow(
      encodeApplicationTaskMutationStableKeyPreimageV1({
        scopeId,
        runId,
        operationOrdinal: ordinal,
      }),
    );
    const sha256 = yield* SHA256.hash(preimage.canonicalBytes);
    return Result.getOrThrow(
      applicationTaskMutationRequestKeyV1FromDigest(sha256),
    );
  });
}

const SHA256 = Object.freeze({
  hash: (bytes: Uint8Array) => Effect.promise(async () => new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  )),
});

function externalFailure(
  operation: ApplicationTaskMutationExternalEffectError["operation"],
  reason: ApplicationTaskMutationExternalEffectError["reason"],
) {
  return Effect.fail(new ApplicationTaskMutationExternalEffectError({
    operation,
    reason,
  }));
}

function digest(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}
