import { DeploymentSyncDO } from "flarex-backend/worker";

import { hasExactBearerCapability, isConfiguredSecret } from "./authentication";
import {
  FX02B_INITIAL_BUDGET,
  FX02B_IDENTITY_PATH,
  FX02B_INITIAL_PATH,
  FX02B_PROBE_OBJECT_NAME,
  FX02B_PROBE_OBSERVATION,
  FX02B_RESUME_BUDGET,
  FX02B_RESUME_PATH,
} from "./fixture";
import type {
  Fx02bInitialHostedReceipt,
  Fx02bResumeHostedReceipt,
} from "./hostedReceiptProtocol";

declare const FX02B_RELEASE_MARKER: string;

interface Fx02bHostEnv {
  readonly CF_VERSION_METADATA: WorkerVersionMetadata;
  readonly DEPLOYMENT_SYNCS: DurableObjectNamespace<DeploymentSyncProbeDO>;
  readonly FLAREX_EXECUTOR?: Fetcher;
  readonly FLAREX_EXECUTOR_TOKEN?: string;
  readonly FLAREX_FX02B_GATEWAY_TOKEN?: string;
  readonly FLAREX_QUERY_SYNC_PROBE_TOKEN?: string;
}

interface Fx02bHostConfiguration {
  readonly gatewayToken: string;
  readonly probeToken: string;
  readonly workerVersionId: string;
}

type ProbeRoute = "identity" | "initialize" | "resume";

type DeploymentSyncCatchUpProbeOutcome = Awaited<
  ReturnType<DeploymentSyncDO["runCatchUpProbe"]>
>;

interface Fx02bHostedDoReceipt {
  readonly bootId: string;
  readonly outcome: DeploymentSyncCatchUpProbeOutcome;
}

type Fx02bHostedReceipt =
  | Fx02bInitialHostedReceipt
  | Fx02bResumeHostedReceipt;

export class DeploymentSyncProbeDO extends DeploymentSyncDO {
  private readonly fx02bBootId = crypto.randomUUID();

  async runHostedCatchUpProbe(
    request: unknown,
  ): Promise<Fx02bHostedDoReceipt> {
    const outcome = await this.runCatchUpProbe(request);
    return Object.freeze({
      bootId: this.fx02bBootId,
      outcome,
    });
  }

  readHostedIdentity(): Readonly<{ readonly bootId: string }> {
    return Object.freeze({ bootId: this.fx02bBootId });
  }
}

export const fx02bHostWorker = {
  async fetch(request: Request, env: Fx02bHostEnv): Promise<Response> {
    const configuration = captureConfiguration(env);
    if (configuration === null) return privateJson({ error: "misconfigured" }, 500);
    if (!(await hasExactBearerCapability(
      request,
      configuration.gatewayToken,
    ))) return privateJson({ error: "unauthorized" }, 401);
    const route = routeFromRequest(request);
    if (route === null) return privateJson({ error: "not_found" }, 404);
    if (request.method !== "POST") {
      return privateJson({ error: "method_not_allowed" }, 405);
    }
    const stub = env.DEPLOYMENT_SYNCS.getByName(FX02B_PROBE_OBJECT_NAME);
    try {
      if (route === "identity") {
        const identity = await stub.readHostedIdentity();
        return privateJson({
          protocolVersion: 1,
          phase: route,
          releaseMarker: FX02B_RELEASE_MARKER,
          workerVersionId: configuration.workerVersionId,
          objectName: FX02B_PROBE_OBJECT_NAME,
          bootId: identity.bootId,
        }, 200);
      }
      const receipt = await stub.runHostedCatchUpProbe(Object.freeze({
        authorizationToken: configuration.probeToken,
        observation: FX02B_PROBE_OBSERVATION,
        budget: route === "initialize"
          ? FX02B_INITIAL_BUDGET
          : FX02B_RESUME_BUDGET,
        authorizeFreshInitialization: route === "initialize",
      }));
      const hostedReceipt = projectHostedReceipt(
        route,
        configuration,
        receipt,
      );
      if (hostedReceipt === null) {
        return privateJson({ error: "unexpected_probe_outcome" }, 409);
      }
      return privateJson(hostedReceipt, 200);
    } catch {
      console.error(JSON.stringify({
        kind: "fx02b-hosted-rpc-failure",
        route,
        classification: "durable_object_rpc_rejected",
      }));
      return privateJson({
        error: "probe_rpc_failed",
        classification: "durable_object_rpc_rejected",
      }, 500, "durable_object_rpc_rejected");
    }
  },
} satisfies ExportedHandler<Fx02bHostEnv>;

export default fx02bHostWorker;

function captureConfiguration(
  env: Fx02bHostEnv,
): Fx02bHostConfiguration | null {
  const gatewayToken = env.FLAREX_FX02B_GATEWAY_TOKEN;
  const probeToken = env.FLAREX_QUERY_SYNC_PROBE_TOKEN;
  const executorToken = env.FLAREX_EXECUTOR_TOKEN;
  const workerVersionId = env.CF_VERSION_METADATA.id;
  if (
    env.FLAREX_EXECUTOR === undefined
    || !isConfiguredSecret(gatewayToken)
    || !isConfiguredSecret(probeToken)
    || !isConfiguredSecret(executorToken)
    || !isConfiguredSecret(workerVersionId)
    || !isConfiguredSecret(FX02B_RELEASE_MARKER)
    || gatewayToken === probeToken
    || gatewayToken === executorToken
    || probeToken === executorToken
  ) return null;
  return Object.freeze({ gatewayToken, probeToken, workerVersionId });
}

function projectHostedReceipt(
  phase: Exclude<ProbeRoute, "identity">,
  configuration: Fx02bHostConfiguration,
  receipt: Fx02bHostedDoReceipt,
): Fx02bHostedReceipt | null {
  if (!receipt.outcome.ok) return null;
  const common = {
    protocolVersion: 1 as const,
    releaseMarker: FX02B_RELEASE_MARKER,
    workerVersionId: configuration.workerVersionId,
    objectName: FX02B_PROBE_OBJECT_NAME,
    bootId: receipt.bootId,
  } as const;
  if (phase === "initialize") {
    if (
      receipt.outcome.value._tag !== "continuationRequired"
      || receipt.outcome.value.reason !== "admittedBatchLimitReached"
    ) return null;
    return Object.freeze({
      ...common,
      phase,
      outcome: Object.freeze({
        state: receipt.outcome.value._tag,
        reason: receipt.outcome.value.reason,
        cursor: String(receipt.outcome.value.progress.lastDurableCursor
          .appliedThroughSequence),
      }),
    });
  }
  if (receipt.outcome.value._tag !== "caughtUp") return null;
  return Object.freeze({
    ...common,
    phase,
    outcome: Object.freeze({
      state: receipt.outcome.value._tag,
      cursor: String(receipt.outcome.value.cursor.appliedThroughSequence),
    }),
  });
}

function routeFromRequest(request: Request): ProbeRoute | null {
  const pathname = new URL(request.url).pathname;
  if (pathname === FX02B_IDENTITY_PATH) return "identity";
  if (pathname === FX02B_INITIAL_PATH) return "initialize";
  if (pathname === FX02B_RESUME_PATH) return "resume";
  return null;
}

function privateJson(
  value: unknown,
  status: number,
  classification?: string,
): Response {
  return new Response(JSON.stringify(
    value,
    (_key, member: unknown) => typeof member === "bigint"
      ? member.toString()
      : member,
  ), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(classification === undefined
        ? {}
        : { "x-flarex-probe-classification": classification }),
    },
  });
}
