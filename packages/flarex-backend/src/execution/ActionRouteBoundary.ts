import { readJson } from "../http";
import { parseExecutionFinishRouteRequest } from "./FinishRouteBoundary";
import { parseExecutionSyscallRouteRequest } from "./SyscallRouteBoundary";

export type PublicExecutionAction = "syscall" | "finish" | "abort";

export async function readPublicExecutionActionRequest(
  request: Request,
  action: PublicExecutionAction,
): Promise<unknown> {
  const body = await readJson(request);
  if (action === "syscall") return parseExecutionSyscallRouteRequest(body);
  if (action === "finish") return parseExecutionFinishRouteRequest(body);
  return body;
}
