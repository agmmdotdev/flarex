import { Data, Effect, Result, Scope } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import {
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";
import {
  validateValidatorValueV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

import type { AppRowTransaction } from "./appRows";
import {
  ApplicationRevisionActivationCorruptionV1Error,
  ApplicationRevisionActivationIntegrationV1Error,
  ApplicationRevisionActivationStaleV1Error,
  InvalidActiveApplicationRevisionSelectionV1Error,
  validateActiveApplicationRevisionSelectionInTransactionV1,
} from "./applicationRevisionActivationV1";
import type { ScopeClockRecord } from "./scopeClock";
import {
  issueApplicationRevisionSyscallValidatorStateV1,
  readApplicationRevisionSyscallValidatorStateV1,
  revokeApplicationRevisionSyscallValidatorStateV1,
  setupSeededSyscallValidatorStateV1,
  type ApplicationRevisionSyscallValidatorV1,
} from "./applicationRevisionSyscallValidatorStateV1";
export type { ApplicationRevisionSyscallValidatorV1 } from
  "./applicationRevisionSyscallValidatorStateV1";

export type ApplicationRevisionSyscallValidationOperationV1 =
  | "insert"
  | "patch"
  | "replace";

export type ApplicationRevisionSyscallDocumentValidationIssueV1 =
  | Readonly<{
      readonly reason: "unexpectedSystemField";
      readonly field: string;
    }>
  | Readonly<{
      readonly reason: "validator";
      readonly issue: ValidatorValueIssueV1;
    }>;

/** The only C03-V failure intentionally returned to user code. */
export class ApplicationRevisionSyscallDocumentValidationV1Error
  extends Data.TaggedError(
    APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
  )<{
    readonly operation: ApplicationRevisionSyscallValidationOperationV1;
    readonly tableName: string;
    readonly documentId: AppDocumentIdV1;
    readonly issue: ApplicationRevisionSyscallDocumentValidationIssueV1;
    readonly message:
      typeof APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1;
  }> {}

export class InvalidApplicationRevisionSyscallValidatorV1Error
  extends Data.TaggedError(
    "InvalidApplicationRevisionSyscallValidatorV1Error",
  )<{
    readonly reason: "notIssued";
  }> {}

export class ApplicationRevisionSyscallValidatorStaleV1Error
  extends Data.TaggedError(
    "ApplicationRevisionSyscallValidatorStaleV1Error",
  )<{
    readonly reason: "scopeAuthority" | "activeHead" | "sessionPins";
  }> {}

export class ApplicationRevisionSyscallValidatorCorruptionV1Error
  extends Data.TaggedError(
    "ApplicationRevisionSyscallValidatorCorruptionV1Error",
  )<{
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class ApplicationRevisionSyscallValidatorIntegrationV1Error
  extends Data.TaggedError(
    "ApplicationRevisionSyscallValidatorIntegrationV1Error",
  )<{
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export type ApplicationRevisionSyscallValidatorV1Error =
  | InvalidApplicationRevisionSyscallValidatorV1Error
  | ApplicationRevisionSyscallValidatorStaleV1Error
  | ApplicationRevisionSyscallValidatorCorruptionV1Error
  | ApplicationRevisionSyscallValidatorIntegrationV1Error
  | ApplicationRevisionSyscallDocumentValidationV1Error;

/**
 * Application-generation adapter over the retained journal validator
 * capability. Its authority is the immutable session-pinned schema, not the
 * mutable active head after admission.
 */
export const deriveApplicationSyscallValidator = Effect.fn(
  "ApplicationSyscallValidator.derive",
)(function* (input: Readonly<{
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}>): Effect.fn.Return<
  ApplicationRevisionSyscallValidatorV1,
  never,
  Scope.Scope
> {
  const state = setupSeededSyscallValidatorStateV1(input);
  return yield* Effect.acquireRelease(
    Effect.sync(() => issueApplicationRevisionSyscallValidatorStateV1(state)),
    capability => Effect.sync(() => {
      revokeApplicationRevisionSyscallValidatorStateV1(capability);
    }),
  );
});

export interface ValidateApplicationRevisionSyscallDocumentV1Input {
  readonly operation: ApplicationRevisionSyscallValidationOperationV1;
  readonly tableName: string;
  readonly tableId: CatalogTableId;
  readonly documentId: AppDocumentIdV1;
  readonly creationTime: AppCreationTimeV1;
  readonly document: CanonicalFlarexValueV1;
}

export interface ApplicationRevisionSyscallValidationContextV1 {
  readonly anchor: Readonly<{ readonly scopeId: ScopeId }>;
  readonly executionPin: Readonly<{
    readonly schemaVersionId: CatalogSchemaVersionId;
  }>;
  readonly scopeClock: ScopeClockRecord;
}

/** Package-private C03 operation; callers retain the transaction owner. */
export const validateApplicationRevisionSyscallDocumentInTransactionV1 =
  Effect.fn("ApplicationRevisionSyscallValidator.validateDocument")(
    function* (
      capability: ApplicationRevisionSyscallValidatorV1,
      tx: AppRowTransaction,
      context: ApplicationRevisionSyscallValidationContextV1,
      input: ValidateApplicationRevisionSyscallDocumentV1Input,
    ): Effect.fn.Return<void, ApplicationRevisionSyscallValidatorV1Error> {
      const captured = yield* Effect.fromResult(
        readApplicationRevisionSyscallValidatorStateV1(capability).pipe(
          Result.mapError(() =>
            new InvalidApplicationRevisionSyscallValidatorV1Error({
              reason: "notIssued",
            })
          ),
        ),
      );
      if (
        (captured.scopeId !== null &&
          captured.scopeId !== context.anchor.scopeId) ||
        (captured.schemaVersionId !== null &&
          captured.schemaVersionId !== context.executionPin.schemaVersionId)
      ) {
        return yield* new ApplicationRevisionSyscallValidatorStaleV1Error({
          reason: "sessionPins",
        });
      }
      if (captured.kind === "activationFenced") {
        yield* validateActiveApplicationRevisionSelectionInTransactionV1(
          captured.selection,
          tx,
          context.scopeClock,
        ).pipe(Effect.mapError(mapActiveSelectionFailure));
      }
      const tables = captured.tablesByName;
      const idPolicy = captured.idPolicy;
      if (tables === null || idPolicy === null) return;

      const table = tables.get(input.tableName);
      if (table === undefined || table.tableId !== input.tableId) {
        return yield* new ApplicationRevisionSyscallValidatorCorruptionV1Error({
          detail: "the journal table is absent from the active schema snapshot",
        });
      }
      const developerFields = yield* Effect.fromResult(
        projectDeveloperFields(input),
      );
      yield* Effect.fromResult(validateValidatorValueV1(
        table.documentType,
        developerFields,
        { path: "$document", idPolicy },
      )).pipe(Effect.mapError(error =>
        new ApplicationRevisionSyscallDocumentValidationV1Error({
          operation: input.operation,
          tableName: input.tableName,
          documentId: input.documentId,
          issue: { reason: "validator", issue: error.issue },
          message:
            APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
        })
      ));
    },
  );

export function inspectApplicationRevisionSyscallValidatorV1(
  capability: unknown,
): Result.Result<void, InvalidApplicationRevisionSyscallValidatorV1Error> {
  return readApplicationRevisionSyscallValidatorStateV1(capability).pipe(
    Result.mapError(() =>
      new InvalidApplicationRevisionSyscallValidatorV1Error({
        reason: "notIssued",
      })
    ),
    Result.map(() => undefined),
  );
}

function projectDeveloperFields(
  input: ValidateApplicationRevisionSyscallDocumentV1Input,
): Result.Result<
  CanonicalFlarexRuntimeObjectV1,
  | ApplicationRevisionSyscallValidatorCorruptionV1Error
  | ApplicationRevisionSyscallDocumentValidationV1Error
> {
  const value = input.document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(value)) {
    return Result.fail(new ApplicationRevisionSyscallValidatorCorruptionV1Error({
      detail: "the resulting journal document is not an object",
    }));
  }
  if (value._id !== input.documentId) {
    return Result.fail(new ApplicationRevisionSyscallValidatorCorruptionV1Error({
      detail: "the resulting journal document identity changed",
    }));
  }
  if (value._creationTime !== input.creationTime) {
    return Result.fail(new ApplicationRevisionSyscallValidatorCorruptionV1Error({
      detail: "the resulting journal document creation time changed",
    }));
  }
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    if (field.startsWith("_")) {
      return Result.fail(
        new ApplicationRevisionSyscallDocumentValidationV1Error({
          operation: input.operation,
          tableName: input.tableName,
          documentId: input.documentId,
          issue: { reason: "unexpectedSystemField", field },
          message:
            APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
        }),
      );
    }
    Object.defineProperty(fields, field, {
      value: item,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Result.succeed(Object.freeze(fields));
}

function mapActiveSelectionFailure(
  error:
    | InvalidActiveApplicationRevisionSelectionV1Error
    | ApplicationRevisionActivationStaleV1Error
    | ApplicationRevisionActivationCorruptionV1Error
    | ApplicationRevisionActivationIntegrationV1Error,
): ApplicationRevisionSyscallValidatorV1Error {
  if (error instanceof InvalidActiveApplicationRevisionSelectionV1Error) {
    return new InvalidApplicationRevisionSyscallValidatorV1Error({
      reason: "notIssued",
    });
  }
  if (error instanceof ApplicationRevisionActivationStaleV1Error) {
    return new ApplicationRevisionSyscallValidatorStaleV1Error({
      reason: error.reason === "scopeAuthority" ? "scopeAuthority" : "activeHead",
    });
  }
  if (error instanceof ApplicationRevisionActivationCorruptionV1Error) {
    return new ApplicationRevisionSyscallValidatorCorruptionV1Error({
      detail: error.detail,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
  return new ApplicationRevisionSyscallValidatorIntegrationV1Error({
    retryable: error.retryable,
    cause: error.cause,
  });
}
