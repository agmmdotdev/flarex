import { Cause, Effect, Option } from "effect";
import { withCommerceInstallationAdmissions, type CommerceAdmission } from "../commerceTransaction/admission";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { commerceBindings, bindingInstallationReference, type InstallationBindingReference } from "../frameworkSchema/binding/model";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import type { PreparedInstallationRuntime } from "../frameworkSchema/installation/runtime";
import type { CommerceProfile } from "../commerceTransaction/profile";
import type { FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import type { ApplicationBindingInput } from "../applicationActivation";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";

export interface AtomicCommerceInstallation {
  readonly profile: CommerceProfile;
  readonly reference: InstallationBindingReference;
  readonly prepared: PreparedInstallationRuntime;
}

/** The scope clock is already locked by the existing request owner. Members are
 * captured in installation lock order and remain live through root publication. */
export const withAtomicCommerceAdmissions = Effect.fn("AtomicCommerce.withAdmissions")(function* <Value>(
  members: readonly AtomicCommerceInstallation[], target: FrameworkMigrationTarget,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  work: (admissions: readonly CommerceAdmission[]) => Effect.Effect<Value, CommerceTransactionError>,
): Effect.fn.Return<Value, CommerceTransactionError> {
  const current = yield* readBindingHead(tx, authority, false).pipe(Effect.mapError(projectCommerceRequestFailure));
  if (Option.isNone(current)) return yield* Effect.fail(commerceError("bindingChanged"));
  const candidate = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256).pipe(Effect.mapError(projectCommerceRequestFailure));
  if (Option.isNone(candidate)) return yield* Effect.fail(commerceError("storedCorruption"));
  const bindings = commerceBindings(candidate.value.frame);
  // Only explicitly selected installations gain authority. Per-member admission
  // below retains full active-head evidence and checks profiles and placement.
  if (members.some(member => !bindings.some(binding => {
    const reference = bindingInstallationReference(binding);
    return sameBindingValue(reference, member.reference);
  }))) return yield* Effect.fail(commerceError("bindingChanged"));
  const visit = Effect.fn("AtomicCommerce.admitNext")(function* (
    index: number, admitted: readonly CommerceAdmission[],
  ): Effect.fn.Return<Value, CommerceTransactionError> {
    const member = members[index];
    if (member === undefined) return yield* work(admitted);
    const group = [member];
    let next = index + 1;
    while (members[next]?.reference.installation.installationSha256 === member.reference.installation.installationSha256) {
      const following = members[next];
      if (following === undefined || !sameBindingValue(following.reference, member.reference) || following.prepared !== member.prepared)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      group.push(following);
      next++;
    }
    return yield* withCommerceInstallationAdmissions(group.map(value => value.profile), target, member.reference, selection, tx, authority, clock, false, member.prepared,
      admissions => visit(next, [...admitted, ...admissions])).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  });
  return yield* visit(0, []);
});
