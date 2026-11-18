import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Brand, Effect, Result } from "effect";
import type { JsonObject } from "flarex-protocol/json";

import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import { FrameworkMigrationValueError } from "./errors";
import type {
  FrameworkSchemaTargetNamespaceSha256,
  PhysicalDatabaseIdentity,
  PhysicalSchemaName,
} from "./identity";

export const FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT =
  "flarex.framework-schema-target-namespace";
export const FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION = 1;
export const MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES = 4_096;

const MAX_TARGET_IDENTITY_UTF8_BYTES = 512;
const MAX_POSTGRES_IDENTIFIER_UTF8_BYTES = 63;
const UTF8 = new TextEncoder();
const brandDatabaseIdentity = Brand.nominal<PhysicalDatabaseIdentity>();
const brandSchemaName = Brand.nominal<PhysicalSchemaName>();
const brandTargetNamespaceSha256 =
  Brand.nominal<FrameworkSchemaTargetNamespaceSha256>();

export type FrameworkSchemaTargetNamespaceFrame = Readonly<{
  readonly format: typeof FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION;
  readonly deploymentId: string;
  readonly physicalDatabaseIdentity: PhysicalDatabaseIdentity;
  readonly schemaName: PhysicalSchemaName;
}> & JsonObject;

export interface FrameworkSchemaTargetNamespace {
  readonly frame: FrameworkSchemaTargetNamespaceFrame;
  readonly targetNamespaceSha256: FrameworkSchemaTargetNamespaceSha256;
  readonly canonicalJson: string;
}

export interface FrameworkSchemaTargetNamespaceInput {
  readonly deploymentId: unknown;
  readonly physicalDatabaseIdentity: unknown;
  readonly schemaName: unknown;
}

export function normalizeFrameworkSchemaTargetNamespaceFrame(
  input: unknown,
): Result.Result<
  FrameworkSchemaTargetNamespaceFrame,
  FrameworkMigrationValueError
> {
  return Result.gen(function* () {
    const fields = yield* exactRecord(input, [
      "deploymentId",
      "physicalDatabaseIdentity",
      "schemaName",
    ]);
    const deploymentId = yield* identityText(
      fields.at(0),
      MAX_TARGET_IDENTITY_UTF8_BYTES,
    );
    const physicalDatabaseIdentity = brandDatabaseIdentity(yield* identityText(
      fields.at(1),
      MAX_TARGET_IDENTITY_UTF8_BYTES,
    ));
    const schemaName = brandSchemaName(yield* identityText(
      fields.at(2),
      MAX_POSTGRES_IDENTIFIER_UTF8_BYTES,
    ));
    return Object.freeze({
      format: FRAMEWORK_SCHEMA_TARGET_NAMESPACE_FORMAT,
      version: FRAMEWORK_SCHEMA_TARGET_NAMESPACE_VERSION,
      deploymentId,
      physicalDatabaseIdentity,
      schemaName,
    } satisfies FrameworkSchemaTargetNamespaceFrame);
  });
}

export const captureFrameworkSchemaTargetNamespace = Effect.fn(
  "FrameworkSchemaTargetNamespace.capture",
)(function* (
  input: FrameworkSchemaTargetNamespaceInput,
): Effect.fn.Return<
  FrameworkSchemaTargetNamespace,
  FrameworkMigrationValueError
> {
  const frame = yield* Effect.fromResult(
    normalizeFrameworkSchemaTargetNamespaceFrame(input),
  );
  const captured = yield* capturePrivateCanonicalValue(
    frame,
    MAX_FRAMEWORK_SCHEMA_TARGET_NAMESPACE_CANONICAL_BYTES,
    {
      invalidInput: () => FrameworkMigrationValueError.invalidInput(
        "captureTargetNamespace",
      ),
      hashFailure: cause => FrameworkMigrationValueError.resourceFailure(
        "captureTargetNamespace",
        cause,
      ),
    },
  );
  return Object.freeze({
    frame,
    targetNamespaceSha256: brandTargetNamespaceSha256(captured.sha256Hex),
    canonicalJson: captured.canonicalJson,
  });
});

export function frameworkSchemaTargetNamespacesEqual(
  left: FrameworkSchemaTargetNamespace,
  right: FrameworkSchemaTargetNamespace,
): boolean {
  return left.targetNamespaceSha256 === right.targetNamespaceSha256 &&
    left.canonicalJson === right.canonicalJson;
}

function identityText(
  input: unknown,
  maximumUtf8Bytes: number,
): Result.Result<string, FrameworkMigrationValueError> {
  return isNonBlankString(input) &&
      !input.includes("\0") &&
      isWellFormedUtf16(input) &&
      UTF8.encode(input).byteLength <= maximumUtf8Bytes
    ? Result.succeed(input)
    : Result.fail(FrameworkMigrationValueError.invalidInput(
      "captureTargetNamespace",
    ));
}

function exactRecord(
  input: unknown,
  keys: readonly string[],
): Result.Result<readonly unknown[], FrameworkMigrationValueError> {
  try {
    if (!isNonArrayRecord(input)) {
      return Result.fail(FrameworkMigrationValueError.invalidInput(
        "captureTargetNamespace",
      ));
    }
    const prototype = Object.getPrototypeOf(input);
    const ownKeys = Reflect.ownKeys(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
    ) {
      return Result.fail(FrameworkMigrationValueError.invalidInput(
        "captureTargetNamespace",
      ));
    }
    const values: unknown[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail(FrameworkMigrationValueError.invalidInput(
          "captureTargetNamespace",
        ));
      }
      values.push(descriptor.value);
    }
    return Result.succeed(Object.freeze(values));
  } catch {
    return Result.fail(FrameworkMigrationValueError.invalidInput(
      "captureTargetNamespace",
    ));
  }
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
