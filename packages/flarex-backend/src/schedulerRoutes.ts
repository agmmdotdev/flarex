import { schedulerObjectName } from "./routing";

const LIVE_QUERY_SCHEDULER_COMPATIBILITY_ID = "live-query-deliveries";

export const LIVE_QUERY_SCHEDULER_NAME = schedulerObjectName(
  LIVE_QUERY_SCHEDULER_COMPATIBILITY_ID,
);

export const LIVE_QUERY_SCHEDULER_INTERNAL_PATHS = {
  reconcileDeliveries: "/reconcile/live-query-deliveries",
  reconcileConnections: "/reconcile/live-query-connections",
  deadLetterDeliveries: "/dead-letter/live-query-deliveries",
  cleanupConnections: "/cleanup/live-query-connections",
  rerunSubscriptions: "/rerun/live-query-subscriptions",
  continueReruns: "/continue-live-query-reruns",
  continueConnectionCleanup: "/continue-live-query-connection-cleanup",
} as const;

export type LiveQuerySchedulerInternalPath =
  typeof LIVE_QUERY_SCHEDULER_INTERNAL_PATHS[keyof typeof LIVE_QUERY_SCHEDULER_INTERNAL_PATHS];
