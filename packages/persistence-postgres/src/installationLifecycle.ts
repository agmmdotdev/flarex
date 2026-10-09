import { sql, getTableName, type SQL } from "drizzle-orm";
import { scopeExecutionAuthorityInstallationSql } from "./scopeExecutionAuthorityInstallation";
import { FINITE_PUBLICATION_FUNCTIONS } from "./finitePublicationInstallation";
import { APPLICATION_DOMAIN_FUNCTIONS, APPLICATION_DOMAIN_TYPES } from "./applicationDocumentMaterialization/domainInstallation";
import { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS, INDEX_MAINTENANCE_BUILD_PERMISSIONS,
  INDEX_MAINTENANCE_OBLIGATION_TABLES, indexMaintenanceInstallationSql } from "./indexMaintenanceInstallation";
import { Data, Effect, Result, Schema } from "effect";
import { getTableConfig } from "drizzle-orm/pg-core";
import { fxSystemTransactionJournalPoints, transactionJournalPointDependencyCheck } from "./schema";
import { runEffectTransactionSettlement } from "./effectTransaction";
import { protectedMetadataHasNoInheritanceSql } from "./protectedMetadataProtection";

import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";

export class InstallationLifecycleError extends Data.TaggedError("InstallationLifecycleError")<{
  readonly reason: "invalidInstallation" | "inactive" | "changed" | "busy" | "resourceFailure" | "invalidCapability";
  readonly cause?: unknown;
}> {}
const issue = (reason: InstallationLifecycleError["reason"], cause?: unknown) =>
  new InstallationLifecycleError({ reason, ...(cause === undefined ? {} : { cause }) });
const positiveIntegerText = Schema.String.check(Schema.makeFilter(value =>
  /^[1-9][0-9]*$/.test(value) ? undefined : "Expected positive integer text"));
const uuid = Schema.String.check(Schema.isUUID());
const identitySchema = Schema.Struct({
  databaseName: Schema.NonEmptyString,
  schemaName: Schema.NonEmptyString,
  namespaceOid: positiveIntegerText,
  incarnation: uuid,
  structuralGeneration: positiveIntegerText,
  login: Schema.NonEmptyString,
  sameLogin: Schema.Boolean,
  actualDatabase: Schema.NonEmptyString,
  sameSchema: Schema.Boolean,
});
const decodeIdentityRows = Schema.decodeUnknownEffect(Schema.Tuple([identitySchema]));
export type InstallationIdentity = typeof identitySchema.Type;
declare const preparedInstallationBrand: unique symbol;
export interface PreparedInstallation { readonly [preparedInstallationBrand]: true }
export type InstallationAccessProfile = "dataRuntime" | "controlRead" | "activationWriter";
interface PreparedState {
  readonly database: FlarexMetadataDatabase;
  readonly identity: InstallationIdentity;
  readonly endpointPolicy: string;
  readonly metadataIncarnation: string;
  readonly accessProfile: InstallationAccessProfile;
}
const preparations = new WeakMap<object, PreparedState>();
const admissions = new WeakMap<object, Map<string, Readonly<{ identity: InstallationIdentity; database?: FlarexMetadataDatabase }>>>();
declare const coLocatedReadInstallationBrand: unique symbol;
export interface PreparedCoLocatedReadInstallation { readonly [coLocatedReadInstallationBrand]: true }
interface CoLocatedState {
  readonly database: FlarexMetadataDatabase;
  readonly target: PreparedInstallation;
  readonly control: PreparedInstallation;
}
const coLocatedPreparations = new WeakMap<object, CoLocatedState>();
const coLocatedAdmissions = new WeakMap<object, CoLocatedState>();
declare const activationServingInstallationBrand: unique symbol;
export interface PreparedActivationServingInstallation { readonly [activationServingInstallationBrand]: true }
type InstallationReference = Readonly<{ database: FlarexMetadataDatabase; installation: PreparedInstallation }>;
type ActivationServingInstallationReferences = Readonly<{
  serving: InstallationReference;
  activation: InstallationReference;
}>;
const activationServingPreparations = new WeakMap<object, ActivationServingInstallationReferences>();

/** A compact load of an installer-published runtime policy, not catalog verification. */
export const loadManagedInstallation = Effect.fn("InstallationLifecycle.loadManaged")(
  function* (database: FlarexMetadataDatabase, endpointPolicy: string, schemaName: string,
    accessProfile: InstallationAccessProfile = "dataRuntime") {
    const rows = yield* query(() => database.select({
      databaseName: sql<string>`i.database_name`, schemaName: sql<string>`i.schema_name`,
      namespaceOid: sql<string>`i.namespace_oid::text`, incarnation: sql<string>`i.incarnation::text`,
      structuralGeneration: sql<string>`i.structural_generation::text`, login: sql<string>`session_user`,
      sameLogin: sql<boolean>`current_user = session_user`, actualDatabase: sql<string>`current_database()`,
      sameSchema: sql<boolean>`current_schema() = i.schema_name`,
      metadataIncarnation: sql<string>`p.metadata_incarnation::text`,
    }).from(sql`${sql.identifier(schemaName)}.fx_system_installation i
      inner join ${sql.identifier(schemaName)}.fx_system_installation_runtime p
      on p.login = session_user and p.login_oid = session_user::pg_catalog.regrole::oid::bigint
      and p.incarnation = i.incarnation and p.structural_generation = i.structural_generation
      and p.endpoint_policy = ${endpointPolicy}
      and p.access_profile = ${accessProfile}
      where i.singleton_id = 1 and i.state = 'active'
        and i.schema_name = ${schemaName}
        and i.namespace_oid = ${schemaName}::pg_catalog.regnamespace::oid::bigint`).limit(2));
    const [identity] = yield* decodeIdentityRows(rows).pipe(
      Effect.mapError(cause => issue("invalidInstallation", cause)));
    if (!identity.sameLogin || !identity.sameSchema || identity.databaseName !== identity.actualDatabase)
      return yield* Effect.fail(issue("invalidInstallation"));
    const metadataIncarnation = yield* Schema.decodeUnknownEffect(uuid)(rows[0]?.metadataIncarnation).pipe(
      Effect.mapError(cause => issue("invalidInstallation", cause)));
    // SAFETY: only this registry authenticates the nominal inert capability.
    const token = Object.freeze({}) as PreparedInstallation;
    preparations.set(token, Object.freeze({ database, identity: Object.freeze(identity), endpointPolicy, metadataIncarnation, accessProfile }));
    return token;
  },
);

/** Both independent logins authenticate the same installed identity. Neither a
 * connection label nor another login's preparation can issue this capability. */
