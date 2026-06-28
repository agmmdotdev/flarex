import { readJson } from "../http";
import { parseExecutionFinishRouteRequest } from "./FinishRouteBoundary";
import { parseExecutionSyscallRouteRequest } from "./SyscallRouteBoundary";

export type PublicExecutionAction = "syscall" | "finish" | "abort";

export async function readPublicExecutionActionRequest(
  request: Request,
  action: PublicExecutionAction,
): Promise<unknown> {
  return parsePublicExecutionActionRequest(await readJson(request), action);
}

export function parsePublicExecutionActionRequest(
  value: unknown,
  action: PublicExecutionAction,
): unknown {
  if (action === "syscall") return parseExecutionSyscallRouteRequest(value);
  if (action === "finish") return parseExecutionFinishRouteRequest(value);
  return value;
}
