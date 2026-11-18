/** Private, bounded request census. It is not a second durable outcome owner. */
import { Result } from "effect";
import { CoreTransactionError, type CoreRequestIdentity } from "./api";
import { sameCoreNativeIdentity } from "./nativePolicy";

export interface CoreRecoveryEnrollment { readonly identity: CoreRequestIdentity }

function sameCorrelation(left: CoreRequestIdentity, right: CoreRequestIdentity): boolean {
  if (left.key !== right.key || left.requestHash !== right.requestHash) return false;
  if (left.kind === "nativeRoot") return right.kind === "nativeRoot" && left.root.definitionHash === right.root.definitionHash;
  if (left.kind === "native") return right.kind === "native" && left.native.name === right.native.name
    && left.native.mode === right.native.mode && sameCoreNativeIdentity(left.native.source, right.native.source);
  return right.kind !== "native" && right.kind !== "nativeRoot" && left.program.functionPath === right.program.functionPath;
}

export class CoreRecoveryJournal {
  private readonly requests = new Set<CoreRecoveryEnrollment>();
  private sealed: readonly CoreRequestIdentity[] | undefined;
  constructor(private readonly maximum: number) {}

  enroll(identity: CoreRequestIdentity): Result.Result<CoreRecoveryEnrollment, CoreTransactionError> {
    if (this.sealed !== undefined) return Result.fail(new CoreTransactionError({ reason: "unavailable" }));
    for (const current of this.requests) if (current.identity.key === identity.key && !sameCorrelation(current.identity, identity))
      return Result.fail(new CoreTransactionError({ reason: "requestMismatch" }));
    if (this.requests.size >= this.maximum) return Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Unresolved request census limit" }));
    const enrollment = Object.freeze({ identity });
    this.requests.add(enrollment);
    return Result.succeed(enrollment);
  }

  complete(enrollment: CoreRecoveryEnrollment | undefined): void { if (enrollment !== undefined) this.requests.delete(enrollment); }

  seal(): readonly CoreRequestIdentity[] {
    this.sealed ??= Object.freeze([...new Map([...this.requests].map(value => [value.identity.key, value.identity])).values()]);
    return this.sealed;
  }
}
