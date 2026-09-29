import { ProxyAgent, setGlobalDispatcher, Agent } from "undici";

export function applyGlobalProxy(proxyUrl?: string): void {
  if (proxyUrl && proxyUrl.trim().length > 0) {
    const dispatcher = new ProxyAgent({
      uri: proxyUrl.trim(),
      connectTimeout: 30_000,
      headersTimeout: 60_000,
      bodyTimeout: 120_000,
      keepAliveTimeout: 5_000,
    });
    setGlobalDispatcher(dispatcher);
    console.log(`[proxy] Global outbound proxy set to ${proxyUrl.trim()}`);
  } else {
    setGlobalDispatcher(new Agent());
    console.log(`[proxy] Outbound proxy disabled (direct connection)`);
  }
}

export function initProxyFromEnv(): void {
  const proxyUrl =
    process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy;
  if (proxyUrl && proxyUrl.trim().length > 0) {
    applyGlobalProxy(proxyUrl.trim());
  } else {
    // Ensure direct connection on boot when nothing configured
    setGlobalDispatcher(new Agent());
  }
}
