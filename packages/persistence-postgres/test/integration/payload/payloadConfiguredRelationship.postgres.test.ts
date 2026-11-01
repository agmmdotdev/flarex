import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadConfiguredRelationshipScenario } from "./payloadConfiguredRelationshipScenario";

describe.skipIf(postgresUrl === null)("configured Payload relationships (ordinary-role PostgreSQL)", () => {
  it.each([["authors", "author"], ["article-authors", "editor"]])("compiles and runs articles -> %s via %s", (target, field) =>
    payloadConfiguredRelationshipScenario("postgres", target, field), 180_000);
});
