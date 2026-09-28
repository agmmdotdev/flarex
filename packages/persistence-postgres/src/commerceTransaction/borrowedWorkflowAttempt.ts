import { Clock, Effect, Schema } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { encodeCanonicalJson, isJsonObject, type Json } from "flarex-protocol/json";
import { MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES } from "flarex-protocol/internal/logical-schema-candidate";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { makeBoundedRequestLifetime } from "../boundedRequestLifetime";
import { FrameworkCommandMilliseconds } from "../frameworkExecutionPolicy";
import { capturePrivateJsonData } from "../privateJsonData";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import { makeLogicalDocumentWorkingSet } from "../logicalDocuments/workingSet";
import type { LogicalDocumentBorrowView } from "../logicalDocuments/model";
import { hasLogicalParticipantAttemptAdmission, withLogicalParticipantAdmissionBundleEffect,
  type LogicalParticipantAdmissionBundle, type LogicalParticipantAttemptAdmission } from
  "../logicalDocuments/participantAdmission";
import { withLogicalRelationalAttemptAdmissionEffect,
  type LogicalRelationalAttemptAdmissionState } from "../logicalDocuments/relationalAdmission";
import { prepareLogicalRelationalRows } from "../logicalDocuments/relationalRows";
import { makeAtomicEventCapture, consumeCommerceEvents, captureAtomicCommerceEvents,
  prepareAtomicCommerceEvents, admittedCommerceEventGroup, type AtomicCommerceEvents,
  type AtomicCommerceCallObservation, type CommerceEventContract } from "../atomicCommerce/events";
import type { AtomicCommerceContext } from "../atomicCommerce/commands";
import type { AtomicCommerceParticipantInput } from "../atomicCommerce/participants";
import { getCommerceCommand, type CommerceCommand } from "./commands";
import { makeCommerceCommandContext } from "./context";
import { commerceError, commerceLimits, logicalCommerceError, type CommerceTransactionError } from "./model";
import { captureCommerceResources, defaultCommerceResources, logicalCommerceWorkingSetLimits, type CommerceResources } from "./resources";
import { captureCommerceJsonData, projectCommerceRequestFailure } from "./request";
import { projectLogicalCommerceActivity } from "./logicalParticipant";

type LogicalMember = Extract<AtomicCommerceParticipantInput, { readonly logicalStorage: unknown }>;
export type BorrowedWorkflowAttemptInput = Readonly<{
  readonly bundle: LogicalParticipantAdmissionBundle;
  readonly admissions: readonly LogicalParticipantAttemptAdmission[];
  readonly attempt: SessionJournalAttempt;
  readonly participant: string;
  readonly method: string;
  readonly profileRevision: string;
  readonly members: readonly LogicalMember[];
  readonly events: AtomicCommerceEvents;
  readonly resources?: CommerceResources;
  readonly requestCommandMs?: number;
}> & LogicalDocumentBorrowView;

/** One transient pending view and lifetime for all independently admitted
 * sources. The journal owns the only durable overlay and final settlement. */
