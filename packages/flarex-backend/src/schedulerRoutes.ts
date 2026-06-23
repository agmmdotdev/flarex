import { schedulerObjectName } from "./routing";

export const LIVE_QUERY_SCHEDULER_NAME = schedulerObjectName("live-query-deliveries");

export const LIVE_QUERY_SCHEDULER_INTERNAL_PATHS = {
  reconcileDeliveries: "/reconcile/live-query-deliveries",
  deadLetterDeliveries: "/dead-letter/live-query-deliveries",
  cleanupConnections: "/cleanup/live-query-connections",
  rerunSubscriptions: "/rerun/live-query-subscriptions",
  continueReruns: "/continue-live-query-reruns",
} as const;

export type LiveQuerySchedulerInternalPath =
  typeof LIVE_QUERY_SCHEDULER_INTERNAL_PATHS[keyof typeof LIVE_QUERY_SCHEDULER_INTERNAL_PATHS];
