import { Data } from "effect";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { ValidatorValueIssueV1 } from "flarex-protocol/validator-engine";
import { APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1 } from
  "flarex-protocol/internal/application-revision-syscall-validation-v1";


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
