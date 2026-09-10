import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";

declare const graphReadBrand: unique symbol;
export interface GraphReadCommand extends CommerceCommand { readonly [graphReadBrand]: true }
const reads = new WeakSet<object>();

/** Marks adapter read definitions without publishing the core's command inspector.
 * The original token still belongs to core; this marker only checks graph setup. */
export function defineGraphReadCommand(name: string, run: Parameters<typeof defineCommerceCommand>[2]): GraphReadCommand {
  // SAFETY: this factory always requests core's read mode and retains its token.
  const command = defineCommerceCommand(name, "read", run) as GraphReadCommand;
  reads.add(command);
  return command;
}

export const isGraphReadCommand = (command: CommerceCommand): command is GraphReadCommand => reads.has(command);
