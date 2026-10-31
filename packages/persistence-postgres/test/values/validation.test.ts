import type { ValidatorJson as ProtocolValidatorJson } from "flarex-protocol/validator-json";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  schemaTableValidatorsFromAnalysis,
  validateDocumentValue,
  type ValidatorJson as PersistenceValidatorJson,
} from "../../src/values/validation";

describe("persistence validator metadata", () => {
  it("uses the protocol-owned ValidatorJson contract", () => {
    expectTypeOf<PersistenceValidatorJson>().toEqualTypeOf<ProtocolValidatorJson>();
  });

  it("preserves the persistence error adapter while decoding protocol metadata", () => {
    expect(schemaTableValidatorsFromAnalysis({
      schema: {
        tables: [{
          tableId: 1,
          name: "users",
          validator: {
            type: "object",
            value: {
              name: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
        }],
      },
    })).toEqual([{
      tableId: 1,
      name: "users",
      validator: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    }]);
  });

  it("treats reserved object names as own validator and document fields", () => {
    for (const fieldName of ["__proto__", "constructor", "toString"]) {
      const fields = Object.fromEntries([[
        fieldName,
        { fieldType: { type: "string" }, optional: false },
      ]]);
      const [table] = schemaTableValidatorsFromAnalysis({
        schema: {
          tables: [{
            tableId: 1,
            name: "users",
            validator: { type: "object", value: fields },
          }],
        },
      });
      if (table?.validator === undefined || table.validator === null || table.validator.type !== "object") {
        throw new Error("Expected an object validator.");
      }
      expect(Object.hasOwn(table.validator.value, fieldName)).toBe(true);
      expect(() => validateDocumentValue([table], 1, "1:ada", {})).toThrow(
        `failed validation at $.${fieldName}: Required field is missing.`,
      );
      expect(() => validateDocumentValue(
        [{ ...table, validator: { type: "object", value: {} } }],
        1,
        "1:ada",
        Object.fromEntries([[fieldName, "value"]]),
      )).toThrow(`failed validation at $.${fieldName}: Field is not allowed.`);
      expect(() => validateDocumentValue(
        [table],
        1,
        "1:ada",
        Object.fromEntries([[fieldName, "value"]]),
      )).not.toThrow();
    }
  });
  it("decodes signed literals without enabling the retained JSON-only bigint transport", () => {
    const tables = schemaTableValidatorsFromAnalysis({ schema: { tables: [{
      tableId: 1, name: "literals", validator: { type: "object", value: {
        sign: { fieldType: { type: "literal", value: { $float: "AAAAAAAAAIA=" } }, optional: false },
      } },
    }] } });
    expect(() => validateDocumentValue(tables, 1, "1:literal", { sign: -0 })).not.toThrow();
    expect(() => validateDocumentValue(tables, 1, "1:literal", { sign: 0 })).toThrow("failed validation at $.sign");
    const bigintTables = schemaTableValidatorsFromAnalysis({ schema: { tables: [{
      tableId: 1, name: "literals", validator: { type: "literal", value: { $integer: "AQAAAAAAAAA=" } },
    }] } });
    expect(bigintTables[0]?.validator).toEqual({ type: "literal", value: 1n });
    expect(() => validateDocumentValue(bigintTables, 1, "1:literal", { $integer: "AQAAAAAAAAA=" })).toThrow("Bigint transport is not implemented.");
  });

});
