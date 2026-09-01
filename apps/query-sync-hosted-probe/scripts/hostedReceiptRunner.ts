import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Duration, Effect, Ref, Result, Schedule, Scope } from "effect";

import {
  FX02B_IDENTITY_PATH,
  FX02B_INITIAL_PATH,
  FX02B_RESUME_PATH,
} from "../src/fixture";
import {
  decodeFx02bHostedIdentityReceipt,
  decodeFx02bInitialHostedReceipt,
  decodeFx02bResumeHostedReceipt,
  type Fx02bHostedIdentityReceipt,
  type Fx02bInitialHostedReceipt,
  type Fx02bResumeHostedReceipt,
} from "../src/hostedReceiptProtocol";

export const FX02B_SOURCE_WORKER = "flarex-query-sync-fx02b-source-probe";
export const FX02B_HOST_WORKER = "flarex-query-sync-fx02b-host-probe";

const SOURCE_CONFIG = "wrangler.source.jsonc";
const HOST_CONFIG = "wrangler.host.jsonc";
const HOST_TEARDOWN_CONFIG = "wrangler.host.teardown.jsonc";
const RUN_ID_PATTERN = /^[a-f0-9]{24}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAXIMUM_RECEIPT_BODY_BYTES = 64 * 1_024;

export interface WranglerCommandResult {
  readonly code: number;
  readonly output: string;
}

export interface HostedReceiptCommandExecutor {
  readonly run: (
    args: readonly string[],
    input?: string,
  ) => Effect.Effect<WranglerCommandResult, HostedReceiptRunnerError>;
}

export interface HostedReceiptFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface HostedReceiptRunnerDependencies {
  readonly commands: HostedReceiptCommandExecutor;
  readonly fetch: HostedReceiptFetch;
  readonly stage: (stage: string) => void;
}

export interface HostedReceiptRunIdentity {
  readonly runId: string;
  readonly initialMarker: string;
  readonly restartMarker: string;
  readonly gatewayToken: string;
  readonly probeToken: string;
  readonly executorToken: string;
}

export interface HostedReceiptRunnerOptions {
  readonly maximumRestartProbes: number;
  readonly restartProbeDelayMilliseconds: number;
  readonly requestTimeoutMilliseconds: number;
  readonly overallTimeoutMilliseconds: number;
}

export interface Fx02bHostedRestartReceipt {
  readonly kind: "fx02b-hosted-restart-receipt";
  readonly runId: string;
  readonly sourceWorker: typeof FX02B_SOURCE_WORKER;
  readonly hostWorker: typeof FX02B_HOST_WORKER;
  readonly unauthenticatedStatus: 401;
  readonly initial: Fx02bInitialHostedReceipt;
  readonly restart: Fx02bResumeHostedReceipt;
  readonly restartAttempts: number;
  readonly bootChanged: true;
  readonly workerVersionChanged: true;
  readonly persistedCursorAdvancedFrom: "1";
  readonly persistedCursorAdvancedTo: "2";
  readonly teardown: Readonly<{
    readonly hostNamespaceDeleted: true;
    readonly hostWorkerAbsent: true;
    readonly sourceWorkerAbsent: true;
  }>;
}

type HostedReceiptRunnerFailureReason =
  | "authenticationFailed"
  | "cleanupFailed"
  | "commandFailed"
  | "filesystemFailed"
  | "hostedRequestFailed"
  | "invalidConfiguration"
  | "invalidReceipt"
  | "operationAndCleanupFailed"
  | "overallTimeout"
  | "ownershipUnknown"
  | "resourceAlreadyExists"
  | "restartNotObserved";

export class HostedReceiptRunnerError extends Data.TaggedError(
  "HostedReceiptRunnerError",
)<{
  readonly operation: string;
  readonly reason: HostedReceiptRunnerFailureReason;
  readonly message: string;
  readonly cause?: unknown;
}> {}

