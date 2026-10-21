import { Effect } from "effect";
import {
  createDrizzleEventSubscriber, registerDrizzleEventSubscriber, dispatchCreatedMutations,
  dispatchDrizzleMutationRows, dispatchDrizzleMutationEvent, dispatchCascadedUpdateMutations,
} from "@medusajs/drizzle/mutation-events";
import type { CommercePromiseOwner } from "../module/promise-owner";

/** One instance per request-owned repository family. Medusa owns subscriber
 * invocation, grouping, suppression and duplicate accounting. The caller owns
 * event admission and core receipt validation; registration alone grants no
 * publication authority. This instance neither runs nor settles a transaction. */
export function commerceMutationEvents(owner: CommercePromiseOwner) {
  const subscribed = new WeakSet<object>();
  const ownedSubscribers = new WeakSet<object>();
  const invoke = Effect.fn("CommerceEvents.invoke")((work: () => Promise<void>) => owner.invoke(work));

  return {
    createSubscriber: (...args: Parameters<typeof createDrizzleEventSubscriber>) => {
      const subscriber = createDrizzleEventSubscriber(...args);
      ownedSubscribers.add(subscriber);
      return subscriber;
    },
    registerSubscriber: (...args: Parameters<typeof registerDrizzleEventSubscriber>) => {
      registerDrizzleEventSubscriber(...args);
      subscribed.add(args[0]);
    },
    isSubscribed: (context: object) => subscribed.has(context),
    ownsSubscriber: (subscriber: object) => ownedSubscribers.has(subscriber),
    dispatch: Effect.fn("CommerceEvents.dispatch")((...args: Parameters<typeof dispatchDrizzleMutationEvent>) =>
      invoke(() => dispatchDrizzleMutationEvent(...args))),
    created: Effect.fn("CommerceEvents.created")((...args: Parameters<typeof dispatchCreatedMutations>) =>
      invoke(() => dispatchCreatedMutations(...args))),
    rows: Effect.fn("CommerceEvents.rows")((...args: Parameters<typeof dispatchDrizzleMutationRows>) =>
      invoke(() => dispatchDrizzleMutationRows(...args))),
    cascades: Effect.fn("CommerceEvents.cascades")((...args: Parameters<typeof dispatchCascadedUpdateMutations>) =>
      invoke(() => dispatchCascadedUpdateMutations(...args))),
  };
}
