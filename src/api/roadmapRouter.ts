/**
 * Roadmap API Routes
 *
 * Endpoints:
 *   POST /api/roadmap  – Generate a personalized learning roadmap
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { generateRoadmap } from "../engine/roadmapGenerator";

export const roadmapRouter = Router();

// ── Input Validation Schema ────────────────────────────────

const roadmapSchema = z.object({
  skill_selected: z.string().min(1, "Skill is required"),
  content_preferences: z.array(z.string()).min(1, "At least one content preference is required"),
  learning_pace: z.enum(["slow", "medium", "fast"]),
  session_length: z.enum(["short", "regular", "dedicated"]),
  difficulty_preference: z.enum(["beginner", "moderate", "advanced"]),
  proficiency_score: z.number().min(0).max(10, "Proficiency score must be between 0 and 10"),
});

// ── POST /api/roadmap ──────────────────────────────────────

roadmapRouter.post("/roadmap", async (req: Request, res: Response) => {
  try {
    // Validate input
    const parseResult = roadmapSchema.safeParse(req.body);
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

    const data = parseResult.data;

    // Generate roadmap
    const roadmap = await generateRoadmap({
      skill: data.skill_selected,
      contentPreferences: data.content_preferences,
      learningPace: data.learning_pace,
      sessionLength: data.session_length,
      difficultyPreference: data.difficulty_preference,
      proficiencyScore: data.proficiency_score,
    });

    res.json({
      success: true,
      roadmap,
    });
  } catch (error: any) {
    console.error("❌ Roadmap generation error:", error);
    res.status(500).json({
      error: "Failed to generate roadmap",
      message: error.message,
    });
  }
});
