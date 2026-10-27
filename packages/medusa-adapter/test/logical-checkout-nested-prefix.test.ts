import { Schema } from "effect";
import { it } from "vitest";
import { verifyNestedPrefixStorage } from "./support/logical-nested-prefix";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
it("hydrates an authenticated target-local suffix and native stored Link on real isolated sources", () => verifyNestedPrefixStorage(driver), 240_000);
