import type { ApplicationSchemaWritePolicyBinding } from "flarex-protocol/internal/application-schema-binding";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { SessionJournalAttempt } from "../../execution/journal/contracts";

export type ApplicationCommandPolicy = Extract<ApplicationSchemaWritePolicyBinding, { owner: "application-command" }>;
declare const writeBrand: unique symbol;
export interface ApplicationCommandWriteAuthority { readonly [writeBrand]: true }
declare const commitBrand: unique symbol;
export interface ApplicationCommandCommitAuthority { readonly [commitBrand]: true }
type State = Readonly<{ attempt: SessionJournalAttempt; scopeId: ScopeId; policy: ApplicationCommandPolicy }>;
const writers = new WeakMap<object, State>();
const commits = new WeakMap<object, State>();

/** Source-private: only the journal's authenticated ownership capture issues this. */
export function issueApplicationCommandWriteAuthority(attempt: SessionJournalAttempt, scopeId: ScopeId,
  policy: ApplicationCommandPolicy): ApplicationCommandWriteAuthority {
  // SAFETY: the registry, not the empty object's structure, authenticates authority.
  const token = Object.freeze({}) as ApplicationCommandWriteAuthority;
  writers.set(token, Object.freeze({ attempt, scopeId, policy: Object.freeze({ ...policy }) }));
  return token;
}
export function matchesApplicationCommandWriteAuthority(token: ApplicationCommandWriteAuthority,
  attempt: SessionJournalAttempt, scopeId: ScopeId, policy: ApplicationCommandPolicy | undefined): boolean {
  const state = writers.get(token);
  return state !== undefined && state.attempt === attempt && state.scopeId === scopeId && policy !== undefined &&
    state.policy.tableId === policy.tableId && state.policy.writePolicySha256 === policy.writePolicySha256;
}
export function closeApplicationCommandWriteAuthority(token: ApplicationCommandWriteAuthority): void { writers.delete(token); }
export function applicationCommandWriteTable(token: ApplicationCommandWriteAuthority,
  attempt: SessionJournalAttempt, scopeId: ScopeId): CatalogTableId | undefined {
  const state = writers.get(token);
  return state?.attempt === attempt && state.scopeId === scopeId ? state.policy.tableId : undefined;
}

/** Only the closed-root issuer may convert a live writer into settlement evidence. */
export function freezeApplicationCommandWriteAuthority(token: ApplicationCommandWriteAuthority,
  attempt: SessionJournalAttempt): ApplicationCommandCommitAuthority | undefined {
  const state = writers.get(token);
  if (state?.attempt !== attempt) return undefined;
  writers.delete(token);
  // SAFETY: the closed-root issuer retains the genuine registry-backed handle.
  const commit = Object.freeze({}) as ApplicationCommandCommitAuthority;
  commits.set(commit, state);
  return commit;
}

export function admittedApplicationCommandCommitTable(token: ApplicationCommandCommitAuthority,
  attempt: SessionJournalAttempt, scopeId: ScopeId,
  policies: readonly ApplicationSchemaWritePolicyBinding[]): CatalogTableId | undefined {
  const state = commits.get(token);
  return state?.attempt === attempt && state.scopeId === scopeId && policies.some(policy =>
    policy.owner === "application-command" && policy.tableId === state.policy.tableId &&
    policy.writePolicySha256 === state.policy.writePolicySha256) ? state.policy.tableId : undefined;
}
