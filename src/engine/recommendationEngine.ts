/**
 * Recommendation Engine – the main orchestrator that combines all
 * recommendation signals to produce personalized resource recommendations.
 *
 * Pipeline:
 *   1. Build query from user input
 *   2. Map proficiency to difficulty mix
 *   3. Generate query embedding
 *   4. Semantic vector search (retrieve candidates)
 *   5. Apply hybrid ranking formula
 *   6. Generate explanations
 *   7. Return top 10 ranked results
 */

import { generateEmbedding, buildQueryText } from "../vector/embeddingService";
import { searchSimilarResources, VectorSearchFilters } from "../vector/vectorSearch";
import { getDifficultyMix, DifficultyMix } from "./difficultyMapper";
import { rankResources, RankedResource } from "./rankingEngine";
import { config } from "../config/environment";

// ── Types ──────────────────────────────────────────────────

export interface RecommendationInput {
  skill_selected: string;
  content_preferences: string[];
  learning_pace: "slow" | "medium" | "fast";
  session_length: "short" | "regular" | "dedicated";
  difficulty_preference: "beginner" | "moderate" | "advanced";
  proficiency_score: number; // 0-10
}

export interface RecommendationOutput {
  title: string;
  type: string;
  url: string;
  difficulty: string;
  estimated_time: string;
  source: string;
  recommendation_score: number;
  reason: string;
  tags: string[];
}

// ── Explanation Generator ──────────────────────────────────

function generateExplanation(
  resource: RankedResource,
  input: RecommendationInput,
  mix: DifficultyMix
): string {
  const reasons: string[] = [];

  // Semantic match
  if (resource.scores.semantic >= 0.7) {
    reasons.push(`highly relevant to ${input.skill_selected}`);
  } else if (resource.scores.semantic >= 0.5) {
    reasons.push(`relevant to ${input.skill_selected}`);
  }

  // Format match
  if (resource.scores.format >= 0.8) {
    reasons.push(`matches your preferred ${resource.type} format`);
  }

  // Difficulty match
  if (resource.difficulty === mix.primary) {
    reasons.push(`matches your ${mix.primary} skill level`);
  } else if (resource.scores.difficulty >= 0.2) {
    reasons.push(`provides a ${resource.difficulty}-level challenge`);
  }

  // Quality
  if (resource.scores.quality >= 0.7) {
    reasons.push("high-quality resource");
  }

  // Recency
  if (resource.scores.recency >= 0.8) {
    reasons.push("recently published");
  }

  // Session length hint
  if (input.session_length === "short" && resource.duration) {
    reasons.push("suitable for short study sessions");
  } else if (input.session_length === "dedicated" && resource.duration) {
    reasons.push("ideal for dedicated study blocks");
  }

  if (reasons.length === 0) {
    reasons.push(`related to ${input.skill_selected}`);
  }

  return "Recommended because it " + reasons.join(", ") + ".";
}

// ── Session Duration Filtering ─────────────────────────────

function parseDurationMinutes(duration: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+)\s*min/i);
  if (match) return parseInt(match[1], 10);
  const hourMatch = duration.match(/(\d+)\s*hour/i);
  if (hourMatch) return parseInt(hourMatch[1], 10) * 60;
  return null;
}

function isSessionLengthCompatible(
  duration: string | null,
  sessionLength: string
): boolean {
  const minutes = parseDurationMinutes(duration);
  if (minutes === null) return true; // no duration info, don't filter

  switch (sessionLength) {
    case "short":
      return minutes <= 20;
    case "regular":
      return minutes <= 60;
    case "dedicated":
      return true; // any length is fine
    default:
      return true;
  }
}

// ── Main Recommendation Function ───────────────────────────

/**
 * Generate personalized resource recommendations.
 */
export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationOutput[]> {
  console.log(`\n🔍 Generating recommendations for: ${input.skill_selected}`);
  console.log(`   Preferences: ${input.content_preferences.join(", ")}`);
  console.log(`   Proficiency: ${input.proficiency_score}/10`);

  // 1. Map proficiency to difficulty distribution
  const difficultyMix = getDifficultyMix(input.proficiency_score);
  console.log(`   Primary difficulty: ${difficultyMix.primary}`);

  // 2. Build query text for semantic search
  const queryText = buildQueryText({
    skill: input.skill_selected,
    contentPreferences: input.content_preferences,
    difficultyPreference: input.difficulty_preference,
  });
  console.log(`   Query: "${queryText}"`);

  // 3. Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);

  // 4. Build filters (retrieve broadly, then rank)
  const filters: VectorSearchFilters = {};

  // Retrieve more candidates than needed so ranking has room to work
  const candidateLimit = config.topN * 5;

  // 5. Semantic vector search
  const candidates = await searchSimilarResources(
    queryEmbedding,
    candidateLimit,
    filters
  );
  console.log(`   Found ${candidates.length} candidates from vector search`);

  if (candidates.length === 0) {
    console.log("   ⚠️ No resources found. Please run the ingestion pipeline first.");
    return [];
  }

  // 6. Apply hybrid ranking formula
  const ranked = rankResources(
    candidates,
    {
      contentPreferences: input.content_preferences,
      difficultyMix,
    },
    config.topN
  );

  // 7. Generate explanations and format output
  const results: RecommendationOutput[] = ranked.map((resource) => ({
    title: resource.title,
    type: resource.type,
    url: resource.url,
    difficulty: resource.difficulty,
    estimated_time: resource.duration || "Unknown",
    source: resource.source,
    recommendation_score: resource.recommendationScore,
    reason: generateExplanation(resource, input, difficultyMix),
    tags: resource.tags,
  }));

  console.log(`   ✅ Returning ${results.length} recommendations\n`);
  return results;
}
