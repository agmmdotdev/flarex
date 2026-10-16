import type { IDistributedTransactionStorage } from "./transaction/datastore/abstract-storage"

/** Native execution ports are supplied by the trusted outer attempt owner.
 * They contain no open SQL transaction and are never serialized in checkpoints. */
export interface NativeWorkflowRuntime {
  readonly storage: IDistributedTransactionStorage
  readonly clock: { readonly now: () => number }
  readonly background: {
    /** Start immediately, retain every resulting Promise, and drain/revoke all
     * work before closing the owning attempt. No process-detached execution. */
    readonly execute: (work: () => Promise<unknown>) => void
  }
}

/** The selected profile requires an explicit resolver. It does not construct an
 * Awilix container or discover globally loaded modules. */
export interface WorkflowContainer {
  resolve<Value = unknown>(name: string, options?: { allowUnregistered?: boolean }): Value
}

export function requireNativeWorkflowRuntime(runtime: NativeWorkflowRuntime | undefined): NativeWorkflowRuntime {
  if (runtime === undefined) throw new Error("An explicit native workflow execution runtime is required")
  return runtime
}
