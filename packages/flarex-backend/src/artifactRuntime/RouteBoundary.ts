import { HttpError } from "../http";
import type { ExecutionArtifactInvokePayload } from "../artifactRuntime";

const INVALID_INVOKE_PAYLOAD_MESSAGE = "Invalid execution artifact invoke payload.";

export async function readExecutionArtifactInvokePayload(
  request: Request,
): Promise<ExecutionArtifactInvokePayload> {
  return parseExecutionArtifactInvokePayload(
    await request.json().catch(() => null),
  );
}

export function parseExecutionArtifactInvokePayload(
  value: unknown,
): ExecutionArtifactInvokePayload {
  if (isExecutionArtifactInvokePayload(value)) return value;
  throw new HttpError(400, INVALID_INVOKE_PAYLOAD_MESSAGE);
}

function isExecutionArtifactInvokePayload(
  value: unknown,
): value is ExecutionArtifactInvokePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<ExecutionArtifactInvokePayload>;
  return (
    typeof payload.deploymentId === "string" &&
    typeof payload.ref === "object" &&
    payload.ref !== null &&
    (payload.sourcePackage === undefined ||
      (typeof payload.sourcePackage === "object" && payload.sourcePackage !== null)) &&
    typeof payload.request === "object" &&
    payload.request !== null
  );
}
