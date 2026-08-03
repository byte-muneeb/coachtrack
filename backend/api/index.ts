// Vercel serverless entrypoint.
//
// The entire Express app is exported as the function handler (an Express app is
// itself a (req, res) handler). `backend/vercel.json` rewrites every path to
// this function, so Express does all the routing — /health, /api/auth/login,
// /api/*, and the /api/internal/auto-generate cron endpoint.
import app from "../src/app";

export default app;
