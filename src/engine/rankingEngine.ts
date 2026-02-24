/**
 * Ranking Engine – applies the hybrid scoring formula to rank resources.
 *
 * Final Score Formula (per spec):
 *   FinalScore = 0.45 * semantic_similarity
 *              + 0.20 * quality_score
 *              + 0.15 * format_match
 *              + 0.12 * difficulty_match
 *              + 0.08 * recency_score
 */

import { config } from "../config/environment";
import { VectorSearchResult } from "../vector/vectorSearch";
import { DifficultyMix, calculateDifficultyMatchScore } from "./difficultyMapper";
import { calculateFormatMatchScore, calculateRecencyScore, clamp } from "../utils/scoring";

export interface RankedResource {
  id: string;
  title: string;
  url: string;
  type: string;
  difficulty: string;
  duration: string | null;
  tags: string[];
  source: string;
  summary: string | null;
  recommendationScore: number;
  scores: {
    semantic: number;
    quality: number;
    format: number;
    difficulty: number;
    recency: number;
  };
}

export interface RankingParams {
  contentPreferences: string[];
  difficultyMix: DifficultyMix;
}

/**
 * Calculate the final recommendation score for a single resource.
 */
export function calculateRecommendationScore(
  resource: VectorSearchResult,
  params: RankingParams
): { finalScore: number; scores: RankedResource["scores"] } {
  const w = config.weights;

  const semanticScore = clamp(resource.similarity);
  const qualityScore = clamp(resource.qualityScore);
  const formatScore = calculateFormatMatchScore(resource.type, params.contentPreferences);
  const difficultyScore = calculateDifficultyMatchScore(resource.difficulty, params.difficultyMix);
  const recencyScore = calculateRecencyScore(resource.createdAt);

  const finalScore =
    w.semanticSimilarity * semanticScore +
    w.qualityScore * qualityScore +
    w.formatMatch * formatScore +
    w.difficultyMatch * difficultyScore +
    w.recencyScore * recencyScore;

  return {
    finalScore: Math.round(finalScore * 100) / 100,
    scores: {
      semantic: Math.round(semanticScore * 100) / 100,
      quality: Math.round(qualityScore * 100) / 100,
      format: Math.round(formatScore * 100) / 100,
      difficulty: Math.round(difficultyScore * 100) / 100,
      recency: Math.round(recencyScore * 100) / 100,
    },
  };
}

/**
 * Rank an array of vector search results using the hybrid scoring formula.
 * Returns the top N ranked resources.
 */
export function rankResources(
  resources: VectorSearchResult[],
  params: RankingParams,
  topN: number = config.topN
): RankedResource[] {
  const ranked: RankedResource[] = resources.map((resource) => {
    const { finalScore, scores } = calculateRecommendationScore(resource, params);
    return {
      id: resource.id,
      title: resource.title,
      url: resource.url,
      type: resource.type,
      difficulty: resource.difficulty,
      duration: resource.duration,
      tags: resource.tags,
      source: resource.source,
      summary: resource.summary,
      recommendationScore: finalScore,
      scores,
    };
  });

  // Sort by recommendation score descending
  ranked.sort((a, b) => b.recommendationScore - a.recommendationScore);

  // Return top N
  return ranked.slice(0, topN);
}
