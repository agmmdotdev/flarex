import { liveQueryDeliveryChangesFromBody, type LiveQueryDeliveryChange } from "../liveQueryDelivery";
import { HttpError, readJson } from "../http";

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
