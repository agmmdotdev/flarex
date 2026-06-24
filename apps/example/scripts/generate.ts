import { runFlarexDevCli } from "flarex-dev/cli";

process.exitCode = await runFlarexDevCli({
  argv: ["codegen"],
});
