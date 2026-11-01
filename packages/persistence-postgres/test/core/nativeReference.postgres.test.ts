import { describe } from "vitest";
import { postgresUrl } from "../support/postgresHelpers";
import { registerCoreNativeReferenceScenarios } from "./nativeReferenceScenarios";
describe.skipIf(postgresUrl === null)("native references (ordinary-role PostgreSQL)", () => registerCoreNativeReferenceScenarios("postgres"));
