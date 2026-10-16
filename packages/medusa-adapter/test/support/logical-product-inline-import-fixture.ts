import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { makeTaskExecutionPrincipalReferenceV1, prepareTrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { decodeTaskDurationMsV1 } from "@flarex/durable-task/internal/run-attempt-v1";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { frameworkSchemaTargetSnapshot } from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { createPGliteDeadlineOwnedTaskRunAttemptTarget } from "../../../persistence-postgres/src/database/pglite";
import { createPostgresTaskExternalEffectAuthorityResource } from "../../../persistence-postgres/src/tasks/postgresTaskExternalEffectAuthority";
import { makeTrustedWorkflowCheckpointStore } from "../../../persistence-postgres/src/tasks/trustedWorkflowCheckpoint";
import { readyTaskRunAggregateV1 } from "../../../persistence-postgres/test/tasks/taskSystemRunAttemptStoreTestSupport";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { prepareProductBatchTaskWorkflow } from "../../src/workflows/product/batch";
import { makeProductInlineImportInterpreter } from "../../src/workflows/product/import-inline";
import { makeProductInlineImportTask } from "../../src/workflows/product/import-inline-task";
import { productInlineImportPolicy, productInlineImportProfile } from "../../src/workflows/product/import-inline-input";
import { prepareDurableNotification } from "../../src/workflow/durable-notification";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import type { TaskAtomicCommerceHost } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLogicalProductBatch } from "./logical-product-batch-fixture";
import { notificationLogicalSource, prepareLogicalNotificationHost } from "./logical-notification-fixture";

const hash = (bytes: Uint8Array) => Effect.sync(() => new Uint8Array(createHash("sha256").update(bytes).digest()));
export const inlineImportSubscriber = { id: "native-inline-import", revision: "d".repeat(64) };
type Task = Parameters<typeof makeProductInlineImportTask>[0];
type CheckpointStore = ReturnType<typeof makeTrustedWorkflowCheckpointStore>;
interface PreparedImport {
  readonly driver: Effect.Success<ReturnType<typeof makeProductInlineImportTask>>;
  readonly interpreter: Effect.Success<ReturnType<typeof makeProductInlineImportInterpreter>>;
  readonly notifications: Effect.Success<ReturnType<typeof prepareDurableNotification>>;
  readonly batch: Effect.Success<ReturnType<typeof prepareProductBatchTaskWorkflow>>;
}
export interface LogicalProductInlineImportFixture {
  readonly connected: Awaited<ReturnType<typeof prepareLogicalProductBatch>>;
  readonly notification: Awaited<ReturnType<typeof prepareLogicalNotificationHost>>;
  readonly task: Task;
  readonly prepare: (decorateCheckpointStore?: (store: CheckpointStore) => CheckpointStore) => Promise<PreparedImport>;
}

/** One complete Product/Notification candidate and genuine Task resources.
 * All business seeds and writes delegate to their actual native owners. */
export async function logicalProductInlineImportFixture(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, logger: Logger): Promise<LogicalProductInlineImportFixture> {
  const source = await notificationLogicalSource();
  const connected = await prepareLogicalProductBatch(driver, close, { additionalSources: [source.source] });
  const fixture = connected.fixture;
  const notification = await prepareLogicalNotificationHost(fixture, source, logger);
  const bootstrap = await Effect.runPromise(makeCommerceHost(notification.hostInput));
  try { await Effect.runPromise(bootstrap.run(bootstrap.newRequestKey(), notification.runtime.registerLocalProvider,
    { id: "local", handle: "local", name: "local", is_enabled: true, channels: ["feed"] })); }
  finally { await Effect.runPromise(bootstrap.close); }
  const located = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId: fixture.deploymentId,
    scopeId: fixture.hostInput.scopeId }, fixture.hostInput.authority));
  const snapshot = frameworkSchemaTargetSnapshot(fixture.bindingTarget);
  if (snapshot === undefined) throw new Error("Missing genuine import target");
  const persistence = fixture.persistence;
  const deadlines = { connectionTimeoutMilliseconds: 500, lockTimeoutMilliseconds: 1000,
    statementTimeoutMilliseconds: 4000, transactionTimeoutMilliseconds: 8000, settlementReserveMilliseconds: 10000 };
  const resource = "pool" in persistence ? Result.getOrThrow(createPostgresTaskExternalEffectAuthorityResource({
    connectionString: persistence.pool.options.connectionString, options: persistence.pool.options.options, max: 2,
  }, snapshot.physicalLocator, deadlines)) : undefined;
  if (resource !== undefined) close(resource.close);
  const target = "pool" in persistence ? resource?.lifecycleTarget :
    Result.getOrThrow(createPGliteDeadlineOwnedTaskRunAttemptTarget(persistence, snapshot.physicalLocator, deadlines));
  if (target === undefined) throw new Error("Missing deadline-owned import Task resource");
  const principalBytes = await Effect.runPromise(canonicalizeFlarexValueV1Effect({ version: 1, scopeId: located.authority.scopeId,
    executionIdentity: { kind: "user", user: { tokenIdentifier: "issuer|import", subject: "import", issuer: "issuer" } } }));
  const principal = Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(principalBytes.sha256, principalBytes.canonicalBytes.byteLength));
  const policy = readyTaskRunAggregateV1().boundPolicy;
  const binding = await Effect.runPromise(prepareTrustedWorkflowTaskBinding({ scopeId: located.authority.scopeId,
    workflowRevision: "a".repeat(64), adapterRevision: "b".repeat(64), executionProfile: productInlineImportProfile,
    executionPolicy: productInlineImportPolicy, principalSha256: encodeBytesToLowercaseHex(principal.sha256),
    boundPolicy: { ...policy, maximumDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(180_000)),
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(180_000)) } }, hash));
  const task: Task = { authority: located.authority, target, binding, principal,
    principalCanonicalBytes: principalBytes.canonicalBytes, sha256: hash };
  const execution: AtomicWorkflowExecution<TaskAtomicCommerceHost> = {
    identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition,
      executionIsolation: "scopeExclusive", taskBinding: binding }),
  };
  const prepare = async (decorateCheckpointStore?: (store: CheckpointStore) => CheckpointStore): Promise<PreparedImport> => {
    const batch = await Effect.runPromise(prepareProductBatchTaskWorkflow({ ...connected.options, execution,
      subscribers: [inlineImportSubscriber] }));
    close(() => Effect.runPromise(batch.close));
    const notifications = await Effect.runPromise(prepareDurableNotification({ execution,
      logicalStorage: notification.hostInput.logicalStorage, runtime: notification.runtime,
      revision: "c".repeat(64), subscribers: [inlineImportSubscriber], task, maximumCallbackMs: 1000 }));
    close(() => Effect.runPromise(notifications.close));
    const checkpointStore = makeTrustedWorkflowCheckpointStore(task);
    const interpreter = await Effect.runPromise(makeProductInlineImportInterpreter({
      checkpointStore: decorateCheckpointStore?.(checkpointStore) ?? checkpointStore, batch, notifications,
      runEffect: work => Effect.runPromise(work),
    }));
    const driver = await Effect.runPromise(makeProductInlineImportTask(task, interpreter));
    return { driver, interpreter, notifications, batch };
  };
  return { connected, notification, task, prepare };
}
