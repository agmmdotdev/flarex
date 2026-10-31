import { describe } from "vitest";
import { registerCorePayloadNativeDurability } from "./core-payload-native-durability-scenarios";

describe("five-table native Payload durability (PGlite)", () => {
  registerCorePayloadNativeDurability("pglite");
});
