import type { NextFunction, Request, Response } from "express";

export interface RateLimiterOptions {
  maxRequests?: number;
  windowMs?: number;
  now?: () => number;
  store?: Map<string, { count: number; resetTime: number }>;
  requestCount?: number;
}

// Internal store and request count for the default rate limiter (used when no options.store provided)
const defaultStore = new Map<string, { count: number; resetTime: number }>();
let defaultRequestCount = 0;

/**
 * Create a rate limiter middleware.
 * @param options - Configuration options
 * @returns Object containing the middleware and the store used (useful for testing/reset)
 */
export function createRateLimiter(options: RateLimiterOptions = {}) {
  const maxRequests = options.maxRequests ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const store = options.store ?? defaultStore;
  let requestCount = options.requestCount ?? defaultRequestCount;

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const token = req.ip || req.socket.remoteAddress || "anonymous";
    const timestamp = now();
    requestCount += 1;
    if (requestCount % 256 === 0 || store.size >= 1_000) {
      for (const [storedToken, storedEntry] of Array.from(store.entries())) {
        if (timestamp >= storedEntry.resetTime) store.delete(storedToken);
      }
    }
    if (store.size >= 10_000 && !store.has(token)) {
      const oldestToken = store.keys().next().value;
      if (oldestToken) store.delete(oldestToken);
    }
    let entry = store.get(token);

    if (!entry || timestamp >= entry.resetTime) {
      entry = { count: 1, resetTime: timestamp + windowMs };
      store.set(token, entry);
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetTime - timestamp) / 1_000));
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: "Too many requests. Please wait before trying again.",
        retryAfter,
      });
    }

    entry.count += 1;
    next();
  };

  return { middleware, store };
}

// Export for testing: allow resetting the default store and request count
export { defaultStore as rateLimitStore, defaultRequestCount as rateLimitRequestCount };
export function resetRateLimit() {
  defaultStore.clear();
  defaultRequestCount = 0;
}