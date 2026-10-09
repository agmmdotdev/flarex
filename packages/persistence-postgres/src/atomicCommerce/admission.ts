import { Cause, Effect, Option } from "effect";
import { withCommerceInstallationAdmissions, type CommerceAdmission } from "../commerceTransaction/admission";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import { commerceBindings, bindingInstallationReference } from "../frameworkSchema/binding/model";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import type { FrameworkSchemaTarget } from "../frameworkSchema/target";
import type { ApplicationBindingInput, ApplicationBindingObservation } from "../applicationActivation";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import type { prepareAtomicCommerceParticipants } from "./participants";
import { requireLogicalCommerceInitialization } from "../commerceTransaction/logicalInitialization";

type AtomicMembers = Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>;
export type AtomicCommerceAdmission = Readonly<{ kind: "physical"; admission: CommerceAdmission }> |
  Readonly<{ kind: "logical"; admission: LogicalRelationalAdmission }>;

/** The scope clock is already locked by the existing request owner. Members are
 * captured in installation lock order and remain live through root publication. */
export const withAtomicCommerceAdmissions = Effect.fn("AtomicCommerce.withAdmissions")(function* <Value>(
  members: AtomicMembers, target: FrameworkSchemaTarget,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  work: (admissions: readonly AtomicCommerceAdmission[]) => Effect.Effect<Value, CommerceTransactionError>,
  observation?: ApplicationBindingObservation,
): Effect.fn.Return<Value, CommerceTransactionError> {
  const current = yield* readBindingHead(tx, authority, "none").pipe(Effect.mapError(projectCommerceRequestFailure));
  if (Option.isNone(current)) return yield* Effect.fail(commerceError("bindingChanged"));
  const candidate = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256).pipe(Effect.mapError(projectCommerceRequestFailure));
  if (Option.isNone(candidate)) return yield* Effect.fail(commerceError("storedCorruption"));
  const bindings = commerceBindings(candidate.value.frame);
  // Only explicitly selected installations gain authority. Per-member admission
  // below retains full active-head evidence and checks profiles and placement.
  if (members.some(member => member.kind === "physical" && !bindings.some(binding => {
    const reference = bindingInstallationReference(binding);
    return sameBindingValue(reference, member.reference);
  }))) return yield* Effect.fail(commerceError("bindingChanged"));
  const visit = Effect.fn("AtomicCommerce.admitNext")(function* (
    index: number, admitted: readonly AtomicCommerceAdmission[], logicalTables: ReadonlySet<CatalogTableId>,
    currentObservation?: ApplicationBindingObservation,
  ): Effect.fn.Return<Value, CommerceTransactionError> {
    const member = members[index];
    if (member === undefined) return yield* work(admitted);
    if (member.kind === "logical") return yield* member.prepared.withAdmission(selection, tx, authority, clock,
      (admission, accepted) => Effect.gen(function* () {
        const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
        if (state.tables.some(table => logicalTables.has(table.tableId)))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        yield* requireLogicalCommerceInitialization(admission, tx, member.descriptor.initialization);
        return yield* visit(index + 1, [...admitted, { kind: "logical", admission }],
          new Set([...logicalTables, ...state.tables.map(table => table.tableId)]), accepted);
      }), currentObservation).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
    const group = [member];
    let next = index + 1;
    while (true) {
      const following = members[next];
      if (following === undefined || following.kind !== "physical" || following.reference.installation.installationSha256 !== member.reference.installation.installationSha256) break;
      if (following === undefined || following.kind !== "physical" || !sameBindingValue(following.reference, member.reference) || following.prepared !== member.prepared)
        return yield* Effect.fail(commerceError("invalidAuthority"));
      group.push(following);
      next++;
    }
    return yield* withCommerceInstallationAdmissions(group.map(value => value.profile), target, member.reference, selection, tx, authority, clock, false, member.prepared,
      (admissions, accepted) => visit(next, [...admitted, ...admissions.map(admission => ({ kind: "physical" as const, admission }))], logicalTables, accepted), currentObservation).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCommerceRequestFailure))));
  });
  return yield* visit(0, [], new Set(), observation);
});
