import { describe } from "vitest";
import { registerCorePayloadNativeStore } from "./core-payload-native-store-scenarios";

describe("frozen Native10 Payload store (PGlite)", () => {
  registerCorePayloadNativeStore("pglite");
});
