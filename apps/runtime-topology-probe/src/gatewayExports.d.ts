export {};

declare global {
  interface ExecutionContext<Props = unknown> {
    readonly exports: Cloudflare.Exports;
  }

  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("./gatewayWorker");
      durableNamespaces: "ProbeSessionDO";
    }
  }
}