export const makeBorrowedWorkflowAttempt = Effect.fn("LogicalCommerce.borrowWorkflow")(function* (
  input: BorrowedWorkflowAttemptInput,
) {
  return yield* withLogicalParticipantAdmissionBundleEffect(input.bundle, input.attempt,
    input.participant, input.method, input.profileRevision, ({ admissions, readTransaction }) =>
      Effect.gen(function* () {
        if (admissions.length !== input.members.length || admissions.length !== input.admissions.length ||
          admissions.length < 1 || admissions.length > 3 ||
          admissions.some((admission, index) => admission !== input.admissions[index]))
          return yield* Effect.fail(commerceError("invalidAuthority"));
        const states: LogicalRelationalAttemptAdmissionState[] = [];
        for (const [index, admission] of admissions.entries()) {
          const member = input.members[index];
          const firstCommand = member?.commands[0];
          const name = firstCommand === undefined ? undefined : getCommerceCommand(firstCommand)?.name;
          if (member === undefined || name === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          yield* withLogicalRelationalAttemptAdmissionEffect(admission, input.attempt, name,
            state => Effect.gen(function* () {
              const source = yield* Effect.fromResult(capturePrivateJsonData(member.logicalStorage.source,
                MAX_LOGICAL_SCHEMA_CANDIDATE_BYTES, (reason, cause) => commerceError("invalidAuthority", { reason, cause })));
              const sourceValue = source.value;
              if (!isJsonObject(sourceValue) || sourceValue.sourceKey !== state.sourceKey)
                return yield* Effect.fail(commerceError("invalidAuthority"));
              const sourceSchema = sourceValue.schema;
              if (sourceSchema === undefined || !isJsonObject(sourceSchema))
                return yield* Effect.fail(commerceError("invalidAuthority"));
              if (encodeCanonicalJson(sourceSchema, () => { throw commerceError("invalidAuthority"); }) !==
                encodeCanonicalJson(state.schema, () => { throw commerceError("invalidAuthority"); }))
                return yield* Effect.fail(commerceError("invalidAuthority"));
              states.push(state);
            }));
        }
        const root = states[0]?.root;
        if (root === undefined || states.some(state => state.root.scopeId !== root.scopeId ||
          state.root.sessionId !== root.sessionId || state.root.attemptFence !== root.attemptFence ||
          state.root.snapshotCommitSeq !== root.snapshotCommitSeq || state.root.schemaVersionId !== root.schemaVersionId))
          return yield* Effect.fail(commerceError("invalidAuthority"));
        const tableNames = new Set<string>();
        const tableIds = new Set<number>();
        const tables: Array<{ tableId: LogicalRelationalAttemptAdmissionState["tables"][number]["tableId"];
          logicalName: string; relational: LogicalRelationalAttemptAdmissionState["tables"][number]["definition"] }> = [];
        for (const state of states) for (const table of state.tables) {
          if (tableNames.has(table.localName) || tableIds.has(table.tableId))
            return yield* Effect.fail(commerceError("invalidAuthority"));
          tableNames.add(table.localName); tableIds.add(table.tableId);
          tables.push({ tableId: table.tableId, logicalName: table.localName, relational: table.definition });
        }
        const resources = yield* Effect.fromResult(captureCommerceResources(input.resources ?? defaultCommerceResources));
        const commandMs = yield* Schema.decodeUnknownEffect(FrameworkCommandMilliseconds)(
          input.requestCommandMs ?? commerceLimits.commandMs,
        ).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
        const lifetime = yield* makeBoundedRequestLifetime(commerceError,
          { calls: resources.calls, commandBytes: resources.commandBytes, commandMs },
          input.attempt, Object.freeze({}), crypto.randomUUID(), "write");
        return yield* Effect.gen(function* () {
          const id = yield* lifetime.begin(lifetime.context);
          for (const state of states) for (const table of state.tables)
            yield* Effect.fromResult(prepareLogicalRelationalRows(table.definition, state.schema.capabilities, logicalCommerceError));
          const checkedRead = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
            readTransaction(work).pipe(Effect.mapError(projectCommerceRequestFailure));
          const requireAdmission = checkedRead(() => Effect.void);
          const working = yield* makeLogicalDocumentWorkingSet({
            readTransaction: checkedRead, requireAdmission,
            scopeId: root.scopeId, clock: states[0]!.clock, snapshotCommitSeq: root.snapshotCommitSeq,
            ...(input.rootEvaluator === undefined ? { pendingRows: input.pendingRows } :
              { rootEvaluator: input.rootEvaluator, rootAttempt: input.attempt,
                rootAttemptFence: input.rootAttemptFence }),
            lifetime, tables,
            relationalCapabilities: states.flatMap(state => state.schema.capabilities),
            searchDefinitions: states.flatMap(state => state.search),
            validateDocument: write => {
              const state = states.find(candidate => candidate.tables.some(table => table.tableId === write.tableId));
              return state === undefined ? Effect.fail(commerceError("invalidAuthority")) :
                Effect.fromResult(state.values.validate(write.tableId, write.document))
                  .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
            },
            error: logicalCommerceError, uniqueConflict: () => commerceError("invalidInput"),
            limits: { ...logicalCommerceWorkingSetLimits, pageRows: resources.queryRows,
              identities: resources.catalogRows },
          }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), states.flatMap(state => state.unique),
            states.flatMap(state => state.indexes.filter(index => index.access.kind === "developer")));
          const eventPolicy = yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captureAtomicCommerceEvents(input.events)));
          const group = admittedCommerceEventGroup({ scopeUuid: projectScopeIdUuidV1(root.scopeId).scopeUuid,
            sessionId: root.sessionId, attemptFence: root.attemptFence });
          const eventCapture = makeAtomicEventCapture(requireAdmission, lifetime, group, eventPolicy, resources.eventMessages);
          const eventSources: Array<string | null> = [];
          const calls: AtomicCommerceCallObservation[] = [];
          const names = new Map(states.flatMap(state => state.tables.map(table => [table.tableId, table.localName] as const)));
          const sourceFor = (participant: AtomicCommerceCallObservation["participant"]) =>
            input.members.findIndex(member => member.participant === participant);
          const call: AtomicCommerceContext["call"] = Effect.fn("LogicalCommerce.workflowCall")((participant, command, args) =>
            lifetime.nested(lifetime.context, id, child => Effect.gen(function* () {
              const ordinal = sourceFor(participant);
              const member = input.members[ordinal], state = states[ordinal], admission = admissions[ordinal];
              const definition = getCommerceCommand(command);
              if (member === undefined || state === undefined || admission === undefined || definition === undefined ||
                !member.commands.includes(command) || !hasLogicalParticipantAttemptAdmission(admission, input.attempt, definition.name))
                return yield* Effect.fail(commerceError("invalidAuthority"));
              const first = state.tables[0];
              if (first === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
              const localEvents: Json[] = [];
              const cursor = working.activityCursor();
              const sourceTables = new Map(state.tables.map(table => [table.localName, table.tableId]));
              const invoke = (manager: typeof child, nested: CommerceCommand, value: Json): Effect.Effect<
                Readonly<{ input: Json; result: Json }>, ReturnType<typeof commerceError>> =>
                Effect.gen(function* () {
                  const selected = getCommerceCommand(nested);
                  if (selected === undefined || !member.commands.includes(nested) ||
                    !hasLogicalParticipantAttemptAdmission(admission, input.attempt, selected.name))
                    return yield* Effect.fail(commerceError("invalidAuthority"));
                  const captured = yield* Effect.fromResult(captureCommerceJsonData(value, lifetime.remainingBytes()));
                  yield* Effect.fromResult(lifetime.charge(captured.bytes));
                  const store = yield* working.relationalTable(manager, id, first.localName);
                  const context = makeCommerceCommandContext(lifetime, {
                    store, resources,
                    table: (current, name) => sourceTables.has(name)
                      ? working.relationalTable(current, id, name) : Effect.fail(commerceError("invalidAuthority")),
                    transactionTime: current => working.readTransactionTime(current, id),
                    planSetNull: (current, selection) => {
                      const sourceTableId = sourceTables.get(selection.sourceTable), targetTableId = sourceTables.get(selection.targetTable);
                      return sourceTableId === undefined || targetTableId === undefined
                        ? Effect.fail(commerceError("invalidAuthority"))
                        : working.planSetNull(current, id, { sourceTableId, sourceColumn: selection.sourceColumn,
                          targetTableId, targetColumn: selection.targetColumn, targetKey: selection.targetKey });
                    },
                    planReferenceReplacement: (current, selection) => {
                      const sourceTableId = sourceTables.get(selection.sourceTable), targetTableId = sourceTables.get(selection.targetTable);
                      return sourceTableId === undefined || targetTableId === undefined
                        ? Effect.fail(commerceError("invalidAuthority"))
                        : working.planReferenceReplacement(current, id, { sourceTableId, sourceColumn: selection.sourceColumn,
                          targetTableId, targetColumn: selection.targetColumn, targetKey: selection.targetKey,
                          desiredKeys: selection.desiredKeys });
                    },
                  }, id, manager, (current, nestedCommand, nestedInput) =>
                    invoke(current, nestedCommand, nestedInput).pipe(Effect.map(entry => entry.result)),
                  (current, event) => lifetime.operation(current, id, "write", Effect.gen(function* () {
                    if (member.events === undefined) return yield* Effect.fail(commerceError("unadmittedEvent"));
                    const message = yield* eventCapture.captureSelected(member.events, event);
                    localEvents.push(message); eventSources.push(state.sourceKey);
                  })));
                  const result = yield* selected.run(context, captured.value);
                  const output = yield* Effect.fromResult(captureCommerceJsonData(result, lifetime.remainingBytes()));
                  yield* Effect.fromResult(lifetime.charge(output.bytes));
                  return Object.freeze({ input: captured.value, result: output.value });
                });
              const observed = yield* invoke(child, command, args);
              const snapshot = yield* working.activitySnapshot();
              const activity = yield* projectLogicalCommerceActivity(names, {
                ...snapshot,
                attempts: snapshot.attempts.slice(cursor.attempts).map(attempt =>
                  Object.freeze({ ...attempt, ordinal: attempt.ordinal - cursor.attempts })),
                lifecycle: snapshot.lifecycle.slice(cursor.lifecycle).map(observation => Object.freeze({ ...observation,
                  attemptOrdinal: observation.attemptOrdinal === null ? null : observation.attemptOrdinal - cursor.attempts })),
                setNull: snapshot.setNull.slice(cursor.setNull),
                referenceReplacements: snapshot.referenceReplacements.slice(cursor.referenceReplacements),
              });
              const localActivity = { ...activity, observedRows: activity.observedRows.filter(row =>
                state.tables.some(table => table.localName === row.table)) };
              if (definition.mode === "read" && (localActivity.mutations.length !== 0 || localActivity.lifecycle.length !== 0 ||
                localActivity.setNull.length !== 0 || localActivity.referenceReplacements.length !== 0 || localEvents.length !== 0))
                return yield* Effect.fail(commerceError("receiptMismatch"));
              yield* member.validateLogicalCall?.({ commandName: definition.name, mode: definition.mode,
                input: observed.input, result: observed.result, events: localEvents, fromAttempt: 0, toAttempt: localActivity.mutations.length,
                fromLifecycle: 0, toLifecycle: localActivity.lifecycle.length }, localActivity, command) ?? Effect.void;
              calls.push(Object.freeze({ participant, command, ...observed }));
              return observed.result;
            }), getCommerceCommand(command)?.mode));
          const context: AtomicCommerceContext = Object.freeze({
            eventGroupId: group,
            checkpoint: lifetime.operation(lifetime.context, id, "read", Effect.void),
            capture: (value: unknown) => lifetime.operation(lifetime.context, id, "read", Effect.gen(function* () {
              const captured = yield* Effect.fromResult(captureCommerceJsonData(value, lifetime.remainingBytes()));
              yield* Effect.fromResult(lifetime.charge(captured.bytes));
              return captured.value;
            })),
            call,
            emit: (contract: CommerceEventContract, message: unknown) => lifetime.operation(lifetime.context, id, "write",
              eventCapture.capture(contract, message).pipe(Effect.tap(() => Effect.sync(() => { eventSources.push(null); })), Effect.asVoid)),
            refuse: (error: CommerceTransactionError) => lifetime.operation(lifetime.context, id, "write", Effect.fail(error)),
          });
          let consumed = false;
          const close = Effect.gen(function* () {
            if (consumed) return yield* Effect.fail(commerceError("closed"));
            yield* lifetime.seal;
            const changes = yield* working.close();
            const captured = yield* consumeCommerceEvents(yield* eventCapture.close(calls), lifetime);
            if (captured.values.length !== eventSources.length) return yield* Effect.fail(commerceError("receiptMismatch"));
            consumed = true;
            return Object.freeze({ changes, eventIntents: Object.freeze(captured.values.map((intent, index) =>
              Object.freeze({ sourceKey: eventSources[index]!, intent }))),
              workBytes: resources.commandBytes - lifetime.remainingBytes(), workCalls: lifetime.usedCalls() });
          }).pipe(Effect.ensuring(lifetime.close));
          return Object.freeze({ context, close, abort: lifetime.close, withinDeadline: lifetime.withinDeadline,
            currentUsage: () => Object.freeze({ workBytes: resources.commandBytes - lifetime.remainingBytes(),
              workCalls: lifetime.usedCalls() }) });
        }).pipe(Effect.onError(() => lifetime.close));
      })).pipe(Effect.mapError(projectCommerceRequestFailure));
});