export const loadActivationServingInstallation = Effect.fn("InstallationLifecycle.loadActivationServing")(
  function* (input: ActivationServingInstallationReferences) {
    const serving = preparations.get(input.serving.installation);
    const activation = preparations.get(input.activation.installation);
    if (serving === undefined || activation === undefined || serving.database !== input.serving.database ||
      activation.database !== input.activation.database || serving.accessProfile !== "dataRuntime" ||
      activation.accessProfile !== "activationWriter" || serving.database === activation.database ||
      serving.identity.login === activation.identity.login)
      return yield* Effect.fail(issue("invalidCapability"));
    if (serving.identity.databaseName !== activation.identity.databaseName ||
      serving.identity.schemaName !== activation.identity.schemaName ||
      serving.identity.namespaceOid !== activation.identity.namespaceOid ||
      serving.identity.incarnation !== activation.identity.incarnation ||
      serving.identity.structuralGeneration !== activation.identity.structuralGeneration ||
      serving.metadataIncarnation !== activation.metadataIncarnation)
      return yield* Effect.fail(issue("changed"));
    // Issuance is bounded preparation; accepting transactions still enter the
    // actual login's gate afresh. Keep each login's provenance independent.
    for (const state of [serving, activation]) {
      const rows = yield* query(() => state.database.select({
        databaseName: sql<string>`g.database_name`, schemaName: sql<string>`g.schema_name`,
        namespaceOid: sql<string>`g.namespace_oid::text`, incarnation: sql<string>`g.incarnation::text`,
        structuralGeneration: sql<string>`g.structural_generation::text`, login: sql<string>`g.login`,
        sameLogin: sql<boolean>`g.same_login`, actualDatabase: sql<string>`g.actual_database`,
        sameSchema: sql<boolean>`g.same_schema`,
      }).from(sql`${installationGateSource(state)} g`).limit(2));
      const [identity] = yield* decodeIdentityRows(rows).pipe(Effect.mapError(cause => issue("invalidInstallation", cause)));
      if (!sameIdentity(identity, state.identity) || !identity.sameLogin || !identity.sameSchema ||
        identity.databaseName !== identity.actualDatabase)
        return yield* Effect.fail(issue("changed"));
    }
    // SAFETY: only this installation owner authenticates the inert pair.
    const pair = Object.freeze({}) as PreparedActivationServingInstallation;
    activationServingPreparations.set(pair, Object.freeze({
      serving: Object.freeze({ database: input.serving.database, installation: input.serving.installation }),
      activation: Object.freeze({ database: input.activation.database, installation: input.activation.installation }),
    }));
    return pair;
  },
);

/** Construction consumes exact issuer-owned references, never copied tokens. */
export function getActivationServingInstallationReferencesResult(pair: PreparedActivationServingInstallation):
  Result.Result<ActivationServingInstallationReferences, InstallationLifecycleError> {
  const state = activationServingPreparations.get(pair);
  return state === undefined ? Result.fail(issue("invalidCapability")) : Result.succeed(state);
}

/** Colocation is established by both exact installed incarnations observed by
 * the accepting login. Locator strings or equal database names cannot issue it. */
export const loadCoLocatedReadInstallation = Effect.fn("InstallationLifecycle.loadCoLocated")(
  function* (input: Readonly<{ database: FlarexMetadataDatabase; targetInstallation: PreparedInstallation;
    control: Readonly<{ database: FlarexMetadataDatabase; installation: PreparedInstallation }>;
    controlEndpointPolicy: string }>) {
    const target = preparations.get(input.targetInstallation);
    const control = preparations.get(input.control.installation);
    if (target === undefined || control === undefined || target.database !== input.database ||
      control.database !== input.control.database || target.accessProfile !== "dataRuntime" ||
      target.identity.schemaName === control.identity.schemaName)
      return yield* Effect.fail(issue("invalidCapability"));
    const rows = yield* query(() => input.database.select({
      databaseName: sql<string>`i.database_name`, schemaName: sql<string>`i.schema_name`,
      namespaceOid: sql<string>`i.namespace_oid::text`, incarnation: sql<string>`i.incarnation::text`,
      structuralGeneration: sql<string>`i.structural_generation::text`, login: sql<string>`session_user`,
      sameLogin: sql<boolean>`current_user = session_user`, actualDatabase: sql<string>`current_database()`,
      sameSchema: sql<boolean>`i.schema_name = ${control.identity.schemaName}
        and i.namespace_oid = ${control.identity.schemaName}::pg_catalog.regnamespace::oid::bigint`,
      metadataIncarnation: sql<string>`p.metadata_incarnation::text`,
    }).from(sql`${sql.identifier(control.identity.schemaName)}.fx_system_installation i
      join ${sql.identifier(control.identity.schemaName)}.fx_system_installation_runtime p
      on p.login = session_user and p.login_oid = session_user::pg_catalog.regrole::oid::bigint
        and p.incarnation = i.incarnation and p.structural_generation = i.structural_generation
        and p.endpoint_policy = ${input.controlEndpointPolicy} and p.access_profile = 'controlRead'
      where i.singleton_id = 1 and i.state = 'active'`).limit(2));
    const [identity] = yield* decodeIdentityRows(rows).pipe(Effect.mapError(cause => issue("invalidInstallation", cause)));
    const metadataIncarnation = yield* Schema.decodeUnknownEffect(uuid)(rows[0]?.metadataIncarnation).pipe(
      Effect.mapError(cause => issue("invalidInstallation", cause)));
    // Compare source provenance independently from its different preparation login.
    if (!identity.sameLogin || !identity.sameSchema || identity.databaseName !== identity.actualDatabase ||
      identity.databaseName !== control.identity.databaseName || identity.schemaName !== control.identity.schemaName ||
      identity.namespaceOid !== control.identity.namespaceOid || identity.incarnation !== control.identity.incarnation ||
      identity.structuralGeneration !== control.identity.structuralGeneration ||
      metadataIncarnation !== control.metadataIncarnation || identity.login !== target.identity.login)
      return yield* Effect.fail(issue("changed"));
    // The target's qualified policy must still be current at issuance as well.
    const targetRows = yield* query(() => input.database.select({
      databaseName: sql<string>`g.database_name`, schemaName: sql<string>`g.schema_name`,
      namespaceOid: sql<string>`g.namespace_oid::text`, incarnation: sql<string>`g.incarnation::text`,
      structuralGeneration: sql<string>`g.structural_generation::text`, login: sql<string>`g.login`,
      sameLogin: sql<boolean>`g.same_login`, actualDatabase: sql<string>`g.actual_database`,
      sameSchema: sql<boolean>`g.same_schema`,
    }).from(sql`${installationGateSource(target)} g`).limit(2));
    const [targetIdentity] = yield* decodeIdentityRows(targetRows).pipe(Effect.mapError(cause => issue("invalidInstallation", cause)));
    if (!sameIdentity(targetIdentity, target.identity) || !targetIdentity.sameLogin || !targetIdentity.sameSchema)
      return yield* Effect.fail(issue("changed"));
    // SAFETY: these inert capabilities can only be authenticated by this registry.
    const controlToken = Object.freeze({}) as PreparedInstallation;
    preparations.set(controlToken, Object.freeze({ database: input.database, identity: Object.freeze(identity),
      endpointPolicy: input.controlEndpointPolicy, metadataIncarnation, accessProfile: "controlRead" }));
    // SAFETY: only coLocatedPreparations authenticates this inert pair capability.
    const pair = Object.freeze({}) as PreparedCoLocatedReadInstallation;
    coLocatedPreparations.set(pair, Object.freeze({ database: input.database, target: input.targetInstallation, control: controlToken }));
    return pair;
  },
);

