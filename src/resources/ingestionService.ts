/**
 * Ingestion Service – takes processed resources, generates embeddings,
 * and stores them in the database with pgvector embeddings.
 */

import prisma from "../config/database";
import { generateEmbedding, buildResourceText } from "../vector/embeddingService";
import { ProcessedResource } from "./contentExtractor";

/**
 * Ingest a single resource: generate embedding and store in database.
 */
export async function ingestResource(resource: ProcessedResource): Promise<string | null> {
  try {
    // Check if resource already exists (deduplicate by URL)
    const existing = await prisma.resource.findUnique({
      where: { url: resource.url },
    });

    if (existing) {
      return existing.id;
    }

    // Generate embedding from resource text
    const text = buildResourceText({
      title: resource.title,
      summary: resource.summary,
      tags: resource.tags,
      difficulty: resource.difficulty,
      source: resource.source,
    });
    const embedding = await generateEmbedding(text);
    const embeddingStr = `[${embedding.join(",")}]`;

    // Insert resource with embedding using raw SQL for pgvector support
    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO resources (
        id, title, url, type, difficulty, duration, tags, source,
        summary, "qualityScore", "popularityScore", "recencyScore",
        embedding, "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6::text[], $7,
        $8, $9, $10, $11,
        $12::vector, NOW(), NOW()
      )
      ON CONFLICT (url) DO NOTHING
      RETURNING id`,
      resource.title,
      resource.url,
      resource.type,
      resource.difficulty,
      resource.duration,
      resource.tags,
      resource.source,
      resource.summary,
      resource.qualityScore,
      resource.popularityScore,
      resource.recencyScore,
      embeddingStr
    );

    if (result.length > 0) {
      return result[0].id;
    }
    return null;
  } catch (error: any) {
    console.error(`❌ Failed to ingest resource "${resource.title}": ${error.message}`);
    return null;
  }
}

/**
 * Batch ingest multiple resources.
 * Processes sequentially to avoid overwhelming the embedding model.
 */
export async function batchIngest(
  resources: ProcessedResource[],
  onProgress?: (current: number, total: number) => void
): Promise<{ ingested: number; skipped: number; failed: number }> {
  let ingested = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i];

    // Check if already exists before generating embedding (saves time)
    const existing = await prisma.resource.findUnique({
      where: { url: resource.url },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      onProgress?.(i + 1, resources.length);
      continue;
    }

    const id = await ingestResource(resource);
    if (id) {
      ingested++;
    } else {
      failed++;
    }

    onProgress?.(i + 1, resources.length);
  }

  return { ingested, skipped, failed };
}

/**
 * Get database stats for resources.
 */
export async function getResourceStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  byDifficulty: Record<string, number>;
  withEmbeddings: number;
}> {
  const total = await prisma.resource.count();

  const byType = await prisma.resource.groupBy({
    by: ["type"],
    _count: true,
  });

  const bySource = await prisma.resource.groupBy({
    by: ["source"],
    _count: true,
  });

  const byDifficulty = await prisma.resource.groupBy({
    by: ["difficulty"],
    _count: true,
  });

  // Count resources with embeddings
  const withEmbeddingsResult: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM resources WHERE embedding IS NOT NULL`
  );

  return {
    total,
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count])),
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count])),
    byDifficulty: Object.fromEntries(byDifficulty.map((r) => [r.difficulty, r._count])),
    withEmbeddings: parseInt(withEmbeddingsResult[0]?.count || "0"),
  };
}
