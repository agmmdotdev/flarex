import type {
  FlarexExecutorPersistence,
  ListOutboxEventsResult,
} from "./types";
import type {
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
} from "@flarex/persistence-postgres";

export async function listUndeliveredOutboxEvents(
  persistence: FlarexExecutorPersistence,
  input: ListUndeliveredOutboxEventsInput,
): Promise<ListOutboxEventsResult> {
  return await persistence.listUndeliveredOutboxEvents(input);
}

export async function markOutboxEventsDelivered(
  persistence: FlarexExecutorPersistence,
  input: MarkOutboxEventsDeliveredInput,
): Promise<MarkOutboxEventsDeliveredResult> {
  return await persistence.markOutboxEventsDelivered(input);
}
