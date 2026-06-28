import { HttpError, readJson } from "../http";
import {
  liveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChange,
} from "../liveQueryDelivery";

export async function readPublicLiveQueryDeliveryRequest(
  request: Request,
): Promise<LiveQueryDeliveryChange[]> {
  return parsePublicLiveQueryDeliveryRequest(await readJson(request));
}

export function parsePublicLiveQueryDeliveryRequest(
  value: unknown,
): LiveQueryDeliveryChange[] {
  try {
    return liveQueryDeliveryChangesFromBody(value);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}
