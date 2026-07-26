import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  decodeCanonicalDeclarativeProgramV1,
  makeCanonicalDeclarativeProgramBudgetV1,
} from "@flarex/declarative-program/v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { analyzeCanonicalDeclarativeProgramV1 } from "../src/canonicalDeclarativeProgramV1.ts";

const BUDGET = Result.getOrThrow(makeCanonicalDeclarativeProgramBudgetV1({
  maximumModules: 4,
  maximumFunctions: 8,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 128,
  maximumValidatorDepth: 16,
  maximumValidatorStringUtf8Bytes: 4_096,
}));

describe("analyzeCanonicalDeclarativeProgramV1", () => {
  it("projects the approved global-table mutation vertical", () => {
    const program = Result.getOrThrow(decodeCanonicalDeclarativeProgramV1({
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: 1,
      schema: {
        tables: [{
          logicalName: "orders",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                status: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [{
          tableLogicalName: "orders",
          descriptor: "by_status",
          fields: ["status"],
        }],
      },
      modules: [{
        modulePath: "orders",
        functions: [{
          exportName: "place",
          kind: "mutation",
          visibility: "public",
          argsValidator: {
            type: "object",
            value: {
              status: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returnsValidator: { type: "null" },
        }],
      }],
    }, BUDGET));

    expect(analyzeCanonicalDeclarativeProgramV1(program)).toEqual({
      schema: {
        version: 1,
        tables: [{
          tableId: 1,
          name: "orders",
          validator: {
            type: "object",
            value: {
              status: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          placement: { kind: "global" },
        }],
        indexes: [{
          indexId: 1,
          tableId: 1,
          name: "by_status",
          fields: ["status"],
        }],
      },
      functions: [{
        moduleName: "orders",
        functions: [{
          moduleName: "orders",
          exportName: "place",
          kind: "mutation",
          visibility: "public",
          args: {
            type: "object",
            value: {
              status: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returns: { type: "null" },
          partition: null,
        }],
      }],
    });
  });
});
