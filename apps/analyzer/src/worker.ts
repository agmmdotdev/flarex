import { Effect, Result } from "effect";
import { makePrivateAnalyzerHandshakeHostV1 } from "./Handshake";
import { installedPrivateAnalyzerIdentityV1 } from "./Identity";
import { makePrivateAnalyzerVerificationHostV1 } from "./Verification";

const installed = installedPrivateAnalyzerIdentityV1();
const configured = makePrivateAnalyzerHandshakeHostV1({
  configuration: installed.configuration,
  identity: installed.identity,
});
if (Result.isFailure(configured)) {
  throw new Error("Private analyzer host configuration is invalid.");
}
const handshakeHost = configured.success;
const verificationHost = makePrivateAnalyzerVerificationHostV1({
  configuration: installed.configuration,
  identity: installed.identity,
});

export default {
  fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const operation =
      pathname === installed.configuration.verification.path
        ? verificationHost.handle(request)
        : handshakeHost.handle(request);
    return Effect.runPromise(operation, { signal: request.signal });
  },
};
