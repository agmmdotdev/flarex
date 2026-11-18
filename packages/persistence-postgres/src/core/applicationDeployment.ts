import { Effect, Option, Result } from "effect";
import type { CoreApplicationCandidate, CoreApplicationRegistrationMetadata, CoreDatabase, CoreError,
  CoreProgramPublication, CoreSchemaProposal, CoreSchemaStatus, CoreTableDefinition } from "./api";
import { CoreTransactionError } from "./api";
import { decodeCoreApplicationDeployment, type CoreApplicationDeploymentRecord, type CoreApplicationDeploymentValue } from "./applicationDeploymentTypes";
import { captureCoreApplicationPrograms, captureCoreApplicationRegistration, coreApplicationRegistrationProof, encodeCoreApplicationCandidateMetadata,
  liveCoreApplicationSchemas, readActiveCoreApplicationRegistration, readCoreApplicationDeploymentEvidence,
  requireCoreApplicationTables, trackCoreApplicationPrograms } from "./applicationRegistration";
import { CorePersistenceError, type CorePersistenceSnapshot } from "./contracts";
import { finishCoreIndexChanges, planCoreIndexes, type CoreIndexChanges } from "./indexModel";
import { CORE_BUILTIN_TABLE_NUMBERS, INDEXES, INDEX_BACKFILLS, PROGRAMS, TABLES, publicDocumentId, type CoreRegistry } from "./registry";
import { CoreSchemaModel } from "./schemaModel";
import type { CoreSchemaSelection } from "./schemaRegistry";
import { captureCoreSchema, checkCoreSchemaIndexReferences, CoreSchemaError, type CoreSchemaDefinition } from "./schemaTypes";
import type { CoreTransactionInternals } from "./transaction";

interface DeploymentSelection { readonly context: CoreTransactionInternals; readonly snapshot: CorePersistenceSnapshot; readonly timestamp: bigint }
interface DeploymentHost<Selected extends DeploymentSelection> {
  readonly admin: <A>(use: (selected: Selected) => Effect.Effect<A, CoreError>) => Effect.Effect<A, CoreError>;
  readonly settle: (selected: Selected) => Effect.Effect<bigint, CoreError>;
  readonly ensureNamespace: (context: CoreTransactionInternals) => Effect.Effect<void, CoreError>;
  readonly prepareSchemaIndexes: (selected: Selected, schema: CoreSchemaDefinition) => Effect.Effect<void, CoreError>;
  readonly applyIndexes: (context: CoreTransactionInternals, changes: CoreIndexChanges) => Effect.Effect<void, CoreError>;
  readonly assertEmptyTable: (selected: Selected, table: CoreTableDefinition) => Effect.Effect<void, CoreError>;
  readonly writePrograms: (selected: Selected, publication: CoreProgramPublication, complete?: boolean) => Effect.Effect<void, CoreError>;
  readonly schemaStatusValue: (registry: CoreRegistry, proposal: CoreSchemaProposal, schema: CoreSchemaSelection) => CoreSchemaStatus;
  readonly checkedApplicationRegistrations: WeakMap<CoreRegistry, CoreApplicationRegistrationMetadata>;
}
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
const refuse = (message: string) => new CoreSchemaError({ reason: "unsupportedCapability", message });