function installationGateSource(state: PreparedState): SQL {
  const schema = sql.identifier(state.identity.schemaName);
  return sql`(select i.*, session_user as login, current_user = session_user as same_login,
    current_database() as actual_database,
    i.schema_name = ${state.identity.schemaName} and
      i.namespace_oid = ${state.identity.schemaName}::pg_catalog.regnamespace::oid::bigint as same_schema
    from ${schema}.fx_lock_installation_admission() i join ${schema}.fx_system_installation_runtime p
    on p.login = session_user and p.login_oid = session_user::pg_catalog.regrole::oid::bigint
      and p.incarnation = i.incarnation and p.structural_generation = i.structural_generation
      and p.endpoint_policy = ${state.endpointPolicy} and p.access_profile = ${state.accessProfile}
    where current_user = session_user and session_user = ${state.identity.login}
      and i.database_name = current_database() and i.database_name = ${state.identity.databaseName}
      and i.schema_name = ${state.identity.schemaName}
      and i.namespace_oid = ${state.identity.namespaceOid}::bigint
      and i.namespace_oid = ${state.identity.schemaName}::pg_catalog.regnamespace::oid::bigint
      and i.incarnation = ${state.identity.incarnation}::uuid
      and i.structural_generation = ${state.identity.structuralGeneration}::bigint
      and p.metadata_incarnation = ${state.metadataIncarnation}::uuid)`;
}

/** Immutable expected installation fields are issued only from authenticated preparations. */
function installationFrontierExpected(state: PreparedState, inputSchema: string): SQL {
  return sql`row(${state.identity.databaseName}::text,${state.identity.schemaName}::text,
    ${state.identity.namespaceOid}::bigint,${state.identity.incarnation}::uuid,
    ${state.identity.structuralGeneration}::bigint,${state.identity.login}::text,
    ${state.endpointPolicy}::text,${state.accessProfile}::text,${state.metadataIncarnation}::uuid)
    ::${sql.identifier(inputSchema)}.fx_installation_frontier_expected`;
}

type CoLocatedReadInstallationReferences = Readonly<{
  target: Readonly<{ schemaName: string; gate: SQL; frontierExpected: SQL; localFrontierExpected: SQL }>;
  control: Readonly<{ schemaName: string; gate: SQL; frontierExpected: SQL; localFrontierExpected: SQL }>;
  targetInstallation: PreparedInstallation;
  controlInstallation: PreparedInstallation;
}>;
const coLocatedReferencePlans = new WeakMap<PreparedCoLocatedReadInstallation, CoLocatedReadInstallationReferences>();
export function getCoLocatedReadInstallationReferencesResult(pair: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase): Result.Result<CoLocatedReadInstallationReferences, InstallationLifecycleError> {
    const state = coLocatedPreparations.get(pair);
    if (state === undefined || state.database !== database) return Result.fail(issue("invalidCapability"));
    const target = preparations.get(state.target), control = preparations.get(state.control);
    if (target === undefined || control === undefined) return Result.fail(issue("invalidCapability"));
    const retained = coLocatedReferencePlans.get(pair);
    if (retained !== undefined) return Result.succeed(retained);
    const references = Object.freeze({ target: Object.freeze({ schemaName: target.identity.schemaName, gate: installationGateSource(target),
      frontierExpected: installationFrontierExpected(target, control.identity.schemaName),
      localFrontierExpected: installationFrontierExpected(target, target.identity.schemaName) }),
      control: Object.freeze({ schemaName: control.identity.schemaName, gate: installationGateSource(control),
        frontierExpected: installationFrontierExpected(control, control.identity.schemaName),
        localFrontierExpected: installationFrontierExpected(control, control.identity.schemaName) }),
      targetInstallation: state.target, controlInstallation: state.control });
    coLocatedReferencePlans.set(pair, references);
    return Result.succeed(references);
}

const acceptedInstallationFrontierSchema = Schema.Struct({ reason: Schema.Literal("accepted"),
  targetMetadataGeneration: positiveIntegerText, controlMetadataGeneration: positiveIntegerText });
const decodeAcceptedInstallationFrontier = Schema.decodeUnknownEffect(acceptedInstallationFrontierSchema);

/** The installed scalar statement checked every expected identity and both live
 * policies under actual installation latches. Only its accepted result for the
 * genuine pair records transaction admission; expected fields alone never do. */
export const acceptCoLocatedInstallationFrontier = Effect.fn("InstallationLifecycle.acceptCoLocatedFrontier")(
  function* (pair: PreparedCoLocatedReadInstallation, database: FlarexMetadataDatabase,
    tx: FlarexMetadataTransaction, raw: unknown) {
    const state = coLocatedPreparations.get(pair);
    if (state === undefined || state.database !== database) return yield* Effect.fail(issue("invalidCapability"));
    const target = preparations.get(state.target), control = preparations.get(state.control);
    if (target === undefined || control === undefined) return yield* Effect.fail(issue("invalidCapability"));
    const accepted = yield* decodeAcceptedInstallationFrontier(raw).pipe(
      Effect.mapError(cause => issue("invalidInstallation", cause)));
    const entries = admissions.get(tx) ?? new Map();
    entries.set(target.identity.schemaName, Object.freeze({ database, identity: target.identity }));
    entries.set(control.identity.schemaName, Object.freeze({ database, identity: control.identity }));
    admissions.set(tx, entries);
    coLocatedAdmissions.set(tx, state);
    return Object.freeze({ targetMetadataGeneration: BigInt(accepted.targetMetadataGeneration),
      controlMetadataGeneration: BigInt(accepted.controlMetadataGeneration) });
  });

export const getCoLocatedReadInstallationReferences = Effect.fn("InstallationLifecycle.coLocatedReferences")(
  (pair: PreparedCoLocatedReadInstallation, database: FlarexMetadataDatabase) =>
    Effect.fromResult(getCoLocatedReadInstallationReferencesResult(pair, database)),
);

/** Scope-less admission supplies no placement or clock verdict. Direct helpers
 * authenticate the actual caller and acquire the two installation latches in
 * lexical order before any later owner takes scope/head/data locks. */
