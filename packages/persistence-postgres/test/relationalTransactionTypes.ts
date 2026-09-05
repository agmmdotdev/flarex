import { Effect } from "effect";
import { defineRelationalCommand } from "../src/relationalTransaction/host";
import type { RelationalCommand } from "../src/relationalTransaction/host";

const required = defineRelationalCommand(
  (_context, input: { required: string }) => Effect.succeed(input.required),
);
// @ts-expect-error A required command input cannot widen across the erased registry boundary.
const widened: RelationalCommand<object, string, never> = required;
void widened;
