import { WorkerEntrypoint } from "cloudflare:workers";
import {
  runApplicationAnalysisHost,
  type ApplicationAnalysisHostEnv,
  type ApplicationAnalysisHostResult,
} from "./ApplicationAnalysisHost";

export class FlarexApplicationAnalysisHost
  extends WorkerEntrypoint<ApplicationAnalysisHostEnv> {
  analyze(input: unknown): Promise<ApplicationAnalysisHostResult> {
    return runApplicationAnalysisHost(this.env, input);
  }
}
