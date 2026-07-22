import { Effect, Result } from "effect";
import { makePrivateAnalyzerHandshakeHostV1 } from "./Handshake";
import { installedPrivateAnalyzerIdentityV1 } from "./Identity";

const installed = installedPrivateAnalyzerIdentityV1();
const configured = makePrivateAnalyzerHandshakeHostV1({
  configuration: installed.configuration,
  identity: installed.identity,
});
if (Result.isFailure(configured)) {
  throw new Error("Private analyzer host configuration is invalid.");
}
const host = configured.success;

export default {
  fetch(request: Request): Promise<Response> {
    return Effect.runPromise(host.handle(request), { signal: request.signal });
  },
};
