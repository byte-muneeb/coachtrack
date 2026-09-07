import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import api from "./routes";
import { login } from "./routes/auth";
import { authRequired } from "./auth";
import { tenantContext } from "./tenant";
import { ensureSchemaOnce } from "./db";
import { autoGenerateHandler } from "./routes/internal";

dotenv.config();

const app = express();

// Restrict CORS to the configured frontend origin(s). CORS_ORIGIN is a
// comma-separated allow-list; if unset (local dev), all origins are allowed.
const corsOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));

// Baseline security headers on every API response.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json());
app.use(morgan("dev"));

// Lightweight per-IP rate limit for login (brute-force slowdown). In-memory, so
// on serverless it is per-instance — good enough as a speed bump; use a shared
// store (e.g. Upstash) for fleet-wide limits in high-scale production.
const loginHits = new Map<string, { count: number; reset: number }>();
function loginLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const WINDOW = 15 * 60 * 1000, MAX = 20, now = Date.now();
  const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "unknown").trim();
  const e = loginHits.get(ip);
  if (!e || now > e.reset) { loginHits.set(ip, { count: 1, reset: now + WINDOW }); return next(); }
  e.count += 1;
  if (e.count > MAX) {
    res.setHeader("Retry-After", String(Math.ceil((e.reset - now) / 1000)));
    return res.status(429).json({ error: "Too many login attempts. Please try again in a few minutes." });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "coachtrack-api" });
});

// Ensure the DB schema exists before any data route runs. Memoized, so it's a
// no-op after the first request on a warm (serverless) instance. /health above
// stays fast and DB-free for uptime checks.
app.use((_req, res, next) => {
  ensureSchemaOnce().then(() => next()).catch(next);
});

// Vercel Cron endpoint — public path guarded by CRON_SECRET, mounted BEFORE the
// authRequired block so the scheduler can reach it without a user token.
app.post("/api/internal/auto-generate", autoGenerateHandler);

app.post("/api/auth/login", loginLimiter, login); // public (rate-limited)
app.use("/api", authRequired, tenantContext, api); // everything else requires a valid token + tenant context

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);

export default app;
