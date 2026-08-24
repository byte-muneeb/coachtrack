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

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

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

app.post("/api/auth/login", login); // public
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
