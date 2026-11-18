import { it } from "vitest";
import { payloadConfiguredRelationshipScenario } from "./payloadConfiguredRelationshipScenario";

it.each([["authors", "author"], ["article-authors", "editor"]])("compiles and runs articles -> %s via %s", (target, field) =>
  payloadConfiguredRelationshipScenario("pglite", target, field), 180_000);
