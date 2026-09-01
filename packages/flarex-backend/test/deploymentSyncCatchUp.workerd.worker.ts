import type {
  DeploymentSyncCatchUpProbeResponse,
} from "../src/deploymentSync/CatchUpProbe";
import { DeploymentSyncDO } from "../src/deploymentSyncDO";

interface TestEnv {
  readonly DEPLOYMENT_SYNCS: DurableObjectNamespace;
}

interface DeploymentSyncProbeStub {
  readonly runCatchUpProbe: (
    request: unknown,
  ) => Promise<DeploymentSyncCatchUpProbeResponse>;
}

export { DeploymentSyncDO };

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const input: unknown = await request.json();
    if (!isRecord(input) || typeof input.objectName !== "string") {
      return new Response("Invalid test request", { status: 400 });
    }
    const stub = env.DEPLOYMENT_SYNCS.getByName(input.objectName) as unknown as
      DeploymentSyncProbeStub;
    const response = await stub.runCatchUpProbe(input.request);
    return new Response(stringifyWithBigInts(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
};

function stringifyWithBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    typeof member === "bigint" ? member.toString() : member
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
