import app from "./app";
import { ensureSchemaOnce } from "./db";
import { runAutoGenerateIfDue } from "./routes/internal";

const PORT = Number(process.env.PORT) || 4000;

// --- Local dev scheduler ---
// On Vercel this never runs (the serverless entrypoint doesn't call listen);
// there, Vercel Cron hits POST /api/internal/auto-generate instead. For local
// `npm run dev`, check on boot and every 6 hours.
async function maybeAutoGenerate() {
  try {
    const out = await runAutoGenerateIfDue();
    if (out.ran) console.log(`Auto-generated ${out.created} voucher(s) for ${out.month}`);
  } catch (e) {
    console.error("Auto-generation check failed:", e);
  }
}

async function start() {
  try {
    await ensureSchemaOnce();
    app.listen(PORT, () => {
      console.log(`CoachTrack API listening on http://localhost:${PORT}`);
      maybeAutoGenerate();
      setInterval(maybeAutoGenerate, 6 * 60 * 60 * 1000);
    });
  } catch (err) {
    console.error("Failed to start — DB error:", err);
    process.exit(1);
  }
}

start();
