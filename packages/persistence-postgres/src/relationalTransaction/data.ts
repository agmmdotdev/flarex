import { capturePrivateJsonData } from "../privateJsonData";
import { relationalError } from "./model";

/** The relational profile retains its own failure contract over shared capture. */
export function captureRelationalData(input: unknown, maximum: number) {
  return capturePrivateJsonData(input, maximum, relationalError);
}
