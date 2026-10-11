import { observeExecution } from "../../execution/diagnostics/operation";
import { Cause, Effect, Option } from "effect";
import {
  withCommerceInstallationAdmissions,
  type CommerceAdmission,
} from "../commerceTransaction/admission";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import { projectCommerceRequestFailure } from "../commerceTransaction/request";
import {
  commerceBindings,
  bindingInstallationReference,
} from "../../installation/frameworkSchema/binding/model";
import {
  readBindingCandidate,
  readBindingHead,
} from "../../installation/frameworkSchema/binding/repository";
import { sameBindingValue } from "../../installation/frameworkSchema/binding/canonical";
import type { FrameworkSchemaTarget } from "../../installation/frameworkSchema/target";
import type {
  ApplicationBindingInput,
  ApplicationBindingObservation,
} from "../../application/activation/contracts";
import { invalidateAcceptedApplicationBindingInTransaction } from "../../application/activation/acceptedBinding";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  requireLogicalRelationalAdmission,
  type LogicalRelationalAdmission,
} from "../../storage/documents/logicalDocuments/relationalAdmission";
import type { prepareAtomicCommerceParticipants } from "./participants";
import { withLogicalCommerceInitializationReceipts } from "../commerceTransaction/logicalInitialization";
import {
  withSharedLogicalSourceBindingChecks,
  closeSharedLogicalSourceBindingLending,
} from "../../storage/documents/logicalDocuments/sourceAdmission";

type AtomicMembers = Effect.Success<ReturnType<typeof prepareAtomicCommerceParticipants>>;
export type AtomicCommerceAdmission = Readonly<{ kind: "physical"; admission: CommerceAdmission }> |
  Readonly<{ kind: "logical"; admission: LogicalRelationalAdmission }>;

/** The scope clock is already locked by the existing request owner. Members are
 * captured in installation lock order and remain live through root publication. */
export const withAtomicCommerceAdmissions = Effect.fnUntraced(function* <Value>(
  members: AtomicMembers, target: FrameworkSchemaTarget,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  work: (admissions: readonly AtomicCommerceAdmission[]) => Effect.Effect<Value, CommerceTransactionError>,
  observation?: ApplicationBindingObservation,
): Effect.fn.Return<Value, CommerceTransactionError> {
  const first = members[0];
  const allLogical = first?.kind === "logical" && members.every(member => member.kind === "logical");
  const prelude = yield* (allLogical
    ? first.prepared.readBindingPrelude(selection, tx, authority)
    : Effect.gen(function* () {
      const head = yield* readBindingHead(tx, authority, "none");
      const candidate = Option.isNone(head) ? Option.none() :
        yield* readBindingCandidate(tx, authority, head.value.frame.candidateSha256);
      return { head, candidate };
    })).pipe(Effect.mapError(projectCommerceRequestFailure));
  if (Option.isNone(prelude.head)) return yield* Effect.fail(commerceError("bindingChanged"));
  if (Option.isNone(prelude.candidate)) return yield* Effect.fail(commerceError("storedCorruption"));
  const bindings = allLogical ? [] : commerceBindings(prelude.candidate.value.frame);
  // Only explicitly selected installations gain authority. Per-member admission
  // below retains full active-head evidence and checks profiles and placement.
  if (members.some(member => member.kind === "physical" && !bindings.some(binding => {
    const reference = bindingInstallationReference(binding);
    return sameBindingValue(reference, member.reference);
  }))) return yield* Effect.fail(commerceError("bindingChanged"));
  return yield* withLogicalCommerceInitializationReceipts(tx, authority,
    members.flatMap(member => member.kind === "logical" ? [{ sourceKey: member.sourceKey,
      initialization: member.descriptor.initialization }] : []), requireInitialization => Effect.gen(function* () {
      const visit = Effect.fnUntraced(function* (
        index: number, admitted: readonly AtomicCommerceAdmission[], logicalTables: ReadonlySet<CatalogTableId>,
        currentObservation?: ApplicationBindingObservation,
      ): Effect.fn.Return<Value, CommerceTransactionError> {
        const member = members[index];
        if (member === undefined) {
          closeSharedLogicalSourceBindingLending(tx);
          invalidateAcceptedApplicationBindingInTransaction(tx);
          return yield* work(admitted);
        }
        if (member.kind === "logical") return yield* member.prepared.withAdmission(selection, tx, authority, clock,
          (admission, accepted) => Effect.gen(function* () {
            const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
            if (state.tables.some(table => logicalTables.has(table.tableId)))
              return yield* Effect.fail(commerceError("unsupportedProfile"));
            yield* requireInitialization(admission, member.descriptor.initialization);
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
      }, effect => observeExecution("AtomicCommerce.admitNext", effect, "caller"));
      return yield* withSharedLogicalSourceBindingChecks(tx, () => visit(0, [], new Set(), observation),
        members.flatMap(member => member.kind === "logical" ? [member.sourceKey] : []));
    }));
}, effect => observeExecution("AtomicCommerce.withAdmissions", effect, "caller"));
