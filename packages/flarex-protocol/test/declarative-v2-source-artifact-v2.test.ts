import { describe, expect, test } from "vitest";

import {
  isSourceArtifactV2ModuleRolesV1,
  SOURCE_ARTIFACT_V2_CODEC_VERSION,
  SOURCE_ARTIFACT_V2_ROLE_AUTH,
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_MASK,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "../src/declarative-v2-source-artifact-v2";

describe("Declarative V2 Source Artifact V2 protocol vocabulary", () => {
  test("pins the existing role-bit wire values", () => {
    expect(SOURCE_ARTIFACT_V2_CODEC_VERSION).toBe(1);
    expect(SOURCE_ARTIFACT_V2_ROLE_BITS_V1).toEqual({
      function: 1,
      schema: 2,
      auth: 4,
      execution: 8,
    });
    expect(SOURCE_ARTIFACT_V2_ROLE_FUNCTION).toBe(1);
    expect(SOURCE_ARTIFACT_V2_ROLE_SCHEMA).toBe(2);
    expect(SOURCE_ARTIFACT_V2_ROLE_AUTH).toBe(4);
    expect(SOURCE_ARTIFACT_V2_ROLE_EXECUTION).toBe(8);
    expect(SOURCE_ARTIFACT_V2_ROLE_MASK).toBe(15);
    expect(Object.isFrozen(SOURCE_ARTIFACT_V2_ROLE_BITS_V1)).toBe(true);
  });

  test.each([1, 2, 4, 8, 3, 9, 15])(
    "accepts the nonempty supported role set %d",
    (roles) => {
      expect(isSourceArtifactV2ModuleRolesV1(roles)).toBe(true);
    },
  );

  test.each([
    undefined,
    null,
    "1",
    0,
    -0,
    -1,
    1.5,
    16,
    17,
    0x1_0000_0001,
    Number.MAX_SAFE_INTEGER,
  ])(
    "rejects the unsupported role set %#",
    (roles) => {
      expect(isSourceArtifactV2ModuleRolesV1(roles)).toBe(false);
    },
  );
});
