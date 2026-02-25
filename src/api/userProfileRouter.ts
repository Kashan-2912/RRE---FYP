/**
 * User Profile API Routes
 *
 * Endpoints:
 *   POST /api/user-profiles      – Create or update a user profile
 *   GET  /api/user-profiles/:id  – Get a specific profile by ID
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import * as userProfileService from "../resources/userProfileService";

export const userProfileRouter = Router();

// ── Validation Schema ──────────────────────────────────────

const userProfileSchema = z.object({
  skill: z.string().min(1, "Skill is required"),
  content_preferences: z.array(z.string()).min(1, "At least one preference is required"),
  learning_pace: z.string().min(1, "Learning pace is required"),
  session_length: z.string().min(1, "Session length is required"),
  difficulty_preference: z.string().min(1, "Difficulty preference is required"),
  proficiency_score: z.number().min(0).max(10),
});

// ── Routes ─────────────────────────────────────────────────

/**
 * POST /api/user-profiles
 * Create a new learning profile for a user.
 */
userProfileRouter.post("/user-profiles", async (req: Request, res: Response) => {
  try {
    const parseResult = userProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid input",
        details: parseResult.error.errors,
      });
      return;
    }

    const { 
      skill, 
      content_preferences, 
      learning_pace, 
      session_length, 
      difficulty_preference, 
      proficiency_score 
    } = parseResult.data;

    const profile = await userProfileService.saveUserProfile({
      skill,
      contentPreferences: content_preferences,
      learningPace: learning_pace,
      sessionLength: session_length,
      difficultyPreference: difficulty_preference,
      proficiencyScore: proficiency_score,
    });

    res.status(201).json({
      success: true,
      message: "User profile created successfully",
      profile,
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to create user profile",
      message: error.message,
    });
  }
});

/**
 * GET /api/user-profiles/:id
 * Retrieve a specific profile by ID.
 */
userProfileRouter.get("/user-profiles/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const profile = await userProfileService.getUserProfile(id);

    if (!profile) {
      res.status(404).json({
        error: "Profile not found",
        message: `No profile found with ID: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      profile,
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to retrieve user profile",
      message: error.message,
    });
  }
});
