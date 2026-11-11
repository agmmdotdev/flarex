import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { makeCartCreationRuntimes } from "../../src/workflows/cart/creation-runtimes";

/** Test-only logger observation around genuine module construction. */
export async function cartCreationRuntimes() {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  return { ...await Effect.runPromise(makeCartCreationRuntimes(logger)), errors };
}
