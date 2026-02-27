import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config/environment";
import { recommendationRouter } from "./api/recommendations";
import { userProfileRouter } from "./api/userProfileRouter";
import { roadmapRouter } from "./api/roadmapRouter";

const app = express();

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Rate limiting – max 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// ── Routes ─────────────────────────────────────────────────
app.use("/api", recommendationRouter);
app.use("/api", userProfileRouter);
app.use("/api", roadmapRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start Server ───────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`\n🚀 RRE MicroMono Backend running on http://localhost:${config.port}`);
  console.log(`   Health check: http://localhost:${config.port}/health`);
  console.log(`   Recommendations: POST http://localhost:${config.port}/api/recommendations\n`);
});

export default app;