export function coLocatedInstallationFrontierSource(refs: Pick<CoLocatedReadInstallationReferences, "target" | "control">): SQL {
  const targetFirst = Buffer.compare(Buffer.from(refs.target.schemaName, "utf8"),
    Buffer.from(refs.control.schemaName, "utf8")) < 0;
  const first = targetFirst ? refs.target : refs.control, second = targetFirst ? refs.control : refs.target;
  const firstSchema = sql.identifier(first.schemaName), secondSchema = sql.identifier(second.schemaName);
  // Each direct helper's expected type belongs to its own installed namespace.
  const targetAlias = sql.identifier(targetFirst ? "first_frontier" : "second_frontier");
  const controlAlias = sql.identifier(targetFirst ? "second_frontier" : "first_frontier");
  return sql`(with first_frontier as materialized (
      select ${firstSchema}.fx_lock_installation_frontier(${first.localFrontierExpected}) as frontier),
    second_frontier as materialized (select ${secondSchema}.fx_lock_installation_frontier(${second.localFrontierExpected}) as frontier
      from first_frontier where (first_frontier.frontier).accepted offset 0)
    select case when (first_frontier.frontier).accepted and (second_frontier.frontier).accepted
      then 'accepted' else 'invalidAuthority' end as reason,
      (${targetAlias}.frontier).metadata_generation::text as target_metadata_generation,
      (${controlAlias}.frontier).metadata_generation::text as control_metadata_generation
    from first_frontier left join second_frontier on true)`;
}

export const coLocatedInstallationFrontierFields = () => ({ reason: sql<string>`installed.reason`,
  targetMetadataGeneration: sql<string | null>`installed.target_metadata_generation`,
  controlMetadataGeneration: sql<string | null>`installed.control_metadata_generation` });

export const acquireCoLocatedInstallationAdmission = Effect.fn("InstallationLifecycle.acquireCoLocatedAdmission")(
  function* (pair: PreparedCoLocatedReadInstallation, database: FlarexMetadataDatabase, tx: FlarexMetadataTransaction) {
    const refs = yield* getCoLocatedReadInstallationReferences(pair, database);
    const rows = yield* query(() => tx.select(coLocatedInstallationFrontierFields())
      .from(sql`${coLocatedInstallationFrontierSource(refs)} as installed`).limit(2));
    if (rows.length !== 1 || rows[0] === undefined) return yield* Effect.fail(issue("changed"));
    const generations = yield* acceptCoLocatedInstallationFrontier(pair, database, tx, rows[0]);
    return Object.freeze({ ...refs, ...generations });
  });

export function requireCoLocatedInstallationAdmissionResult(pair: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, tx: FlarexMetadataTransaction): Result.Result<void, InstallationLifecycleError> {
  const state = coLocatedPreparations.get(pair);
  return state === undefined || state.database !== database || coLocatedAdmissions.get(tx) !== state ||
    !isManagedInstallationTransaction(tx, database, state.target) || !isManagedInstallationTransaction(tx, database, state.control)
    ? Result.fail(issue("invalidCapability")) : Result.succeed(undefined);
}

export const requireCoLocatedInstallationAdmission = Effect.fn("InstallationLifecycle.requireCoLocatedAdmission")(
  (pair: PreparedCoLocatedReadInstallation, database: FlarexMetadataDatabase, tx: FlarexMetadataTransaction) =>
    Effect.fromResult(requireCoLocatedInstallationAdmissionResult(pair, database, tx)),
);

export function isCoLocatedInstallationTransaction(tx: FlarexMetadataTransaction,
  database: FlarexMetadataDatabase, installation: PreparedInstallation): boolean {
  const state = coLocatedAdmissions.get(tx);
  return state?.database === database && (state.target === installation || state.control === installation) &&
    isManagedInstallationTransaction(tx, database, installation);
}

/** Existing admission owns the exact two namespace preparations. Ordinary
 * artifact transactions have no managed pair; partial admission is refusal. */
export function readAdmittedCoLocatedInstallationPair(tx: FlarexMetadataTransaction): Result.Result<
  Readonly<{ database: FlarexMetadataDatabase; target: PreparedInstallation; control: PreparedInstallation }> | null,
  InstallationLifecycleError> {
  const state = coLocatedAdmissions.get(tx);
  if (state === undefined) return Result.succeed(null);
  return isManagedInstallationTransaction(tx, state.database, state.target) &&
    isManagedInstallationTransaction(tx, state.database, state.control)
    ? Result.succeed({ database: state.database, target: state.target, control: state.control })
    : Result.fail(issue("invalidCapability"));
}

/** Construction correlation uses the exact issuer-owned control member. */
export function isCoLocatedControlInstallation(pair: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, installation: PreparedInstallation): boolean {
  const state = coLocatedPreparations.get(pair);
  return state?.database === database && state.control === installation && preparations.get(installation)?.database === database;
}

export function managedInstallationIdentity(prepared: PreparedInstallation, database: FlarexMetadataDatabase): InstallationIdentity | undefined {
  const state = preparations.get(prepared);
  return state?.database === database ? state.identity : undefined;
}

export function managedInstallationMetadataIncarnation(prepared: PreparedInstallation,
  database: FlarexMetadataDatabase): string | undefined {
  const state = preparations.get(prepared);
  return state?.database === database ? state.metadataIncarnation : undefined;
}

export function managedInstallationSchema(prepared: PreparedInstallation,
  database: FlarexMetadataDatabase): string | undefined {
  const state = preparations.get(prepared);
  return state?.database === database ? state.identity.schemaName : undefined;
}

/** Gate admission is transaction-local. It precedes all scope/head/data locks. */
export const acquireInstallationAdmission = Effect.fn("InstallationLifecycle.acquire")(
  function* (prepared: PreparedInstallation, database: FlarexMetadataDatabase, tx: FlarexMetadataTransaction) {
    const state = preparations.get(prepared);
    if (state === undefined || state.database !== database) return yield* Effect.fail(issue("invalidCapability"));
    const prior = admissions.get(tx)?.get(state.identity.schemaName);
    const identity = prior?.database === database ? prior.identity :
      yield* readGate(tx, state.identity.schemaName, state.endpointPolicy, state.accessProfile, state.metadataIncarnation);
    if (!sameIdentity(identity, state.identity)) return yield* Effect.fail(issue("changed"));
    const entries = admissions.get(tx) ?? new Map();
    entries.set(identity.schemaName, Object.freeze({ identity, database }));
    admissions.set(tx, entries);
    return identity;
  },
);

/** Full-proof profiles participate in maintenance without acquiring reusable proof. */
export const lockInstallationForCurrentTransaction = Effect.fn("InstallationLifecycle.lockCurrent")(
  function* (tx: FlarexMetadataDatabase, schemaName?: string) {
    if (admissions.has(tx)) {
      if (schemaName !== undefined) {
        const admittedSchema = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx));
        if (admittedSchema !== schemaName) return yield* Effect.fail(issue("invalidCapability"));
      }
      return;
    }
    // Full-profile callers retain their role/catalog/search-path attestation.
    // Managed callers use the exact installed, schema-qualified reference above.
    const identity = yield* readGate(tx, schemaName);
    admissions.set(tx, new Map([[identity.schemaName, Object.freeze({ identity })]]));
  },
);

