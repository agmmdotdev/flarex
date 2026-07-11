import {
  decodeH05DataPlaneEvidenceJson,
  type H05DataPlaneEvidenceDecode,
} from "../h05/receipt";

export function decodeVerifiedH05DataPlaneEvidenceJson(
  raw: string,
): H05DataPlaneEvidenceDecode {
  return decodeH05DataPlaneEvidenceJson(raw);
}
