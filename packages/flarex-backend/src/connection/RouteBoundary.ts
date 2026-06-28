import { liveQueryDeliveryChangesFromBody, type LiveQueryDeliveryChange } from "../liveQueryDelivery";
import { HttpError, readJson } from "../http";
import type { QueryId } from "../syncProtocol";

export async function readConnectionInvalidationRequest(
  request: Request,
): Promise<QueryId> {
  return parseConnectionInvalidationRequest(await readJson(request));
}

export function parseConnectionInvalidationRequest(value: unknown): QueryId {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { queryId?: unknown }).queryId === "number" &&
    Number.isInteger((value as { queryId: number }).queryId)
  ) {
    return (value as { queryId: number }).queryId;
  }
  throw new HttpError(400, "Invalidation queryId must be an integer.");
}

export async function readConnectionLiveQueryDeliveryRequest(
  request: Request,
): Promise<LiveQueryDeliveryChange[]> {
  return parseConnectionLiveQueryDeliveryRequest(await readJson(request));
}

export function parseConnectionLiveQueryDeliveryRequest(
  value: unknown,
): LiveQueryDeliveryChange[] {
  try {
    return liveQueryDeliveryChangesFromBody(value);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}
