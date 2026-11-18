import { describe } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { registerCorePayloadNativeStore } from "./core-payload-native-store-scenarios";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)("frozen Native10 Payload store (ordinary PostgreSQL)", () => {
  registerCorePayloadNativeStore("postgres");
});