export function isManagedInstallationTransaction(tx: FlarexMetadataTransaction,
  database: FlarexMetadataDatabase, prepared: PreparedInstallation): boolean {
  const state = preparations.get(prepared);
  const admission = state === undefined ? undefined : admissions.get(tx)?.get(state.identity.schemaName);
  return state?.database === database && admission?.database === database &&
    sameIdentity(state.identity, admission.identity);
}

export function closeInstallationAdmission(tx: FlarexMetadataDatabase | FlarexMetadataTransaction): void {
  admissions.delete(tx);
  coLocatedAdmissions.delete(tx);
}

/** The admitted target member owns schema-qualified calls in this transaction.
 * Logical locators and search-path fallbacks cannot choose an installed body. */
export function requireAdmittedTargetInstallationSchema(tx: FlarexMetadataDatabase): Result.Result<string, InstallationLifecycleError> {
  const entries = admissions.get(tx);
  const pair = coLocatedAdmissions.get(tx);
  if (pair !== undefined) {
    const target = preparations.get(pair.target);
    const entry = target === undefined ? undefined : entries?.get(target.identity.schemaName);
    return target?.database === pair.database && entry?.database === pair.database &&
      sameIdentity(entry.identity, target.identity)
      ? Result.succeed(entry.identity.schemaName) : Result.fail(issue("invalidCapability"));
  }
  const entry = entries?.size === 1 ? entries.values().next().value : undefined;
  return entry === undefined ? Result.fail(issue("invalidCapability")) : Result.succeed(entry.identity.schemaName);
}

const readGate = Effect.fn("InstallationLifecycle.readGate")(function* (
  tx: FlarexMetadataDatabase, schemaName?: string, endpointPolicy?: string,
  accessProfile: InstallationAccessProfile = "dataRuntime", metadataIncarnation?: string,
) {
  if (endpointPolicy !== undefined && schemaName === undefined)
    return yield* Effect.fail(issue("invalidInstallation"));
  const gate = schemaName === undefined ? sql`fx_lock_installation_admission()` :
    sql`${sql.identifier(schemaName)}.fx_lock_installation_admission()`;
  const policyJoin = endpointPolicy !== undefined && schemaName !== undefined ? sql`
      inner join ${sql.identifier(schemaName)}.fx_system_installation_runtime p
      on p.login = session_user and p.login_oid = session_user::pg_catalog.regrole::oid::bigint
      and p.incarnation = i.incarnation and p.structural_generation = i.structural_generation
      and p.endpoint_policy = ${endpointPolicy} and p.access_profile = ${accessProfile}` : sql``;
  const rows = yield* query(() => tx.select({
    databaseName: sql<string>`i.database_name`, schemaName: sql<string>`i.schema_name`,
    namespaceOid: sql<string>`i.namespace_oid::text`, incarnation: sql<string>`i.incarnation::text`,
    structuralGeneration: sql<string>`i.structural_generation::text`, login: sql<string>`session_user`,
    sameLogin: sql<boolean>`current_user = session_user`, actualDatabase: sql<string>`current_database()`,
    sameSchema: schemaName === undefined ? sql<boolean>`current_schema() = i.schema_name` :
      sql<boolean>`i.schema_name = ${schemaName} and i.namespace_oid = ${schemaName}::pg_catalog.regnamespace::oid::bigint`,
    metadataIncarnation: endpointPolicy === undefined ? sql<string | null>`null` : sql<string | null>`p.metadata_incarnation::text`,
    // This expression executes in the caller, after the qualified gate returns;
    // setting inside its SECURITY DEFINER/SET function would be restored on exit.
    // Explicit pg_temp last prevents temporary relations shadowing real tables.
    searchPath: sql<string>`pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_temp', i.schema_name), true)`,
  }).from(sql`${gate} as i ${policyJoin}`).limit(2));
  const [identity] = yield* decodeIdentityRows(rows).pipe(Effect.mapError(cause => issue("invalidInstallation", cause)));
  if (!identity.sameLogin || !identity.sameSchema || identity.databaseName !== identity.actualDatabase)
    return yield* Effect.fail(issue("invalidInstallation"));
  if (metadataIncarnation !== undefined && rows[0]?.metadataIncarnation !== metadataIncarnation)
    return yield* Effect.fail(issue("changed"));
  return Object.freeze(identity);
});

function sameIdentity(left: InstallationIdentity, right: InstallationIdentity): boolean {
  return left.databaseName === right.databaseName && left.schemaName === right.schemaName &&
    left.namespaceOid === right.namespaceOid && left.incarnation === right.incarnation &&
    left.structuralGeneration === right.structuralGeneration && left.login === right.login;
}

function query<Value>(run: () => PromiseLike<Value>): Effect.Effect<Value, InstallationLifecycleError> {
  return Effect.tryPromise({ try: () => Promise.resolve(run()), catch: cause =>
    issue(sqlState(cause) === "55P03" ? "busy" : sqlState(cause) === "55000" ? "inactive" :
      sqlState(cause) === "40001" ? "changed" : "resourceFailure", cause) });
}

function sqlState(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if ("code" in value && typeof value.code === "string") return value.code;
  return "cause" in value ? sqlState(value.cause) : undefined;
}