class TransientHostedProbeError extends Data.TaggedError(
  "TransientHostedProbeError",
)<{
  readonly classification: "deploymentVisibility" | "http" | "transport";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type WorkerOwnership = "absent" | "attempted" | "owned";

interface WorkerLease {
  readonly worker: string;
  readonly config: string;
  readonly messagePrefix: string;
  readonly ownership: Ref.Ref<WorkerOwnership>;
  readonly cleanup: "host" | "source";
}

interface TeardownEvidence {
  readonly hostLifecycleRegistered: boolean;
  readonly hostNamespaceDeleted: boolean;
  readonly hostWorkerAbsent: boolean;
  readonly sourceWorkerAbsent: boolean;
}

interface CampaignReceipt {
  readonly unauthenticatedStatus: 401;
  readonly initial: Fx02bInitialHostedReceipt;
  readonly restart: Fx02bResumeHostedReceipt;
  readonly restartAttempts: number;
}

export const runHostedReceipt = Effect.fn("Fx02bHostedReceipt.run")(
  function* (
    dependencies: HostedReceiptRunnerDependencies,
    identity: HostedReceiptRunIdentity,
    options: HostedReceiptRunnerOptions,
  ): Effect.fn.Return<Fx02bHostedRestartReceipt, HostedReceiptRunnerError> {
    yield* validateOptions(options);
    yield* validateIdentity(identity);
    const cleanupFailures = yield* Ref.make<readonly HostedReceiptRunnerError[]>([]);
    const teardownEvidence = yield* Ref.make<TeardownEvidence>({
      hostLifecycleRegistered: false,
      hostNamespaceDeleted: false,
      hostWorkerAbsent: false,
      sourceWorkerAbsent: false,
    });
    const campaign = Effect.scoped(runCampaign(
      dependencies,
      identity,
      options,
      cleanupFailures,
      teardownEvidence,
    ));
    const campaignResult = yield* Effect.result(campaign.pipe(
      Effect.timeoutOrElse({
        duration: `${options.overallTimeoutMilliseconds} millis`,
        orElse: () => Effect.fail(new HostedReceiptRunnerError({
          operation: "runHostedReceipt",
          reason: "overallTimeout",
          message: "FX02-B hosted receipt exceeded its overall deadline.",
        })),
      }),
    ));
    const finalizerFailures = yield* Ref.get(cleanupFailures);
    if (finalizerFailures.length > 0) {
      return yield* Result.match(campaignResult, {
        onFailure: operation => Effect.fail(new HostedReceiptRunnerError({
          operation: "runHostedReceipt",
          reason: "operationAndCleanupFailed",
          message: `FX02-B hosted receipt failed and cleanup reported ${finalizerFailures.length} failure(s).`,
          cause: Object.freeze({ operation, cleanup: finalizerFailures }),
        })),
        onSuccess: () => Effect.fail(new HostedReceiptRunnerError({
          operation: "runHostedReceipt",
          reason: "cleanupFailed",
          message: `FX02-B hosted cleanup reported ${finalizerFailures.length} failure(s).`,
          cause: finalizerFailures,
        })),
      });
    }
    const campaignReceipt = yield* Effect.fromResult(campaignResult);
    const teardown = yield* Ref.get(teardownEvidence);
    if (!teardown.hostNamespaceDeleted || !teardown.hostWorkerAbsent || !teardown.sourceWorkerAbsent) {
      return yield* Effect.fail(new HostedReceiptRunnerError({
        operation: "runHostedReceipt",
        reason: "cleanupFailed",
        message: "FX02-B teardown evidence is incomplete.",
      }));
    }
    return Object.freeze({
      kind: "fx02b-hosted-restart-receipt",
      runId: identity.runId,
      sourceWorker: FX02B_SOURCE_WORKER,
      hostWorker: FX02B_HOST_WORKER,
      ...campaignReceipt,
      bootChanged: true,
      workerVersionChanged: true,
      persistedCursorAdvancedFrom: "1",
      persistedCursorAdvancedTo: "2",
      teardown: Object.freeze({
        hostNamespaceDeleted: true,
        hostWorkerAbsent: true,
        sourceWorkerAbsent: true,
      }),
    });
  },
);

const runCampaign = Effect.fn("Fx02bHostedReceipt.campaign")(function* (
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  options: HostedReceiptRunnerOptions,
  cleanupFailures: Ref.Ref<readonly HostedReceiptRunnerError[]>,
  teardownEvidence: Ref.Ref<TeardownEvidence>,
): Effect.fn.Return<CampaignReceipt, HostedReceiptRunnerError, Scope.Scope> {
    const temporaryDirectory = yield* acquireTemporaryDirectory(cleanupFailures);
    const sourceSecretsPath = join(temporaryDirectory, "source-secrets.json");
    const hostSecretsPath = join(temporaryDirectory, "host-secrets.json");
    yield* writeSecretFile(sourceSecretsPath, { FLAREX_EXECUTOR_TOKEN: identity.executorToken });
    yield* writeSecretFile(hostSecretsPath, {
      FLAREX_EXECUTOR_TOKEN: identity.executorToken,
      FLAREX_FX02B_GATEWAY_TOKEN: identity.gatewayToken,
      FLAREX_QUERY_SYNC_PROBE_TOKEN: identity.probeToken,
    });
    yield* requireAuthenticatedSingleAccount(dependencies);
    yield* requireWorkerAbsent(dependencies, FX02B_SOURCE_WORKER, SOURCE_CONFIG);
    yield* requireWorkerAbsent(dependencies, FX02B_HOST_WORKER, HOST_CONFIG);

    const sourceLease = yield* acquireWorkerLease(
      dependencies,
      identity,
      cleanupFailures,
      teardownEvidence,
      {
        worker: FX02B_SOURCE_WORKER,
        config: SOURCE_CONFIG,
        messagePrefix: "FX02-B isolated source",
        cleanup: "source",
      },
    );
    dependencies.stage("deploy-source");
    yield* deployOwnedWorker(dependencies, identity, sourceLease, [
      "deploy", "--config", SOURCE_CONFIG, "--secrets-file", sourceSecretsPath,
      "--message", `${sourceLease.messagePrefix} ${identity.runId}`,
    ]);

    const hostLease = yield* acquireWorkerLease(
      dependencies,
      identity,
      cleanupFailures,
      teardownEvidence,
      {
        worker: FX02B_HOST_WORKER,
        config: HOST_CONFIG,
        messagePrefix: "FX02-B isolated host",
        cleanup: "host",
      },
    );
    yield* Ref.update(teardownEvidence, evidence => ({
      ...evidence,
      hostLifecycleRegistered: true,
    }));
    dependencies.stage("deploy-host-initial");
    const initialDeployment = yield* deployOwnedWorker(dependencies, identity, hostLease, [
      "deploy", "--config", HOST_CONFIG, "--secrets-file", hostSecretsPath,
      "--define", `FX02B_RELEASE_MARKER:${JSON.stringify(identity.initialMarker)}`,
      "--message", `${hostLease.messagePrefix} initial ${identity.runId}`,
    ]);
    const hostUrl = yield* readDeploymentUrl(initialDeployment.output);

    dependencies.stage("verify-fail-closed");
    yield* Effect.retry(
      observeFailClosedGateway(dependencies, options, hostUrl),
      {
        schedule: boundedVisibilitySchedule(options),
        while: error =>
          error._tag === "TransientHostedProbeError"
          && error.classification === "deploymentVisibility",
      },
    ).pipe(Effect.mapError(error => error._tag === "HostedReceiptRunnerError"
      ? error
      : transientToTerminal("verifyFailClosed")(error)));

    dependencies.stage("initialize-cursor");
    const initialValue = yield* invokeProbe(
      dependencies,
      options,
      hostUrl,
      FX02B_INITIAL_PATH,
      identity.gatewayToken,
    ).pipe(Effect.mapError(initialProbeErrorToTerminal));
    const initialReceipt = yield* decodeInitialReceipt(initialValue, identity.initialMarker);

    dependencies.stage("deploy-host-restart");
    yield* deployOwnedWorker(dependencies, identity, hostLease, [
      "deploy", "--config", HOST_CONFIG, "--secrets-file", hostSecretsPath,
      "--define", `FX02B_RELEASE_MARKER:${JSON.stringify(identity.restartMarker)}`,
      "--message", `${hostLease.messagePrefix} restart ${identity.runId}`,
    ]);

    dependencies.stage("observe-new-boot");
    let restartAttempts = 0;
    const observeRestart = Effect.suspend(() => {
      restartAttempts += 1;
      return observeRestartIdentity(
        dependencies,
        options,
        identity,
        hostUrl,
        initialReceipt,
      );
    });
    const restartIdentity = yield* Effect.retry(observeRestart, {
      schedule: boundedVisibilitySchedule(options),
      while: error => error._tag === "TransientHostedProbeError",
    }).pipe(Effect.mapError(error => error._tag === "HostedReceiptRunnerError"
      ? error
      : new HostedReceiptRunnerError({
        operation: "observeNewBoot",
        reason: "restartNotObserved",
        message: `No new boot and Worker version were observed after ${restartAttempts} bounded probes; last transient classification: ${error.classification}.`,
        cause: error,
      })));
    dependencies.stage("resume-new-boot");
    const restartValue = yield* invokeProbe(
      dependencies,
      options,
      hostUrl,
      FX02B_RESUME_PATH,
      identity.gatewayToken,
    ).pipe(Effect.mapError(initialProbeErrorToTerminal));
    const restartReceipt = yield* decodeRestartReceipt(
      restartValue,
      identity.restartMarker,
      restartIdentity,
    );
    return Object.freeze({
      unauthenticatedStatus: 401,
      initial: initialReceipt,
      restart: restartReceipt,
      restartAttempts,
    });
});

function acquireTemporaryDirectory(
  cleanupFailures: Ref.Ref<readonly HostedReceiptRunnerError[]>,
): Effect.Effect<string, HostedReceiptRunnerError, Scope.Scope> {
  return Effect.acquireRelease(
    fromPromise("createTemporaryDirectory", "filesystemFailed", () =>
      mkdtemp(join(tmpdir(), "flarex-fx02b-hosted-"))
    ),
    path => fromPromise("removeTemporaryDirectory", "filesystemFailed", () =>
      rm(path, { recursive: true, force: true })
    ).pipe(recordCleanupFailure(cleanupFailures)),
  );
}

function acquireWorkerLease(
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  cleanupFailures: Ref.Ref<readonly HostedReceiptRunnerError[]>,
  teardownEvidence: Ref.Ref<TeardownEvidence>,
  descriptor: Omit<WorkerLease, "ownership">,
): Effect.Effect<WorkerLease, never, Scope.Scope> {
  return Effect.acquireRelease(
    Ref.make<WorkerOwnership>("absent").pipe(Effect.map(ownership => ({ ...descriptor, ownership }))),
    lease => cleanupWorker(
      dependencies,
      identity,
      lease,
      teardownEvidence,
    ).pipe(recordCleanupFailure(cleanupFailures)),
  );
}

const deployOwnedWorker = Effect.fn("Fx02bHostedReceipt.deployOwnedWorker")(
  function* (
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
  args: readonly string[],
): Effect.fn.Return<WranglerCommandResult, HostedReceiptRunnerError> {
    yield* Ref.set(lease.ownership, "attempted");
    return yield* dependencies.commands.run(args).pipe(Effect.matchEffect({
      onFailure: failure => settleAmbiguousDeployment(
        dependencies,
        identity,
        lease,
        failure,
      ),
      onSuccess: result => result.code === 0
        ? Ref.set(lease.ownership, "owned").pipe(
          Effect.as(result),
        )
        : settleAmbiguousDeployment(
          dependencies,
          identity,
          lease,
          commandFailure("deployWorker", result),
        ),
    }));
  },
);

const settleAmbiguousDeployment = Effect.fn(
  "Fx02bHostedReceipt.settleAmbiguousDeployment",
)(function* (
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
  failure: HostedReceiptRunnerError,
): Effect.fn.Return<never, HostedReceiptRunnerError> {
  const reconciled = yield* reconcileOwnership(dependencies, identity, lease);
  yield* Ref.set(lease.ownership, reconciled);
  return yield* Effect.fail(failure);
});

const reconcileOwnership = Effect.fn("Fx02bHostedReceipt.reconcileOwnership")(
  function* (
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
): Effect.fn.Return<WorkerOwnership, HostedReceiptRunnerError> {
    const message = yield* readCurrentDeploymentMessage(dependencies, lease);
    if (message === null) return "absent";
    if (isOwnedDeploymentMessage(message, identity, lease)) return "owned";
    return yield* ownershipUnknown(
      lease.worker,
      "the Worker exists without this run's deployment annotation",
    );
  },
);

const cleanupWorker = Effect.fn("Fx02bHostedReceipt.cleanupWorker")(function* (
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
  teardownEvidence: Ref.Ref<TeardownEvidence>,
): Effect.fn.Return<void, HostedReceiptRunnerError> {
    let ownership = yield* Ref.get(lease.ownership);
    if (ownership === "absent") {
      yield* Ref.update(teardownEvidence, evidence => lease.cleanup === "host"
        ? { ...evidence, hostWorkerAbsent: true }
        : { ...evidence, sourceWorkerAbsent: true });
      return;
    }
    if (ownership === "attempted") {
      ownership = yield* reconcileOwnership(dependencies, identity, lease);
      yield* Ref.set(lease.ownership, ownership);
    }
    if (ownership !== "owned") return;
    yield* requireCurrentOwnership(dependencies, identity, lease);
    if (lease.cleanup === "host") {
      dependencies.stage("teardown-host-namespace");
      const teardownMessage = `FX02-B isolated host teardown ${identity.runId}`;
      yield* deployHostTeardown(
        dependencies,
        lease,
        ["deploy", "--config", HOST_TEARDOWN_CONFIG, "--message", `FX02-B isolated host teardown ${identity.runId}`],
        teardownMessage,
      );
      yield* Ref.update(teardownEvidence, evidence => ({ ...evidence, hostNamespaceDeleted: true }));
      yield* deleteOwnedWorker(
        dependencies,
        lease,
        ["delete", FX02B_HOST_WORKER, "--config", HOST_TEARDOWN_CONFIG],
        "deleteHostWorker",
        "y\n",
      );
      yield* Ref.update(teardownEvidence, evidence => ({ ...evidence, hostWorkerAbsent: true }));
    } else {
      const cleanupEvidence = yield* Ref.get(teardownEvidence);
      if (
        cleanupEvidence.hostLifecycleRegistered
        && !cleanupEvidence.hostWorkerAbsent
      ) {
        return yield* Effect.fail(new HostedReceiptRunnerError({
          operation: "deleteSourceWorker",
          reason: "cleanupFailed",
          message: "The source Worker was retained because host teardown did not prove the service binding unreferenced.",
        }));
      }
      dependencies.stage("teardown-source");
      yield* deleteOwnedWorker(
        dependencies,
        lease,
        ["delete", FX02B_SOURCE_WORKER, "--config", SOURCE_CONFIG],
        "deleteSourceWorker",
        "y\n",
      );
      yield* Ref.update(teardownEvidence, evidence => ({ ...evidence, sourceWorkerAbsent: true }));
    }
    yield* Ref.set(lease.ownership, "absent");
});

const observeRestartIdentity = Effect.fn(
  "Fx02bHostedReceipt.observeRestartIdentity",
)(function* (
  dependencies: HostedReceiptRunnerDependencies,
  options: HostedReceiptRunnerOptions,
  identity: HostedReceiptRunIdentity,
  hostUrl: string,
  initial: Fx02bInitialHostedReceipt,
): Effect.fn.Return<
  Fx02bHostedIdentityReceipt,
  HostedReceiptRunnerError | TransientHostedProbeError
> {
    const value = yield* invokeProbe(
      dependencies,
      options,
      hostUrl,
      FX02B_IDENTITY_PATH,
      identity.gatewayToken,
    );
    const candidate = yield* Effect.fromResult(
      decodeFx02bHostedIdentityReceipt(value),
    ).pipe(Effect.mapError(cause => new HostedReceiptRunnerError({
        operation: "observeNewBoot",
        reason: "invalidReceipt",
        message: "The hosted restart identity did not match the strict receipt contract.",
        cause,
      })));
    if (candidate.releaseMarker !== identity.restartMarker) {
      return yield* Effect.fail(new TransientHostedProbeError({
        classification: "deploymentVisibility",
        message: "The prior Worker release is still serving the probe.",
      }));
    }
    if (candidate.bootId === initial.bootId || candidate.workerVersionId === initial.workerVersionId) {
      return yield* Effect.fail(new TransientHostedProbeError({
        classification: "deploymentVisibility",
        message: "The new release has not exposed both a new boot and version yet.",
      }));
    }
    return candidate;
});

function decodeRestartReceipt(
  value: unknown,
  expectedMarker: string,
  identity: Fx02bHostedIdentityReceipt,
): Effect.Effect<Fx02bResumeHostedReceipt, HostedReceiptRunnerError> {
  return Effect.fromResult(decodeFx02bResumeHostedReceipt(value)).pipe(
    Effect.mapError(cause => new HostedReceiptRunnerError({
      operation: "resumeNewBoot",
      reason: "invalidReceipt",
      message: "The hosted resume response did not match the strict receipt contract.",
      cause,
    })),
    Effect.flatMap(decoded => decoded.releaseMarker !== expectedMarker
      ? invalidReceipt(
        "resumeNewBoot",
        "The hosted resume release marker was not the observed restart marker.",
      )
      : decoded.bootId !== identity.bootId
        || decoded.workerVersionId !== identity.workerVersionId
      ? invalidReceipt(
        "resumeNewBoot",
        "The hosted resume response did not come from the observed new boot and Worker version.",
      )
      : decoded.outcome.cursor !== "2"
      ? invalidReceipt(
        "resumeNewBoot",
        `Expected restart cursor 2, received ${decoded.outcome.cursor}.`,
      )
      : Effect.succeed(decoded)),
  );
}

function decodeInitialReceipt(
  value: unknown,
  expectedMarker: string,
): Effect.Effect<Fx02bInitialHostedReceipt, HostedReceiptRunnerError> {
  return Effect.fromResult(decodeFx02bInitialHostedReceipt(value)).pipe(
    Effect.mapError(cause => new HostedReceiptRunnerError({
      operation: "initializeCursor",
      reason: "invalidReceipt",
      message: "The hosted initialization response did not match the strict receipt contract.",
      cause,
    })),
    Effect.flatMap(decoded => decoded.releaseMarker !== expectedMarker
      ? invalidReceipt(
        "initializeCursor",
        "The hosted initialization release marker was not the deployed marker.",
      )
      : decoded.outcome.cursor !== "1"
      ? invalidReceipt(
        "initializeCursor",
        `Expected initialization cursor 1, received ${decoded.outcome.cursor}.`,
      )
      : Effect.succeed(decoded)),
  );
}

const invokeProbe = Effect.fn("Fx02bHostedReceipt.invokeProbe")(function* (
  dependencies: HostedReceiptRunnerDependencies,
  options: HostedReceiptRunnerOptions,
  hostUrl: string,
  path: string,
  token: string,
): Effect.fn.Return<unknown, HostedReceiptRunnerError | TransientHostedProbeError> {
    const response = yield* request(dependencies, options, `${hostUrl}${path}`, token);
    if (response.status !== 200) {
      if ([502, 503, 504].includes(response.status)) {
        return yield* Effect.fail(new TransientHostedProbeError({
          classification: "http",
          message: `Hosted probe returned transient status ${response.status}.`,
        }));
      }
      return yield* Effect.fail(new HostedReceiptRunnerError({
        operation: "invokeProbe",
        reason: "hostedRequestFailed",
        message: `Hosted probe returned terminal status ${response.status} (${terminalClassification(response)}).`,
      }));
    }
    return yield* Effect.tryPromise({
      try: signal => readBoundedJsonBody(response, signal),
      catch: cause => new HostedReceiptRunnerError({
        operation: "decodeHostedResponse",
        reason: "invalidReceipt",
        message: "Hosted probe returned invalid JSON.",
        cause,
      }),
    }).pipe(Effect.timeoutOrElse({
      duration: `${options.requestTimeoutMilliseconds} millis`,
      orElse: () => Effect.fail(new HostedReceiptRunnerError({
        operation: "decodeHostedResponse",
        reason: "hostedRequestFailed",
        message: "Hosted probe response body exceeded its deadline.",
      })),
    }));
});

function request(
  dependencies: HostedReceiptRunnerDependencies,
  options: HostedReceiptRunnerOptions,
  url: string,
  token: string | undefined,
): Effect.Effect<Response, TransientHostedProbeError> {
  return Effect.tryPromise({
    try: signal => dependencies.fetch(url, {
      method: "POST",
      signal,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
    }),
    catch: cause => new TransientHostedProbeError({
      classification: "transport",
      message: "Hosted probe transport failed.",
      cause,
    }),
  }).pipe(Effect.timeoutOrElse({
    duration: `${options.requestTimeoutMilliseconds} millis`,
    orElse: () => Effect.fail(new TransientHostedProbeError({
      classification: "transport",
      message: "Hosted probe request exceeded its deadline.",
    })),
  }));
}

const observeFailClosedGateway = Effect.fn(
  "Fx02bHostedReceipt.observeFailClosedGateway",
)(function* (
  dependencies: HostedReceiptRunnerDependencies,
  options: HostedReceiptRunnerOptions,
  hostUrl: string,
): Effect.fn.Return<void, HostedReceiptRunnerError | TransientHostedProbeError> {
  const response = yield* request(
    dependencies,
    options,
    `${hostUrl}${FX02B_INITIAL_PATH}`,
    undefined,
  );
  if (response.status === 401) return;
  if (
    response.status === 500
    && response.headers.get("x-flarex-probe-classification")
      === "configuration_unavailable"
  ) {
    return yield* Effect.fail(new TransientHostedProbeError({
      classification: "deploymentVisibility",
      message: "The deployed gateway configuration is not visible yet.",
    }));
  }
  return yield* Effect.fail(new HostedReceiptRunnerError({
    operation: "verifyFailClosed",
    reason: "hostedRequestFailed",
    message: `Expected unauthenticated status 401, received ${response.status}.`,
  }));
});

function boundedVisibilitySchedule(
  options: HostedReceiptRunnerOptions,
) {
  return Schedule.addDelay(
    Schedule.recurs(options.maximumRestartProbes - 1),
    () => Effect.succeed(Duration.millis(
      options.restartProbeDelayMilliseconds,
    )),
  );
}

function requireAuthenticatedSingleAccount(
  dependencies: HostedReceiptRunnerDependencies,
): Effect.Effect<void, HostedReceiptRunnerError> {
  dependencies.stage("authenticate");
  return Effect.gen(function* () {
    const result = yield* requireCommandSuccess(dependencies, ["whoami"], "authenticate");
    const accountIds = result.output.match(/\b[a-f0-9]{32}\b/g) ?? [];
    if (new Set(accountIds).size !== 1) {
      return yield* Effect.fail(new HostedReceiptRunnerError({
        operation: "authenticate",
        reason: "authenticationFailed",
        message: "Wrangler must resolve exactly one authenticated account.",
      }));
    }
  });
}

function terminalClassification(response: Response): string {
  const value = response.headers.get("x-flarex-probe-classification");
  return value === "durable_object_rpc_rejected"
    ? value
    : "unclassified_terminal_http";
}

function requireWorkerAbsent(
  dependencies: HostedReceiptRunnerDependencies,
  worker: string,
  config: string,
  refuseExisting = true,
): Effect.Effect<void, HostedReceiptRunnerError> {
  dependencies.stage(`check-absence:${worker}`);
  return Effect.gen(function* () {
    const result = yield* dependencies.commands.run([
      "deployments", "list", "--config", config,
    ]);
    if (result.code === 0) {
      return yield* Effect.fail(new HostedReceiptRunnerError({
        operation: "requireWorkerAbsent",
        reason: refuseExisting ? "resourceAlreadyExists" : "cleanupFailed",
        message: refuseExisting
          ? `Refusing to reuse existing Worker ${worker}.`
          : `Worker ${worker} still exists after deletion.`,
      }));
    }
    if (!reportsAbsent(result.output, worker)) {
      return yield* Effect.fail(new HostedReceiptRunnerError({
        operation: "requireWorkerAbsent",
        reason: "ownershipUnknown",
        message: `Could not prove ${worker} absent: ${tail(result.output)}`,
      }));
    }
  });
}

function requireCommandSuccess(
  dependencies: HostedReceiptRunnerDependencies,
  args: readonly string[],
  operation: string,
  input?: string,
): Effect.Effect<WranglerCommandResult, HostedReceiptRunnerError> {
  return dependencies.commands.run(args, input).pipe(
    Effect.flatMap(result => result.code === 0
      ? Effect.succeed(result)
      : Effect.fail(commandFailure(operation, result))),
  );
}

function deployHostTeardown(
  dependencies: HostedReceiptRunnerDependencies,
  lease: WorkerLease,
  args: readonly string[],
  expectedMessage: string,
): Effect.Effect<void, HostedReceiptRunnerError> {
  const command = dependencies.commands.run(args).pipe(
    Effect.flatMap(result => result.code === 0
      ? Effect.void
      : Effect.fail(commandFailure("teardownHostNamespace", result))),
  );
  return command.pipe(Effect.matchEffect({
    onFailure: commandError => requireCurrentDeploymentMessage(
      dependencies,
      lease,
      expectedMessage,
    ).pipe(Effect.catchTag("HostedReceiptRunnerError", reconciliationError => Effect.fail(
      combinedCleanupError(
        "teardownHostNamespace",
        commandError,
        reconciliationError,
      ),
    ))),
    onSuccess: () => requireCurrentDeploymentMessage(
      dependencies,
      lease,
      expectedMessage,
    ),
  }));
}

function deleteOwnedWorker(
  dependencies: HostedReceiptRunnerDependencies,
  lease: WorkerLease,
  args: readonly string[],
  operation: string,
  input: string,
): Effect.Effect<void, HostedReceiptRunnerError> {
  const command = dependencies.commands.run(args, input).pipe(
    Effect.flatMap(result => result.code === 0
      ? Effect.void
      : Effect.fail(commandFailure(operation, result))),
  );
  return command.pipe(Effect.matchEffect({
    onFailure: commandError => requireWorkerAbsent(
      dependencies,
      lease.worker,
      lease.config,
      false,
    ).pipe(Effect.catchTag("HostedReceiptRunnerError", reconciliationError => Effect.fail(
      combinedCleanupError(operation, commandError, reconciliationError),
    ))),
    onSuccess: () => requireWorkerAbsent(
      dependencies,
      lease.worker,
      lease.config,
      false,
    ),
  }));
}

const readCurrentDeploymentMessage = Effect.fn(
  "Fx02bHostedReceipt.readCurrentDeploymentMessage",
)(function* (
  dependencies: HostedReceiptRunnerDependencies,
  lease: WorkerLease,
): Effect.fn.Return<string | null, HostedReceiptRunnerError> {
    const result = yield* dependencies.commands.run([
      "deployments", "list", "--config", lease.config, "--json",
    ]);
    if (result.code !== 0) {
      if (reportsAbsent(result.output, lease.worker)) return null;
      return yield* ownershipUnknown(lease.worker, tail(result.output));
    }
    const decoded = yield* parseJson("reconcileOwnership", result.output);
    if (!Array.isArray(decoded)) {
      return yield* ownershipUnknown(
        lease.worker,
        "deployment list is not an array",
      );
    }
    const current = decoded.at(-1);
    if (!isNonArrayRecord(current)) {
      return yield* ownershipUnknown(
        lease.worker,
        "current deployment is missing",
      );
    }
    const deploymentVersions = current.versions;
    if (!Array.isArray(deploymentVersions) || deploymentVersions.length !== 1) {
      return yield* ownershipUnknown(
        lease.worker,
        "current deployment does not have exactly one version",
      );
    }
    const currentVersion = deploymentVersions[0];
    if (
      !isNonArrayRecord(currentVersion)
      || typeof currentVersion.version_id !== "string"
      || currentVersion.percentage !== 100
    ) {
      return yield* ownershipUnknown(
        lease.worker,
        "current deployment version identity is invalid",
      );
    }
    const versionsResult = yield* dependencies.commands.run([
      "versions", "list", "--config", lease.config, "--json",
    ]);
    if (versionsResult.code !== 0) {
      return yield* ownershipUnknown(lease.worker, tail(versionsResult.output));
    }
    const versions = yield* parseJson(
      "reconcileOwnership",
      versionsResult.output,
    );
    if (!Array.isArray(versions)) {
      return yield* ownershipUnknown(
        lease.worker,
        "version list is not an array",
      );
    }
    const exactVersion = versions.find(version =>
      isNonArrayRecord(version) && version.id === currentVersion.version_id
    );
    if (!isNonArrayRecord(exactVersion)) {
      return yield* ownershipUnknown(
        lease.worker,
        "current deployment version is missing from the version catalog",
      );
    }
    const annotations = exactVersion.annotations;
    if (!isNonArrayRecord(annotations)) {
      return yield* ownershipUnknown(
        lease.worker,
        "current version annotations are missing",
      );
    }
    const message = annotations["workers/message"];
    if (typeof message !== "string") {
      return yield* ownershipUnknown(
        lease.worker,
        "current deployment message is missing",
      );
    }
    return message;
});

function requireCurrentDeploymentMessage(
  dependencies: HostedReceiptRunnerDependencies,
  lease: WorkerLease,
  expectedMessage: string,
): Effect.Effect<void, HostedReceiptRunnerError> {
  return readCurrentDeploymentMessage(dependencies, lease).pipe(
    Effect.flatMap(message => message === expectedMessage
      ? Effect.void
      : ownershipUnknown(
        lease.worker,
        "the current deployment is not the expected cleanup deployment",
      )),
  );
}

function combinedCleanupError(
  operation: string,
  command: HostedReceiptRunnerError,
  reconciliation: HostedReceiptRunnerError,
): HostedReceiptRunnerError {
  return new HostedReceiptRunnerError({
    operation,
    reason: "cleanupFailed",
    message: `${operation} failed locally and remote reconciliation did not prove completion.`,
    cause: Object.freeze({ command, reconciliation }),
  });
}

function validateOptions(
  options: HostedReceiptRunnerOptions,
): Effect.Effect<void, HostedReceiptRunnerError> {
  const values = [
    options.maximumRestartProbes,
    options.requestTimeoutMilliseconds,
    options.overallTimeoutMilliseconds,
  ];
  if (
    values.some(value => !Number.isSafeInteger(value) || value <= 0)
    || !Number.isSafeInteger(options.restartProbeDelayMilliseconds)
    || options.restartProbeDelayMilliseconds < 0
  ) {
    return Effect.fail(new HostedReceiptRunnerError({
      operation: "validateOptions",
      reason: "invalidConfiguration",
      message: "Hosted receipt limits must be bounded safe integers.",
    }));
  }
  return Effect.void;
}

function validateIdentity(
  identity: HostedReceiptRunIdentity,
): Effect.Effect<void, HostedReceiptRunnerError> {
  const tokens = [
    identity.gatewayToken,
    identity.probeToken,
    identity.executorToken,
  ];
  if (
    !RUN_ID_PATTERN.test(identity.runId)
    || identity.initialMarker !== `fx02b-${identity.runId}-initial`
    || identity.restartMarker !== `fx02b-${identity.runId}-restart`
    || tokens.some(token => !TOKEN_PATTERN.test(token))
    || new Set(tokens).size !== tokens.length
  ) {
    return Effect.fail(new HostedReceiptRunnerError({
      operation: "validateIdentity",
      reason: "invalidConfiguration",
      message: "Hosted receipt identity must use one exact run ID, derived markers, and three distinct 32-byte base64url tokens.",
    }));
  }
  return Effect.void;
}

function writeSecretFile(
  path: string,
  secrets: Readonly<Record<string, string>>,
): Effect.Effect<void, HostedReceiptRunnerError> {
  return fromPromise("writeSecretFile", "filesystemFailed", () =>
    writeFile(path, JSON.stringify(secrets), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    })
  );
}

