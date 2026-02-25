/**
 * Difficulty Mapper – maps proficiency scores to difficulty levels
 * and generates difficulty distribution mixes.
 *
 * Mapping (per spec):
 *   0–3   → Beginner
 *   4–6   → Intermediate
 *   7–8   → Advanced
 *   9–10  → Expert
 */

export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface DifficultyMix {
  primary: DifficultyLevel;
  distribution: Record<DifficultyLevel, number>; // weights summing to 1.0
}

/**
 * Map a proficiency score (0-10) to a primary difficulty level.
 */
export function mapProficiencyToLevel(score: number): DifficultyLevel {
  if (score <= 3) return "beginner";
  if (score <= 6) return "intermediate";
  if (score <= 8) return "advanced";
  return "expert";
}

/**
 * Get the recommended difficulty distribution mix based on proficiency score and learning pace.
 *
 * The primary level gets 60%, one level down gets 30%, and one level up gets 10%.
 * This ensures the user gets mostly appropriately-challenging content with some
 * review material and stretch goals.
 *
 * Learning Pace Adjustments:
 *   - "slow": Shifts weight toward simpler content (review).
 *   - "fast": Shifts weight toward more challenging content (stretch goals).
 */
export function getDifficultyMix(score: number, pace: string = "medium"): DifficultyMix {
  const primary = mapProficiencyToLevel(score);

  const baseMixes: Record<DifficultyLevel, Record<DifficultyLevel, number>> = {
    beginner: {
      beginner: 0.70,
      intermediate: 0.25,
      advanced: 0.05,
      expert: 0.00,
    },
    intermediate: {
      beginner: 0.10,
      intermediate: 0.60,
      advanced: 0.25,
      expert: 0.05,
    },
    advanced: {
      beginner: 0.00,
      intermediate: 0.10,
      advanced: 0.60,
      expert: 0.30,
    },
    expert: {
      beginner: 0.00,
      intermediate: 0.05,
      advanced: 0.30,
      expert: 0.65,
    },
  };

  const distribution = { ...baseMixes[primary] };

  // Adjust distribution based on learning pace
  if (pace === "slow") {
    // Shift 15% from stretch/on-target to review
    if (primary === "intermediate") {
      distribution.beginner += 0.15;
      distribution.intermediate -= 0.10;
      distribution.advanced -= 0.05;
    } else if (primary === "advanced") {
      distribution.intermediate += 0.15;
      distribution.advanced -= 0.10;
      distribution.expert -= 0.05;
    } else if (primary === "expert") {
      distribution.advanced += 0.15;
      distribution.expert -= 0.15;
    }
  } else if (pace === "fast") {
    // Shift 15% from review/on-target to stretch
    if (primary === "beginner") {
      distribution.intermediate += 0.15;
      distribution.beginner -= 0.15;
    } else if (primary === "intermediate") {
      distribution.advanced += 0.15;
      distribution.intermediate -= 0.10;
      distribution.beginner -= 0.05;
    } else if (primary === "advanced") {
      distribution.expert += 0.15;
      distribution.advanced -= 0.10;
      distribution.intermediate -= 0.05;
    }
  }

  return {
    primary,
    distribution,
  };
}

/**
 * Calculate difficulty match score for a resource based on the user's difficulty mix.
 * Returns a value between 0 and 1.
 */
export function calculateDifficultyMatchScore(
  resourceDifficulty: string,
  mix: DifficultyMix
): number {
  const normalized = resourceDifficulty.toLowerCase() as DifficultyLevel;
  return mix.distribution[normalized] ?? 0.1;
}

/**
 * Convert a percentage assessment score to proficiency score out of 10.
 * e.g., 71% → 7.1
 */
export function percentageToProficiency(percentage: number): number {
  return Math.round((percentage / 10) * 10) / 10;
}
