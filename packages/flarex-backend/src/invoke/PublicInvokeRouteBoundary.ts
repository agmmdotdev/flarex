import {
  InvokeProtocolValidationError,
  parsePublicInvokeRequestBody,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import { HttpError, readJson } from "../http";

export async function readPublicInvokeRequest(
  request: Request,
): Promise<PublicInvokeRequestBody> {
  return parsePublicInvokeRouteRequest(await readJson(request));
}

export function parsePublicInvokeRouteRequest(
  value: unknown,
): PublicInvokeRequestBody {
  try {
    return parsePublicInvokeRequestBody(value);
  } catch (error) {
    if (error instanceof InvokeProtocolValidationError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}