function parseJson(
  operation: string,
  value: string,
): Effect.Effect<unknown, HostedReceiptRunnerError> {
  return Effect.try({
    try: () => {
      const decoded: unknown = JSON.parse(value);
      return decoded;
    },
    catch: cause => new HostedReceiptRunnerError({
      operation,
      reason: "ownershipUnknown",
      message: "Wrangler returned invalid JSON while reconciling ownership.",
      cause,
    }),
  });
}

async function readBoundedJsonBody(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.body === null) {
    return await Promise.reject(new Error(
      "Hosted probe response body is missing.",
    ));
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancel = () => {
    const cancellation = reader.cancel(signal.reason);
    void cancellation.catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAXIMUM_RECEIPT_BODY_BYTES) {
        await reader.cancel("hosted receipt body limit exceeded");
        return await Promise.reject(new Error(
          "Hosted probe response body exceeded its byte limit.",
        ));
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const decoded: unknown = JSON.parse(text);
    return decoded;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function fromPromise<A>(
  operation: string,
  reason: HostedReceiptRunnerFailureReason,
  run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, HostedReceiptRunnerError> {
  return Effect.tryPromise({
    try: run,
    catch: cause => new HostedReceiptRunnerError({
      operation,
      reason,
      message: `${operation} failed.`,
      cause,
    }),
  });
}

function recordCleanupFailure(
  cleanupFailures: Ref.Ref<readonly HostedReceiptRunnerError[]>,
): (effect: Effect.Effect<unknown, HostedReceiptRunnerError>) => Effect.Effect<void> {
  return effect => effect.pipe(Effect.matchEffect({
    onFailure: failure => Ref.update(
        cleanupFailures,
        failures => [...failures, failure],
      ),
    onSuccess: () => Effect.void,
  }));
}

function transientToTerminal(
  operation: string,
): (error: TransientHostedProbeError) => HostedReceiptRunnerError {
  return error => new HostedReceiptRunnerError({
    operation,
    reason: "hostedRequestFailed",
    message: `${error.message} Classification: ${error.classification}.`,
    cause: error,
  });
}

function initialProbeErrorToTerminal(
  error: HostedReceiptRunnerError | TransientHostedProbeError,
): HostedReceiptRunnerError {
  return error._tag === "HostedReceiptRunnerError"
    ? error
    : transientToTerminal("initializeCursor")(error);
}

function invalidReceipt(
  operation: string,
  message: string,
): Effect.Effect<never, HostedReceiptRunnerError> {
  return Effect.fail(new HostedReceiptRunnerError({
    operation,
    reason: "invalidReceipt",
    message,
  }));
}

function ownershipUnknown(
  worker: string,
  detail: string,
): Effect.Effect<never, HostedReceiptRunnerError> {
  return Effect.fail(new HostedReceiptRunnerError({
    operation: "reconcileOwnership",
    reason: "ownershipUnknown",
    message: `Ownership of ${worker} is unknown because ${detail}.`,
  }));
}

function commandFailure(
  operation: string,
  result: WranglerCommandResult,
): HostedReceiptRunnerError {
  return new HostedReceiptRunnerError({
    operation,
    reason: "commandFailed",
    message: `Wrangler failed: ${tail(result.output)}`,
  });
}

function reportsAbsent(output: string, worker: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes(`/workers/scripts/${worker.toLowerCase()}/`)
    && normalized.includes("this worker does not exist on your account")
    && normalized.includes("code: 10007");
}

function isOwnedDeploymentMessage(
  value: unknown,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
): boolean {
  if (typeof value !== "string") return false;
  return lease.cleanup === "source"
    ? value === `${lease.messagePrefix} ${identity.runId}`
    : value === `${lease.messagePrefix} initial ${identity.runId}`
      || value === `${lease.messagePrefix} restart ${identity.runId}`
      || value === `${lease.messagePrefix} teardown ${identity.runId}`;
}

function requireCurrentOwnership(
  dependencies: HostedReceiptRunnerDependencies,
  identity: HostedReceiptRunIdentity,
  lease: WorkerLease,
): Effect.Effect<void, HostedReceiptRunnerError> {
  return reconcileOwnership(dependencies, identity, lease).pipe(
    Effect.flatMap(ownership => ownership === "owned"
      ? Effect.void
      : ownershipUnknown(
        lease.worker,
        `destructive cleanup observed current ownership ${ownership}`,
      )),
  );
}

function readDeploymentUrl(
  output: string,
): Effect.Effect<string, HostedReceiptRunnerError> {
  const urls = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/gi)
    ?? [];
  const expectedPrefix = `https://${FX02B_HOST_WORKER}.`;
  const url = urls.find(candidate => candidate.toLowerCase().startsWith(expectedPrefix));
  return url === undefined
    ? Effect.fail(new HostedReceiptRunnerError({
      operation: "deploymentUrl",
      reason: "commandFailed",
      message: "Wrangler did not report the isolated host workers.dev URL.",
    }))
    : Effect.succeed(url);
}

function tail(value: string): string {
  return value.slice(-2_000);
}
