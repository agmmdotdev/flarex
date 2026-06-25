import type { FinishPushResponse, PushStatus } from "./types.ts";

export function rejectedFinishPushResponse(
  status: PushStatus,
  error: string,
): FinishPushResponse {
  return {
    result: "rejected",
    push: status,
    error,
    ...(status.diagnostics === undefined ? {} : { diagnostics: status.diagnostics }),
  };
}
