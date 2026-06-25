import type { FinishPushRejectionCode, FinishPushResponse, PushStatus } from "./types.ts";

export function rejectedFinishPushResponse(
  status: PushStatus,
  code: FinishPushRejectionCode,
  error: string,
): FinishPushResponse {
  return {
    result: "rejected",
    push: status,
    code,
    error,
    ...(status.diagnostics === undefined ? {} : { diagnostics: status.diagnostics }),
  };
}