/** Runs only at the trusted installation boundary, never on a preparation miss. */
export const verifyInstallationWriterProtection = Effect.fn("InstallationLifecycle.verifyWriters")(
  function* (database: FlarexMetadataDatabase, schemaName: string,
    journal: Readonly<{ schemaName: string; tableName: string }> = { schemaName: "drizzle", tableName: "__drizzle_migrations" }) {
    const pointTable = fxSystemTransactionJournalPoints;
    const pointCheck = getTableConfig(pointTable).checks.find(check => check.name === "fx_system_tx_journal_point_dependency_check");
    if (pointCheck === undefined) return yield* Effect.die(new Error("Journal point dependency CHECK is missing from the schema"));
    // A unique lexical name also permits nested verification on one backend.
    // Successful verification drops it lexically; rollback owns failure cleanup.
    const referenceName = `fx_point_dependency_reference_${crypto.randomUUID().replaceAll("-", "")}`;
    const referenceRelation = `pg_temp.${referenceName}`;
    const kind = pointTable.dependencyKind, revision = pointTable.dependencyRevisionCommitSeq;
    return yield* runEffectTransactionSettlement(callback => database.transaction(callback),
      "Installation CHECK verification rolled back", tx => Effect.gen(function* () {
      yield* query(() => tx.execute(sql`
        create temporary table ${sql.identifier("pg_temp")}.${sql.identifier(referenceName)} (
          ${sql.identifier(kind.name)} ${sql.raw(kind.getSQLType())} ${kind.notNull ? sql`not null` : sql``},
          ${sql.identifier(revision.name)} ${sql.raw(revision.getSQLType())} ${revision.notNull ? sql`not null` : sql``},
          constraint ${sql.identifier(pointCheck.name)} check (${transactionJournalPointDependencyCheck(
            sql.identifier(kind.name), sql.identifier(revision.name))})
        ) on commit drop
      `));
    const rows = yield* query(() => tx.select({ protected: sql<boolean>`(
      with bounds as materialized (
        select ${schemaName}::pg_catalog.regnamespace::oid as namespace_oid,
          c.relowner as owner_oid from pg_catalog.pg_class c
        where c.oid = ${`${schemaName}.fx_system_installation`}::pg_catalog.regclass
      ), functions as materialized (
        select p.* from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
          and p.proname in ('fx_lock_installation_admission', 'fx_require_active_installation')
      ), placement_tables as materialized (
        select c.* from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
          and c.relname in ('fx_control_scope','fx_control_scope_provisioning')
      ), placement_columns as materialized (
        select * from (values
          ('fx_control_scope','id','text'::pg_catalog.regtype,true),
          ('fx_control_scope','deployment_id','text'::pg_catalog.regtype,true),
          ('fx_control_scope','active_schema_version_id','text'::pg_catalog.regtype,false),
          ('fx_control_scope','isolation_kind','text'::pg_catalog.regtype,true),
          ('fx_control_scope','physical_locator_json','jsonb'::pg_catalog.regtype,true),
          ('fx_control_scope','created_at','timestamptz'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','scope_id','text'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','protocol_version','text'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','state','text'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','physical_locator_json','jsonb'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','initial_epoch','text'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','reserved_at','timestamptz'::pg_catalog.regtype,true),
          ('fx_control_scope_provisioning','ready_at','timestamptz'::pg_catalog.regtype,false)
        ) as expected(table_name,column_name,type_oid,required)
      )
      select ${scopeExecutionAuthorityInstallationSql(sql`${schemaName}`)} and ${indexMaintenanceInstallationSql(sql`${schemaName}`)}
        and ${protectedMetadataHasNoInheritanceSql(sql`(select namespace_oid from bounds)`)}
        and exists (
          select 1 from pg_catalog.pg_constraint actual
          join pg_catalog.pg_class actual_table on actual_table.oid = actual.conrelid
          join pg_catalog.pg_constraint expected on expected.conrelid = ${referenceRelation}::pg_catalog.regclass
          where actual_table.relnamespace = ${schemaName}::pg_catalog.regnamespace
            and actual_table.relname = ${getTableName(pointTable)}
            and actual.conname = ${pointCheck.name} and expected.conname = ${pointCheck.name}
            and actual.contype = 'c' and expected.contype = 'c'
            and actual.convalidated and expected.convalidated
            and not actual.connoinherit and not expected.connoinherit
            and not exists (
              select 1 from pg_catalog.pg_attribute reference_column
              where reference_column.attrelid = expected.conrelid
                and reference_column.attnum > 0 and not reference_column.attisdropped
                and not exists (
                  select 1 from pg_catalog.pg_attribute installed_column
                  where installed_column.attrelid = actual.conrelid
                    and installed_column.attname = reference_column.attname
                    and installed_column.attnum > 0 and not installed_column.attisdropped
                    and installed_column.atttypid = reference_column.atttypid
                    and installed_column.atttypmod = reference_column.atttypmod
                    and installed_column.attcollation = reference_column.attcollation
                    and installed_column.attnotnull = reference_column.attnotnull
                    and installed_column.attidentity = '' and installed_column.attgenerated = ''
                )
            )
            and pg_catalog.pg_get_expr(actual.conbin, actual.conrelid) =
              pg_catalog.pg_get_expr(expected.conbin, expected.conrelid)
        )
        and (select count(*) = 2 and bool_and(
        p.proowner = b.owner_oid and p.prosecdef and p.provolatile = 'v' and p.pronargs = 0
        and p.pronargdefaults = 0 and p.prokind = 'f' and not p.proisstrict
        and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
        and case p.proname when 'fx_require_active_installation' then
          p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype and not p.proretset
        else p.prorettype = 'pg_catalog.record'::pg_catalog.regtype and p.proretset
          and p.proallargtypes = array[25,25,20,2950,20]::oid[]
          and p.proargmodes::text = '{t,t,t,t,t}'
          and p.proargnames = array['database_name','schema_name','namespace_oid','incarnation','structural_generation']::text[] end
        and p.proconfig = array['search_path=pg_catalog, pg_temp']
        and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
          pg_catalog.replace(p.prosrc, E'\\r\\n', E'\\n'), pg_catalog.quote_ident(${schemaName}) || '.',
          'fx_installation_schema.'), 'UTF8')), 'hex') = case p.proname
          when 'fx_lock_installation_admission' then 'a51e8736f1302f4f9a35bc25a6d4947e1826ecf551562a885d32ae4198232939'
          when 'fx_require_active_installation' then 'ea38f45a0563623f7fc4c2395475b254b9ae396939f6cd7159f5374664ed43a1'
        end
      ) from functions p, bounds b)
      -- The only added layout proof is the bounded placement function's two
      -- exact roots. Maintenance/restore must establish its single-row bounds.
      and (select count(*) = 2 and bool_and(c.relkind = 'r' and not c.relispartition
        and c.relowner = b.owner_oid and not c.relhasrules and not c.relrowsecurity)
        from placement_tables c, bounds b)
      and not exists (select 1 from placement_columns expected where not exists (
        select 1 from placement_tables c join pg_catalog.pg_attribute a on a.attrelid = c.oid
        where c.relname = expected.table_name and a.attname = expected.column_name
          and a.attnum > 0 and not a.attisdropped and a.atttypid = expected.type_oid
          and a.attnotnull = expected.required and a.attidentity = '' and a.attgenerated = ''
      ))
      and not exists (select 1 from placement_tables c where not exists (
        select 1 from pg_catalog.pg_attribute a
          join pg_catalog.pg_constraint k on k.conrelid = a.attrelid and k.contype = 'p'
          join pg_catalog.pg_index x on x.indexrelid = k.conindid
          join pg_catalog.pg_class ic on ic.oid = x.indexrelid
          join pg_catalog.pg_am am on am.oid = ic.relam
        where a.attrelid = c.oid and a.attname = case c.relname
          when 'fx_control_scope' then 'id' else 'scope_id' end
          and k.conkey = array[a.attnum]::smallint[] and k.convalidated
          and not k.condeferrable and not k.condeferred
          and x.indrelid = c.oid and x.indisprimary and x.indisunique
          and x.indisvalid and x.indisready and x.indislive and x.indimmediate
          and x.indnkeyatts = 1 and x.indnatts = 1 and x.indkey::text = a.attnum::text
          and x.indcollation[0] = a.attcollation and x.indpred is null and x.indexprs is null
          and am.amname = 'btree'
      ))
      and not exists (select 1 from pg_catalog.pg_proc p, bounds b
        where p.pronamespace = b.namespace_oid and p.proname = 'fx_lock_read_scope_placement')
      and exists (
        select 1 from pg_catalog.pg_proc p, bounds b
        where p.pronamespace = b.namespace_oid and p.proname = 'fx_publish_application_read_binding'
          and p.proowner = b.owner_oid and p.prosecdef and p.provolatile = 'v'
          and p.pronargs = 2 and p.proargtypes = '17 17'::pg_catalog.oidvector
          and p.pronargdefaults = 0 and p.prokind = 'f' and not p.proisstrict
          and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
          and p.prorettype = 'pg_catalog.void'::pg_catalog.regtype and not p.proretset
          and p.proconfig = array['search_path=pg_catalog, pg_temp']
          and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
          and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,
            pg_catalog.acldefault('f',p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
            pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),
              pg_catalog.quote_ident(${schemaName}) || '.', 'fx_installation_schema.'),
              pg_catalog.quote_literal(${schemaName}), pg_catalog.quote_literal('fx_installation_schema')),
            'UTF8')), 'hex') = '91389713e0d4c1923e30b46e04c426be1adc6c1af7082aaf91b8202df9883072'
      )
      and not exists (
        select 1 from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
          and c.relkind in ('r','p') and not c.relispartition
          and c.relname not in ('fx_system_installation','fx_system_installation_runtime')
          and not (c.relname = ${journal.tableName} and ${schemaName} = ${journal.schemaName})
          and not exists (
            select 1 from pg_catalog.pg_trigger t join functions p on p.oid = t.tgfoid
            where t.tgrelid = c.oid and t.tgname = 'fx_00_installation_admission'
              and p.proname = 'fx_require_active_installation' and not t.tgisinternal
              and t.tgenabled = 'O' and t.tgtype = 62 and t.tgconstraint = 0
              and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null and t.tgnargs = 0
          )
      )
    )` }).from(sql`(values (1)) as installation_verification(value)`));
    yield* query(() => tx.execute(sql`drop table ${sql.identifier("pg_temp")}.${sql.identifier(referenceName)}`));
    if (rows.length !== 1 || rows[0]?.protected !== true) return yield* Effect.fail(issue("invalidInstallation"));
    }), cause => issue("resourceFailure", cause));
  },
);