/** One source-deployment owner borrowing the existing schema/index/admin settlement. */
export function makeCoreApplicationDeploymentOwner<Selected extends DeploymentSelection>(host: DeploymentHost<Selected>):
  Pick<CoreDatabase, "prepareApplicationCandidate" | "readApplicationCandidate" | "readActiveApplicationCandidate"
    | "activateApplicationCandidate" | "abandonApplicationCandidate"> {
  const store = Effect.fn("CoreApplicationDeployment.store")(function* (context: CoreTransactionInternals,
    record: CoreApplicationDeploymentRecord, value: CoreApplicationDeploymentValue) {
    const catalog = context.registry.table(PROGRAMS)?.definition;
    if (catalog === undefined) return yield* corrupt();
    yield* context.replaceSystem(PROGRAMS, yield* Effect.fromResult(publicDocumentId(catalog, record.id)), value);
    context.setRegistryAfter(context.registry.withApplicationDeployment({ ...record, value: Object.freeze(value), ts: null }));
  });
  const read = Effect.fn("CoreApplicationDeployment.read")(function* (context: CoreTransactionInternals, record: CoreApplicationDeploymentRecord) {
    const found = yield* new CoreSchemaModel(context).get(record.value.schemaId);
    if (Option.isNone(found)) return yield* corrupt("Application deployment schema is missing");
    const evidence = yield* readCoreApplicationDeploymentEvidence(record, found.value);
    const value = record.value, proposal = Object.freeze({ namespace: null, id: value.schemaId });
    const status = value.state === "activated" ? { state: "active" as const, indexesReady: true }
      : value.state === "abandoned" ? { state: "abandoned" as const, indexesReady: false }
        : host.schemaStatusValue(context.registry, proposal, found.value);
    return Object.freeze({ id: value.candidateId, schemaProposal: proposal, state: value.state === "prepared" && status.state === "active" ? "validated" as const : status.state, indexesReady: status.indexesReady,
      ...("error" in status && status.error !== undefined ? { error: status.error } : {}),
      ...("tableName" in status && status.tableName !== undefined ? { tableName: status.tableName } : {}),
      registration: evidence.registration, metadata: evidence.metadata,
      creationTime: value.createdAt, updatedAt: value.updatedAt, abandoned: value.state === "abandoned",
      ...(value.activatedAt === undefined ? {} : { activatedAt: value.activatedAt }) });
  });
  const requireRecord = Effect.fn("CoreApplicationDeployment.require")(function* (context: CoreTransactionInternals, id: string) {
    yield* Effect.fromResult(trackCoreApplicationPrograms(context));
    const record = context.registry.applicationDeployments.get(id);
    if (record === undefined) return yield* new CoreSchemaError({ reason: "schemaNotFound", message: "Application candidate does not exist" });
    return record;
  });
  const prepareApplicationCandidate: CoreDatabase["prepareApplicationCandidate"] = Effect.fn("CoreApplicationDeployment.prepare")((input) => {
    const captured = Result.gen(function* () {
      const schema = yield* captureCoreSchema(input.schema), registration = yield* captureCoreApplicationRegistration(input.registration);
      yield* checkCoreSchemaIndexReferences(schema);
      return { schema, registration };
    });
    return Effect.gen(function* () {
      const { schema, registration } = yield* Effect.fromResult(captured);
      const proof = yield* coreApplicationRegistrationProof(registration, schema);
      const metadata = yield* Effect.fromResult(encodeCoreApplicationCandidateMetadata(registration));
      return yield* host.admin(selected => Effect.gen(function* () {
        const id = yield* selected.context.runSystem(Effect.gen(function* () {
          yield* host.ensureNamespace(selected.context);
          yield* Effect.fromResult(trackCoreApplicationPrograms(selected.context));
          const live = yield* Effect.fromResult(liveCoreApplicationSchemas(selected.context));
          const ordinary = [...selected.context.registry.tables.values()].map(record => record.definition).filter(table => !CORE_BUILTIN_TABLE_NUMBERS.has(table.name) || table.nativePolicy !== undefined);
          if (live.some(entry => entry.metadata.native !== undefined) || ordinary.some(table => table.nativePolicy !== undefined
            || table.namespace !== null || table.state !== "active")) return yield* refuse("Application candidates require ordinary default-namespace ownership");
          const active = yield* readActiveCoreApplicationRegistration(selected.context, host.checkedApplicationRegistrations);
          const first = selected.context.registry.applicationDeployments.values().next().value;
          const previous = Option.isSome(active) ? active.value : first === undefined ? undefined : (yield* read(selected.context, first)).registration;
          if (previous !== undefined && (previous.deploymentId !== registration.deploymentId || previous.scopeUuid !== registration.scopeUuid
            || previous.epochUuid !== registration.epochUuid)) return yield* refuse("Application candidate cannot replace deployment or scope ownership");
          for (const record of selected.context.registry.applicationDeployments.values()) if (record.value.proof === proof) {
            const currentActive = selected.context.registry.activeApplication?.candidateId === record.value.candidateId;
            if (record.value.state === "activated" && currentActive) return record.value.candidateId;
            if (record.value.state !== "prepared") continue;
            const candidate = yield* read(selected.context, record);
            if (candidate.state === "pending" || candidate.state === "validated" || candidate.state === "active") {
              if (planCoreIndexes(selected.context.registry, selected.context.namespace, schema).added.length !== 0)
                yield* host.prepareSchemaIndexes(selected, schema);
              return record.value.candidateId;
            }
          }
          const exclusiveFresh = ordinary.length === 0 && live.length === 0 && selected.context.registry.programs.size === 0
            && selected.context.registry.heads.size === 0 && selected.context.registry.activeApplication === undefined;
          if (previous === undefined && !exclusiveFresh) return yield* refuse("Fresh Application registration requires an unused database");
          const proposal = yield* new CoreSchemaModel(selected.context).submitPending(schema);
          yield* host.prepareSchemaIndexes(selected, schema);
          const internalId = selected.context.idGenerator.nextInternalId(), catalog = selected.context.registry.table(PROGRAMS)?.definition;
          if (catalog === undefined) return yield* corrupt();
          const candidateId = yield* Effect.fromResult(publicDocumentId(catalog, internalId)), now = selected.context.transaction.unixTime;
          const value = yield* Effect.fromResult(decodeCoreApplicationDeployment({ kind: "applicationDeployment" as const, candidateId, schemaId: proposal.id, proof,
            ...(metadata === undefined ? {} : { metadata }), createdAt: now, updatedAt: now, exclusiveFresh, state: "prepared" as const }).pipe(Result.mapError(corrupt)));
          yield* selected.context.insertPrivate(PROGRAMS, internalId, value);
          selected.context.setRegistryAfter(selected.context.registry.withApplicationDeployment({ value, id: internalId, ts: null }));
          return candidateId;
        }));
        yield* host.settle(selected);
        return id;
      }));
    });
  });
  const readApplicationCandidate: CoreDatabase["readApplicationCandidate"] = Effect.fn("CoreApplicationDeployment.readCandidate")((id) =>
    host.admin(selected => selected.context.runSystem(Effect.gen(function* () {
      yield* Effect.fromResult(trackCoreApplicationPrograms(selected.context));
      const record = selected.context.registry.applicationDeployments.get(id);
      return record === undefined ? Option.none<CoreApplicationCandidate>() : Option.some(yield* read(selected.context, record));
    }))));
  const readActiveApplicationCandidate: CoreDatabase["readActiveApplicationCandidate"] = Effect.fn("CoreApplicationDeployment.readActive")(() =>
    host.admin(selected => selected.context.runSystem(Effect.gen(function* () {
      const registration = yield* readActiveCoreApplicationRegistration(selected.context, host.checkedApplicationRegistrations);
      if (Option.isNone(registration)) return Option.none<CoreApplicationCandidate>();
      return Option.some(yield* read(selected.context, yield* requireRecord(selected.context, registration.value.candidateId)));
    }))));
  const activateApplicationCandidate: CoreDatabase["activateApplicationCandidate"] = Effect.fn("CoreApplicationDeployment.activate")((id, input) => {
    const captured = captureCoreApplicationPrograms(input.programs);
    return host.admin(selected => Effect.gen(function* () {
      const result = yield* selected.context.runSystem(Effect.gen(function* () {
        const record = yield* requireRecord(selected.context, id);
        if (record.value.state === "abandoned") return yield* new CoreSchemaError({ reason: "schemaOverwritten", message: "Application candidate was abandoned" });
        const programs = yield* Effect.fromResult(captured);
        const model = new CoreSchemaModel(selected.context), found = yield* model.get(record.value.schemaId);
        if (Option.isNone(found)) return yield* corrupt();
        const schema = found.value;
        const evidence = yield* readCoreApplicationDeploymentEvidence(record, schema);
        const actual = yield* Effect.fromResult(captureCoreApplicationRegistration({ ...evidence.proof.identity, programs,
          ...(record.value.metadata === undefined ? {} : { candidateMetadata: evidence.metadata }) }));
        if ((yield* coreApplicationRegistrationProof(actual, schema.schema)) !== record.value.proof)
          return yield* refuse("Application candidate must publish its complete authenticated program closure");
        if (record.value.state === "activated") return yield* read(selected.context, record);
        yield* model.getValidatedOrActive(record.value.schemaId);
        yield* Effect.fromResult(requireCoreApplicationTables(selected.context, schema.schema));
        const changes = yield* Effect.fromResult(finishCoreIndexChanges(planCoreIndexes(selected.context.registry, null, schema.schema)).pipe(
          Result.mapError(error => error.reason === "unavailable" ? new CoreTransactionError({ reason: "indexUnavailable", cause: error }) : error)));
        yield* host.applyIndexes(selected.context, changes);
        yield* model.markActive(record.value.schemaId);
        yield* host.writePrograms(selected, { programs }, true);
        const now = selected.context.transaction.unixTime;
        yield* store(selected.context, record, { ...record.value, state: "activated", activatedAt: now, updatedAt: now });
        const pointer = selected.context.registry.activeApplication, pointerId = pointer?.id ?? selected.context.idGenerator.nextInternalId();
        if (pointer === undefined) yield* selected.context.insertPrivate(PROGRAMS, pointerId, { kind: "activeApplication", candidateId: id });
        else {
          const catalog = selected.context.registry.table(PROGRAMS)?.definition;
          if (catalog === undefined) return yield* corrupt();
          yield* selected.context.replaceSystem(PROGRAMS, yield* Effect.fromResult(publicDocumentId(catalog, pointerId)), { kind: "activeApplication", candidateId: id });
        }
        selected.context.setRegistryAfter(selected.context.registry.withActiveApplication({ id: pointerId, candidateId: id, ts: null }));
        return yield* read(selected.context, yield* requireRecord(selected.context, id));
      }));
      yield* host.settle(selected);
      return result;
    }));
  });
  const abandonApplicationCandidate: CoreDatabase["abandonApplicationCandidate"] = Effect.fn("CoreApplicationDeployment.abandon")((id) =>
    host.admin(selected => Effect.gen(function* () {
      const candidate = yield* selected.context.runSystem(Effect.gen(function* () {
        const record = yield* requireRecord(selected.context, id);
        if (record.value.state === "abandoned") return yield* read(selected.context, record);
        if (record.value.state === "activated") return yield* refuse("An activated Application candidate cannot be abandoned");
        const model = new CoreSchemaModel(selected.context), found = yield* model.get(record.value.schemaId);
        if (Option.isNone(found)) return yield* corrupt();
        yield* readCoreApplicationDeploymentEvidence(record, found.value);
        const shared = [...selected.context.registry.applicationDeployments.values()].some(other => other.value.candidateId !== id
          && other.value.state !== "abandoned");
        if (record.value.exclusiveFresh && !shared && selected.context.registry.activeApplication === undefined
          && found.value.metadata.state.state !== "overwritten") {
          const live = yield* Effect.fromResult(liveCoreApplicationSchemas(selected.context));
          if (live.some(schema => schema.id !== record.value.schemaId) || selected.context.registry.programs.size !== 0 || selected.context.registry.heads.size !== 0)
            return yield* refuse("Application candidate no longer owns an unactivated database");
          const tables = yield* Effect.fromResult(requireCoreApplicationTables(selected.context, found.value.schema));
          if (tables.length !== found.value.schema.tables.length) return yield* refuse("Application candidate has foreign tables");
          for (const table of tables) yield* host.assertEmptyTable(selected, table);
          yield* model.markOverwritten(record.value.schemaId);
          const catalog = selected.context.registry.table(TABLES)?.definition, indexCatalog = selected.context.registry.table(INDEXES)?.definition;
          if (catalog === undefined || indexCatalog === undefined) return yield* corrupt();
          for (const table of tables) {
            for (const index of selected.context.registry.indexes.forTablet(table.tabletId)) {
              const indexId = yield* Effect.fromResult(publicDocumentId(indexCatalog, index.ref.id));
              for (const row of yield* selected.context.querySystem(INDEX_BACKFILLS, "by_index_id", [indexId])) yield* selected.context.deleteSystem(INDEX_BACKFILLS, row.id);
              yield* selected.context.deleteSystem(INDEXES, indexId);
            }
            yield* selected.context.deleteSystem(TABLES, yield* Effect.fromResult(publicDocumentId(catalog, table.tabletId)));
          }
        }
        yield* store(selected.context, record, { ...record.value, state: "abandoned", updatedAt: selected.context.transaction.unixTime });
        return yield* read(selected.context, yield* requireRecord(selected.context, id));
      }));
      yield* host.settle(selected);
      return candidate;
    })));
  return { prepareApplicationCandidate, readApplicationCandidate, readActiveApplicationCandidate, activateApplicationCandidate, abandonApplicationCandidate };
}
