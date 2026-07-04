import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeDeploymentStorageCodegenAnalysisJson,
  decodeDeploymentStorageDiagnosticsJson,
  decodeDeploymentStorageExecutionArtifactRefJson,
  decodeDeploymentStorageFunctionsJson,
  decodeDeploymentStorageSchemaJson,
  decodeDeploymentStorageSourcePackageJson,
} from "../src/deployment/StorageRows";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentValidationError,
} from "../src/deployment/Errors";

describe("deployment storage row decoders", () => {
  it("schema-checks persisted push row JSON fields", async () => {
    const schema = {
      version: 1,
      tables: [],
      indexes: [],
    };
    const functions = {
      functions: [{
        path: "messages.ts:list",
        kind: "query",
        args: { type: "any" },
        returns: null,
      }],
    };
    const codegenAnalysis = {
      schema,
      functions: [{
        moduleName: "messages.ts",
        functions: [{
          moduleName: "messages.ts",
          exportName: "list",
          kind: "query",
          visibility: "public",
          args: { type: "any" },
          returns: null,
        }],
      }],
    };

    await expect(Effect.runPromise(decodeDeploymentStorageSourcePackageJson(JSON.stringify({
      modules: [{
        path: "__execution.ts",
        environment: "isolate",
        sha256: "a".repeat(64),
      }],
      functions: [],
      authConfigModule: "_flarex/auth.config.js",
      authConfig: {
        providers: [{
          domain: "https://auth.example.com",
          applicationID: "app-123",
        }],
      },
      execution: "__execution.ts",
    })))).resolves.toMatchObject({
      execution: "__execution.ts",
      authConfigModule: "_flarex/auth.config.js",
      authConfig: {
        providers: [{
          domain: "https://auth.example.com",
          applicationID: "app-123",
        }],
      },
    });
    await expect(Effect.runPromise(decodeDeploymentStorageSchemaJson(JSON.stringify(schema))))
      .resolves.toEqual(schema);
    await expect(Effect.runPromise(decodeDeploymentStorageFunctionsJson(JSON.stringify(functions))))
      .resolves.toMatchObject(functions);
    await expect(Effect.runPromise(decodeDeploymentStorageCodegenAnalysisJson(JSON.stringify(codegenAnalysis))))
      .resolves.toMatchObject(codegenAnalysis);
    await expect(Effect.runPromise(decodeDeploymentStorageDiagnosticsJson(JSON.stringify([
      { level: "warn", message: "stored warning" },
    ])))).resolves.toEqual([{ level: "warn", message: "stored warning" }]);
  });

  it("fails persisted push row JSON as typed deployment validation errors", async () => {
    const malformed = await Effect.runPromise(
      Effect.flip(decodeDeploymentStorageSchemaJson("{")),
    );
    expect(malformed).toBeInstanceOf(DeploymentValidationError);
    expect(malformed.message).toBe("Stored push schema_json must be valid JSON.");

    const invalidShape = await Effect.runPromise(
      Effect.flip(decodeDeploymentStorageDiagnosticsJson(JSON.stringify({
        level: "debug",
        message: "too chatty",
      }))),
    );
    expect(invalidShape).toBeInstanceOf(DeploymentValidationError);
    expect(invalidShape.message).toBe("Stored push diagnostics_json must match stored schema.");
  });

  it("schema-checks active execution artifact refs before validating the artifact identity", async () => {
    const ref = {
      runtime: "dynamic-worker",
      artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourcePackageHash: "b".repeat(64),
      executionModule: "__execution.ts",
    };

    await expect(Effect.runPromise(decodeDeploymentStorageExecutionArtifactRefJson(
      "push-storage-ref",
      JSON.stringify(ref),
    ))).resolves.toEqual(ref);

    const invalidShape = await Effect.runPromise(
      Effect.flip(decodeDeploymentStorageExecutionArtifactRefJson("push-storage-ref", "null")),
    );
    expect(invalidShape).toBeInstanceOf(DeploymentActiveDeploymentInvalidError);
    expect(invalidShape.message).toBe("Stored execution artifact reference is invalid.");

    const invalidIdentity = await Effect.runPromise(
      Effect.flip(decodeDeploymentStorageExecutionArtifactRefJson(
        "push-storage-ref",
        JSON.stringify({ ...ref, artifactId: "bad-ref" }),
      )),
    );
    expect(invalidIdentity).toBeInstanceOf(DeploymentActiveDeploymentInvalidError);
    expect(invalidIdentity.message).toBe("Stored execution artifact reference has an invalid artifact ID.");
  });
});
