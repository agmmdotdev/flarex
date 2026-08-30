import {
  captureCanonicalDependencyKey,
  captureCanonicalQueryKey,
  canonicalBase64UrlDecodedLength,
  compareCanonicalBase64Url,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
  type CanonicalDependencyKey,
  type CanonicalQueryKey,
  type QueryGeneration,
} from "@flarex/query-sync/internal/kernel";
import type {
  QueryDependencyFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Result, Schema } from "effect";

import {
  captureDeploymentQuerySyncCanonicalValueResult,
  decodeDeploymentQuerySyncGenerationResult,
  decodeDeploymentQuerySyncRowShapeResult,
  deploymentQuerySyncRowCodecError,
  type DeploymentQuerySyncRowCodecError,
} from "./RowCodec";

export type DeploymentQuerySyncDependencyRole = "active" | "completion";

export interface DeploymentQuerySyncDependency<
  Role extends DeploymentQuerySyncDependencyRole =
    DeploymentQuerySyncDependencyRole,
> {
  readonly role: Role;
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly dependencyKey: CanonicalDependencyKey;
}

export type DeploymentQuerySyncActiveDependency =
  DeploymentQuerySyncDependency<"active">;

export interface EncodedDeploymentQuerySyncDependencyRow<
  Role extends DeploymentQuerySyncDependencyRole =
    DeploymentQuerySyncDependencyRole,
> {
  readonly role: Role;
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}

const RawDependencyRowSchema = Schema.Struct({
  role: Schema.String,
  query_key: Schema.String,
  generation: Schema.String,
  dependency_key: Schema.String,
});

const decodeRawDependencyRow = Schema.decodeUnknownResult(
  RawDependencyRowSchema,
  { onExcessProperty: "error" },
);

export function decodeDeploymentQuerySyncDependencyRowResult(
  input: unknown,
): Result.Result<
  DeploymentQuerySyncDependency,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeDeploymentQuerySyncRowShapeResult(
      "dependency",
      decodeRawDependencyRow(input),
    );
    if (row.role !== "active" && row.role !== "completion") {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "dependency",
        "valueInvalid",
        "role",
      ));
    }
    return Object.freeze({
      role: row.role,
      queryKey: yield* captureDeploymentQuerySyncCanonicalValueResult(
        "dependency",
        "query_key",
        captureCanonicalQueryKey(row.query_key),
      ),
      generation: yield* decodeDeploymentQuerySyncGenerationResult(
        "dependency",
        "generation",
        row.generation,
      ),
      dependencyKey: yield* captureDeploymentQuerySyncCanonicalValueResult(
        "dependency",
        "dependency_key",
        captureCanonicalDependencyKey(row.dependency_key),
      ),
    });
  });
}

export function decodeDeploymentQuerySyncGeneration2DependencyRowResult(
  input: unknown,
): Result.Result<
  DeploymentQuerySyncActiveDependency,
  DeploymentQuerySyncRowCodecError
> {
  return decodeDeploymentQuerySyncDependencyRowResult(input).pipe(
    Result.flatMap((dependency) => dependency.role === "active"
      ? Result.succeed(Object.freeze({
        role: "active" as const,
        queryKey: dependency.queryKey,
        generation: dependency.generation,
        dependencyKey: dependency.dependencyKey,
      }))
      : Result.fail(deploymentQuerySyncRowCodecError(
        "dependency",
        "valueInvalid",
        "role",
      ))),
  );
}

export function encodeDeploymentQuerySyncDependencyRow<
  Role extends DeploymentQuerySyncDependencyRole,
>(
  dependency: DeploymentQuerySyncDependency<Role>,
): EncodedDeploymentQuerySyncDependencyRow<Role> {
  return Object.freeze({
    role: dependency.role,
    query_key: dependency.queryKey,
    generation: dependency.generation.toString(),
    dependency_key: dependency.dependencyKey,
  });
}

export function decodeDeploymentQuerySyncDependencyRowsResult(
  inputs: readonly unknown[],
  expected: Readonly<{
    readonly role: DeploymentQuerySyncDependencyRole;
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
  }>,
): Result.Result<QueryDependencyFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    if (inputs.length > MAX_QUERY_DEPENDENCY_KEYS) {
      return yield* Result.fail(deploymentQuerySyncRowCodecError(
        "dependency",
        "limitExceeded",
        "dependency_key",
      ));
    }
    const dependencyKeys: CanonicalDependencyKey[] = [];
    let decodedBytes = 0;
    let previous: CanonicalDependencyKey | undefined;
    for (const input of inputs) {
      const dependency = yield* decodeDeploymentQuerySyncDependencyRowResult(
        input,
      );
      if (
        dependency.role !== expected.role
        || dependency.queryKey !== expected.queryKey
        || dependency.generation !== expected.generation
        || (
          previous !== undefined
          && compareCanonicalBase64Url(previous, dependency.dependencyKey) >= 0
        )
      ) {
        return yield* Result.fail(deploymentQuerySyncRowCodecError(
          "dependency",
          "queryFactsInvalid",
          null,
        ));
      }
      decodedBytes += canonicalBase64UrlDecodedLength(
        dependency.dependencyKey,
      );
      if (decodedBytes > MAX_QUERY_DEPENDENCY_BYTES) {
        return yield* Result.fail(deploymentQuerySyncRowCodecError(
          "dependency",
          "limitExceeded",
          "dependency_key",
        ));
      }
      dependencyKeys.push(dependency.dependencyKey);
      previous = dependency.dependencyKey;
    }
    return Object.freeze({
      queryKey: expected.queryKey,
      generation: expected.generation,
      dependencyKeys: Object.freeze(dependencyKeys),
    });
  });
}