/** Catalog proof runs through each actual serving login at installation time.
 * Namespace-wide checks protect the installed structures, while mutable data
 * retains its ordinary DML authority. No verdict is retained by this function. */
export const verifyManagedRuntimePrivileges = Effect.fn("InstallationLifecycle.verifyRuntimePrivileges")(
  function* (database: FlarexMetadataDatabase, schemaName: string,
    journal: Readonly<{ schemaName: string; tableName: string }>,
    accessProfile: InstallationAccessProfile = "dataRuntime") {
    const rows = yield* query(() => database.select({ protected: sql<boolean>`(
      with bounds as materialized (
        select ${schemaName}::pg_catalog.regnamespace::oid as namespace_oid,
          session_user::pg_catalog.regrole::oid as login_oid
      )
      select current_schema() = ${schemaName} and current_user = session_user
        and pg_catalog.current_setting('session_replication_role') = 'origin'
        and (${accessProfile} <> 'activationWriter' or not exists (
          select 1 from pg_catalog.pg_auth_members m, bounds b where m.roleid = b.login_oid
        ))
        and not exists (
          select 1 from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
            and (c.relowner = b.login_oid or (c.relkind in ('r','p') and (
              c.relhasrules or c.relrowsecurity or
              pg_catalog.has_table_privilege(b.login_oid,c.oid,'TRUNCATE,TRIGGER'))))
        )
        and not exists (
          select 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
            and (p.proowner = b.login_oid or (p.prosecdef
              and pg_catalog.has_function_privilege(b.login_oid,p.oid,'EXECUTE')
              and p.oid not in (${`${schemaName}.fx_lock_installation_admission()`}::pg_catalog.regprocedure,
                ${`${schemaName}.fx_lock_prepared_metadata_epoch()`}::pg_catalog.regprocedure,
                case when ${accessProfile} <> 'controlRead' then
                  ${`${schemaName}.fx_publish_application_read_binding(bytea,bytea)`}::pg_catalog.regprocedure
                else ${`${schemaName}.fx_accept_finite_placement_frontier(${schemaName}.fx_installation_frontier_expected,${schemaName}.fx_installation_frontier_expected,text,text)`}::pg_catalog.regprocedure end)
              and not (${accessProfile} <> 'activationWriter' and p.oid =
                ${`${schemaName}.fx_lock_installation_frontier(${schemaName}.fx_installation_frontier_expected)`}::pg_catalog.regprocedure)
              and not (${accessProfile} = 'controlRead' and p.oid =
                ${`${schemaName}.fx_accept_finite_placement_frontier(${schemaName}.fx_installation_frontier_expected,${schemaName}.fx_installation_frontier_expected,text,text)`}::pg_catalog.regprocedure)
              and not (${accessProfile} = 'activationWriter' and p.oid in (
                ${sql.join(INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.map(operation =>
                  sql`${`${schemaName}.${operation.name}(${operation.signature})`}::pg_catalog.regprocedure`), sql`, `)}))))
        )
        and not exists (
          select 1 from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
            and (${accessProfile} = 'controlRead' or c.relname in ('fx_system_installation','fx_system_installation_runtime',
              'fx_system_application_read_binding','fx_control_logical_read_source',
              'fx_control_logical_read_table','fx_control_logical_read_access',
              ${sql.join(INDEX_MAINTENANCE_OBLIGATION_TABLES.map(table => sql`${table}`), sql`, `)}))
            and c.relkind in ('r','p')
            and (pg_catalog.has_table_privilege(b.login_oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
              or pg_catalog.has_any_column_privilege(b.login_oid,c.oid,'INSERT,UPDATE'))
        )
        and ${sql.join(INDEX_MAINTENANCE_BUILD_PERMISSIONS.map(build => sql`exists (
          select 1 from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
            and c.relname = ${build.tableName}
            and not pg_catalog.has_table_privilege(b.login_oid,c.oid,'INSERT,UPDATE')
            and not pg_catalog.has_column_privilege(b.login_oid,c.oid,${build.bindingColumn},'INSERT')
            and not pg_catalog.has_column_privilege(b.login_oid,c.oid,${build.bindingColumn},'UPDATE')
            and not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = c.oid
              and a.attnum > 0 and not a.attisdropped
              and a.attname <> all(array[${sql.join(build.writableColumns.map(column => sql`${column}`), sql`, `)}]::text[])
              and pg_catalog.has_column_privilege(b.login_oid,c.oid,a.attname,'INSERT,UPDATE'))
            and (${accessProfile} = 'controlRead' or (select count(*) = ${build.writableColumns.length}
              and bool_and(pg_catalog.has_column_privilege(b.login_oid,c.oid,a.attname,'INSERT')
                and pg_catalog.has_column_privilege(b.login_oid,c.oid,a.attname,'UPDATE'))
              from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                and a.attname = any(array[${sql.join(build.writableColumns.map(column => sql`${column}`), sql`, `)}]::text[])))
        )`), sql` and `)}
        and (${accessProfile} <> 'controlRead' or (pg_catalog.has_table_privilege(session_user,
          ${`${schemaName}.fx_control_schema_version`}, 'SELECT') and pg_catalog.has_table_privilege(session_user,
          ${`${schemaName}.fx_control_schema_unique_constraint_set`}, 'SELECT')) )
        and (${accessProfile} = 'controlRead' or (select count(*) = 2 and bool_and(
          pg_catalog.has_table_privilege(b.login_oid,c.oid,'SELECT')
          and pg_catalog.has_table_privilege(b.login_oid,c.oid,'INSERT')
          and pg_catalog.has_table_privilege(b.login_oid,c.oid,'UPDATE')
          and pg_catalog.has_table_privilege(b.login_oid,c.oid,'DELETE'))
          from pg_catalog.pg_class c, bounds b where c.relnamespace = b.namespace_oid
            and c.relname in ('fx_system_scope_execution_authority','fx_system_metadata_contract_observation')))
        and exists (
          select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace, bounds b
          where n.nspname = ${journal.schemaName} and c.relname = ${journal.tableName}
            and c.relkind = 'r' and c.relowner <> b.login_oid
            and not pg_catalog.has_table_privilege(b.login_oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')
            and not pg_catalog.has_any_column_privilege(b.login_oid,c.oid,'INSERT,UPDATE')
        )
        and pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_lock_installation_admission()`},'EXECUTE')
        and pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_lock_installation_frontier(${schemaName}.fx_installation_frontier_expected)`},'EXECUTE') = (${accessProfile} <> 'activationWriter')
        and pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_accept_finite_placement_frontier(${schemaName}.fx_installation_frontier_expected,${schemaName}.fx_installation_frontier_expected,text,text)`},'EXECUTE') = (${accessProfile} = 'controlRead')
        and ${sql.join(["fx_installation_frontier_expected","fx_installation_frontier"].map(type => sql`
          pg_catalog.has_type_privilege(session_user,${`${schemaName}.${type}`},'USAGE') = (${accessProfile} <> 'activationWriter')`),sql` and `)}
        and pg_catalog.has_type_privilege(session_user,${`${schemaName}.fx_finite_placement_frontier`},'USAGE') = (${accessProfile} = 'controlRead')
        and pg_catalog.has_type_privilege(session_user,${`${schemaName}.fx_finite_capture_frontier`},'USAGE') = (${accessProfile} = 'dataRuntime')
        and ${sql.join(INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.map(operation => sql`
          pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.${operation.name}(${operation.signature})`}, 'EXECUTE') = (${accessProfile} = 'activationWriter')`), sql` and `)}
        and pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_read_application_write_ownership_snapshot(text,integer,integer)`}, 'EXECUTE') = (${accessProfile} <> 'controlRead')
        and pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_read_application_ownership_manifest(text,text,integer,integer)`}, 'EXECUTE') = (${accessProfile} <> 'controlRead')
        and ${sql.join([...FINITE_PUBLICATION_FUNCTIONS, ...APPLICATION_DOMAIN_FUNCTIONS].map(operation => sql`
          pg_catalog.has_function_privilege(session_user,
            (pg_catalog.quote_ident(${schemaName}) || '.' || ${operation.name} || '(' ||
              pg_catalog.replace(${operation.signature.replaceAll("fx_app_", '"__flarex_schema__".fx_app_')},
                '"__flarex_schema__"', pg_catalog.quote_ident(${schemaName})) || ')'), 'EXECUTE') = (${accessProfile} = 'dataRuntime')`), sql` and `)}
        and ${sql.join(APPLICATION_DOMAIN_TYPES.map(type => sql`
          pg_catalog.has_type_privilege(session_user,
            pg_catalog.quote_ident(${schemaName}) || '.' || ${type.name}, 'USAGE') = (${accessProfile} = 'dataRuntime')`), sql` and `)}
        and case when ${accessProfile} = 'dataRuntime' then
          pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_observe_finite_entry(text,uuid,text,text)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_complete_finite_entry(${schemaName}.fx_finite_entry_expected,boolean)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_compare_finite_metadata(text,bigint,jsonb)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_accept_finite_storage_capture(text,${schemaName}.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_historical_row_identity(uuid,integer,bytea)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_application_ownership_unique_closure(text,text,integer,integer)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_publish_application_read_binding(bytea,bytea)`},'EXECUTE')
        else not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_observe_finite_entry(text,uuid,text,text)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_complete_finite_entry(${schemaName}.fx_finite_entry_expected,boolean)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_compare_finite_metadata(text,bigint,jsonb)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_accept_finite_storage_capture(text,${schemaName}.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_historical_row_identity(uuid,integer,bytea)`},'EXECUTE')
          and not pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer)`},'EXECUTE')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_read_application_ownership_unique_closure(text,text,integer,integer)`},'EXECUTE') = (${accessProfile} = 'controlRead')
          and pg_catalog.has_function_privilege(session_user,
            ${`${schemaName}.fx_publish_application_read_binding(bytea,bytea)`},'EXECUTE') = (${accessProfile} <> 'controlRead') end
        and not pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_check_scope_execution_authority()`},'EXECUTE')
        and not pg_catalog.has_function_privilege(session_user,
          ${`${schemaName}.fx_require_active_installation()`},'EXECUTE')
    )` }).from(sql`(values (1)) as runtime_protection(value)`));
    if (rows.length !== 1 || rows[0]?.protected !== true)
      return yield* Effect.fail(issue("invalidInstallation"));
  },
);

/** Explicit compatibility installer initialization. It issues no managed token.
 * Only a genuinely unverified fresh installation can open through this path. */
export const initializeFullProofInstallation = Effect.fn("InstallationLifecycle.initializeFullProof")(
  function* (database: FlarexMetadataDatabase, schemaName?: string) {
    const resolved = schemaName ?? (yield* query(() => database.select({ schema: sql<string>`current_schema()` })
      .from(sql`(values (1)) as installation_schema(value)`)))[0]?.schema;
    if (typeof resolved !== "string" || resolved.length === 0) return yield* Effect.fail(issue("invalidInstallation"));
    yield* verifyInstallationWriterProtection(database, resolved);
    const rows = yield* query(() => database.select({ state: sql<string>`i.state`,
      owner: sql<boolean>`pg_catalog.pg_has_role(session_user, c.relowner, 'USAGE')` })
      .from(sql`${sql.identifier(resolved)}.fx_system_installation i inner join pg_catalog.pg_class c
        on c.oid = ${`${resolved}.fx_system_installation`}::pg_catalog.regclass`).limit(2));
    if (rows.length !== 1 || rows[0]?.owner !== true) return yield* Effect.fail(issue("invalidCapability"));
    if (rows[0]?.state === "active") return;
    if (rows[0]?.state !== "unverified") return yield* Effect.fail(issue("inactive"));
    yield* query(() => database.execute(sql`update ${sql.identifier(resolved)}.fx_system_installation
      set state = 'active' where singleton_id = 1 and state = 'unverified'`));
  },
);
