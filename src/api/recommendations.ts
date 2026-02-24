/**
 * Recommendation API Routes
 *
 * Endpoints:
 *   POST /api/recommendations   – Get personalized recommendations
 *   POST /api/resources/ingest  – Trigger dataset building for a skill
 *   GET  /api/resources/stats   – Get resource statistics
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { generateRecommendations, RecommendationInput } from "../engine/recommendationEngine";
import { buildDatasetForSkill, buildFullDataset } from "../resources/datasetBuilder";
import { getResourceStats } from "../resources/ingestionService";

export const recommendationRouter = Router();

// ── Input Validation Schema ────────────────────────────────

const recommendationSchema = z.object({
  skill_selected: z.string().min(1, "Skill is required"),
  content_preferences: z.array(z.string()).min(1, "At least one content preference is required"),
  learning_pace: z.enum(["slow", "medium", "fast"]),
  session_length: z.enum(["short", "regular", "dedicated"]),
  difficulty_preference: z.enum(["beginner", "moderate", "advanced"]),
  proficiency_score: z.number().min(0).max(10, "Proficiency score must be between 0 and 10"),
});

const ingestSchema = z.object({
  skill: z.string().min(1, "Skill is required").optional(),
  skills: z.array(z.string()).optional(),
  max_per_source: z.number().min(1).max(50).optional().default(15),
});

// ── POST /api/recommendations ──────────────────────────────

recommendationRouter.post("/recommendations", async (req: Request, res: Response) => {
  try {
    // Validate input
    const parseResult = recommendationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid input",
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }

    const input: RecommendationInput = parseResult.data;

    // Generate recommendations
    const recommendations = await generateRecommendations(input);

    res.json({
      success: true,
      input: {
        skill: input.skill_selected,
        proficiency_score: input.proficiency_score,
        content_preferences: input.content_preferences,
        learning_pace: input.learning_pace,
        session_length: input.session_length,
        difficulty_preference: input.difficulty_preference,
      },
      count: recommendations.length,
      recommendations,
    });
  } catch (error: any) {
    console.error("❌ Recommendation error:", error);
    res.status(500).json({
      error: "Failed to generate recommendations",
      message: error.message,
    });
  }
});

// ── POST /api/resources/ingest ─────────────────────────────

recommendationRouter.post("/resources/ingest", async (req: Request, res: Response) => {
  try {
    const parseResult = ingestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid input",
        details: parseResult.error.errors,
      });
      return;
    }

    const { skill, skills, max_per_source } = parseResult.data;

    if (skill) {
      // Ingest for a single skill
      const result = await buildDatasetForSkill(skill, max_per_source);
      res.json({
        success: true,
        message: `Dataset built for "${skill}"`,
        result,
      });
    } else if (skills && skills.length > 0) {
      // Ingest for multiple skills
      const results = await buildFullDataset(skills, max_per_source);
      res.json({
        success: true,
        message: `Dataset built for ${skills.length} skills`,
        results,
      });
    } else {
      // Build full default dataset
      const results = await buildFullDataset();
      res.json({
        success: true,
        message: "Full dataset build complete",
        results,
      });
    }
  } catch (error: any) {
    console.error("❌ Ingestion error:", error);
    res.status(500).json({
      error: "Failed to ingest resources",
      message: error.message,
    });
  }
});

// ── GET /api/resources/stats ───────────────────────────────

recommendationRouter.get("/resources/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getResourceStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    console.error("❌ Stats error:", error);
    res.status(500).json({
      error: "Failed to get resource stats",
      message: error.message,
    });
  }
});
