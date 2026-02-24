/**
 * Embedding Service – generates semantic embeddings using a local
 * HuggingFace sentence-transformer model (all-MiniLM-L6-v2).
 *
 * Runs entirely locally. No API keys needed. 384-dimensional vectors.
 */

import { config } from "../config/environment";

// Lazy-loaded pipeline singleton
let pipelineInstance: any = null;

async function getPipeline() {
  if (!pipelineInstance) {
    // Dynamic import to avoid top-level await issues
    const { pipeline } = await import("@xenova/transformers");
    console.log("📦 Loading embedding model (first time may download ~80MB)...");
    pipelineInstance = await pipeline("feature-extraction", config.embeddingModel);
    console.log("✅ Embedding model loaded successfully");
  }
  return pipelineInstance;
}

/**
 * Generate a 384-dimensional embedding vector for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const pipe = await getPipeline();

  // Truncate very long texts to avoid OOM
  const truncated = text.slice(0, 2048);

  const output = await pipe(truncated, {
    pooling: "mean",
    normalize: true,
  });

  // Convert Tensor to regular array
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}

/**
 * Build a searchable text string from resource metadata.
 * This is the text we generate embeddings for.
 */
export function buildResourceText(resource: {
  title: string;
  summary?: string | null;
  tags?: string[];
  difficulty?: string;
  source?: string;
}): string {
  const parts = [resource.title];
  if (resource.summary) parts.push(resource.summary);
  if (resource.tags?.length) parts.push(resource.tags.join(", "));
  if (resource.difficulty) parts.push(`difficulty: ${resource.difficulty}`);
  if (resource.source) parts.push(`source: ${resource.source}`);
  return parts.join(". ");
}

/**
 * Build a query text from user input for semantic search.
 */
export function buildQueryText(params: {
  skill: string;
  contentPreferences: string[];
  difficultyPreference: string;
}): string {
  return `Learn ${params.skill}. Content types: ${params.contentPreferences.join(", ")}. Level: ${params.difficultyPreference}.`;
}
