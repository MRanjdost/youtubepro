/**
 * Creates a fully-wired Express app (routes registered, no port open).
 * Used by integration tests via supertest — no need to spawn a child process.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { resetRateLimit } from "./rate-limit";

export async function createAppWithRoutes() {
  const app = express();

  app.disable("x-powered-by");
  // Trust proxy so supertest's X-Forwarded-For header is respected by rate limiter
  app.set("trust proxy", true);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });

  app.use(express.json({ limit: "18mb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));

  const httpServer = createServer(app);
  // Reset rate limiter singleton state before registering routes so integration tests start clean
  resetRateLimit();
  const { registerRoutes } = await import("./routes");
  await registerRoutes(httpServer, app);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    if (!res.headersSent) {
      res.status(status).json({ message: "Internal Server Error" });
    }
  });

  return app;
}