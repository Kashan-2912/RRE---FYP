/**
 * Vector Search – performs semantic similarity search using pgvector.
 *
 * Uses PostgreSQL's pgvector extension with cosine distance (<=>)
 * to find the most similar resources to a query embedding.
 */

import prisma from "../config/database";
import { distanceToSimilarity } from "../utils/similarity";

export interface VectorSearchResult {
  id: string;
  title: string;
  url: string;
  type: string;
  difficulty: string;
  duration: string | null;
  tags: string[];
  source: string;
  summary: string | null;
  qualityScore: number;
  popularityScore: number;
  recencyScore: number;
  createdAt: Date;
  similarity: number; // 0-1 cosine similarity
}

export interface VectorSearchFilters {
  types?: string[];       // filter by resource type
  difficulties?: string[]; // filter by difficulty levels
  sources?: string[];     // filter by source platform
  tags?: string[];        // filter by tags
}

/**
 * Search for similar resources using cosine distance in pgvector.
 *
 * @param queryEmbedding - 384-dimensional query vector
 * @param limit - max results to return
 * @param filters - optional filters to narrow results
 * @returns Ranked resources with similarity scores
 */
export async function searchSimilarResources(
  queryEmbedding: number[],
  limit: number = 50,
  filters?: VectorSearchFilters
): Promise<VectorSearchResult[]> {
  // Build the embedding string for pgvector
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Build WHERE clauses
  const conditions: string[] = ["embedding IS NOT NULL"];
  const params: any[] = [embeddingStr, limit];
  let paramIndex = 3;

  if (filters?.types?.length) {
    conditions.push(`type = ANY($${paramIndex}::text[])`);
    params.push(filters.types);
    paramIndex++;
  }

  if (filters?.difficulties?.length) {
    conditions.push(`difficulty = ANY($${paramIndex}::text[])`);
    params.push(filters.difficulties);
    paramIndex++;
  }

  if (filters?.sources?.length) {
    conditions.push(`source = ANY($${paramIndex}::text[])`);
    params.push(filters.sources);
    paramIndex++;
  }

  const whereClause = conditions.join(" AND ");

  // Query with cosine distance
  const results: any[] = await prisma.$queryRawUnsafe(
    `SELECT
      id,
      title,
      url,
      type,
      difficulty,
      duration,
      tags,
      source,
      summary,
      "qualityScore",
      "popularityScore",
      "recencyScore",
      "createdAt",
      (embedding <=> $1::vector) as distance
    FROM resources
    WHERE ${whereClause}
    ORDER BY embedding <=> $1::vector
    LIMIT $2`,
    ...params
  );

  // Convert distance to similarity and shape the results
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    type: row.type,
    difficulty: row.difficulty,
    duration: row.duration,
    tags: row.tags,
    source: row.source,
    summary: row.summary,
    qualityScore: row.qualityScore,
    popularityScore: row.popularityScore,
    recencyScore: row.recencyScore,
    createdAt: row.createdAt,
    similarity: distanceToSimilarity(parseFloat(row.distance)),
  }));
}
