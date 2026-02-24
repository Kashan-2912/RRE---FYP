/**
 * Content Extractor – processes raw crawled content into structured
 * resource data ready for ingestion.
 *
 * Responsibilities:
 * - Infer difficulty level from text content
 * - Estimate reading/viewing duration
 * - Generate quality and popularity scores from metadata
 * - Clean and normalize resource data
 */

import { RawResource } from "./crawlerService";

export interface ProcessedResource {
  title: string;
  url: string;
  type: string;
  difficulty: string;
  duration: string;
  tags: string[];
  source: string;
  summary: string;
  qualityScore: number;
  popularityScore: number;
  recencyScore: number;
}

// ── Difficulty detection keywords ──────────────────────────

const BEGINNER_KEYWORDS = [
  "beginner", "basics", "introduction", "intro", "getting started",
  "fundamentals", "101", "for beginners", "from scratch", "first steps",
  "hello world", "learn", "starter", "newbie", "easy",
];

const INTERMEDIATE_KEYWORDS = [
  "intermediate", "practical", "project", "build", "implement",
  "guide", "walkthrough", "hands-on", "real world", "patterns",
  "best practices", "tips", "tricks",
];

const ADVANCED_KEYWORDS = [
  "advanced", "deep dive", "optimization", "performance", "architecture",
  "design patterns", "scalab", "microservice", "system design",
  "internals", "under the hood", "production", "enterprise",
];

const EXPERT_KEYWORDS = [
  "expert", "master", "research", "paper", "algorithm", "theory",
  "compiler", "kernel", "distributed", "consensus", "proof",
  "formal verification", "cutting edge",
];

/**
 * Infer difficulty level from resource title + description.
 */
export function inferDifficulty(text: string): string {
  const lower = text.toLowerCase();

  let scores = { beginner: 0, intermediate: 0, advanced: 0, expert: 0 };

  for (const kw of BEGINNER_KEYWORDS) {
    if (lower.includes(kw)) scores.beginner++;
  }
  for (const kw of INTERMEDIATE_KEYWORDS) {
    if (lower.includes(kw)) scores.intermediate++;
  }
  for (const kw of ADVANCED_KEYWORDS) {
    if (lower.includes(kw)) scores.advanced++;
  }
  for (const kw of EXPERT_KEYWORDS) {
    if (lower.includes(kw)) scores.expert++;
  }

  const max = Math.max(scores.beginner, scores.intermediate, scores.advanced, scores.expert);
  if (max === 0) return "intermediate"; // default

  if (scores.expert === max) return "expert";
  if (scores.advanced === max) return "advanced";
  if (scores.intermediate === max) return "intermediate";
  return "beginner";
}

/**
 * Calculate quality score (0-1) based on available metadata.
 */
export function calculateQualityScore(resource: RawResource): number {
  let score = 0.5; // base

  if (resource.source === "YouTube" && resource.metadata?.viewCount) {
    const views = resource.metadata.viewCount;
    if (views > 1000000) score = 0.95;
    else if (views > 100000) score = 0.85;
    else if (views > 10000) score = 0.70;
    else if (views > 1000) score = 0.55;
  }

  if (resource.source === "GitHub" && resource.metadata?.stars) {
    const stars = resource.metadata.stars;
    if (stars > 10000) score = 0.95;
    else if (stars > 1000) score = 0.85;
    else if (stars > 100) score = 0.70;
    else if (stars > 10) score = 0.55;
  }

  if (resource.source === "Dev.to" && resource.metadata?.reactions) {
    const reactions = resource.metadata.reactions;
    if (reactions > 500) score = 0.90;
    else if (reactions > 100) score = 0.80;
    else if (reactions > 20) score = 0.65;
  }

  // MDN and freeCodeCamp are generally high quality
  if (resource.source === "MDN") score = Math.max(score, 0.85);
  if (resource.source === "freeCodeCamp") score = Math.max(score, 0.80);

  return score;
}

/**
 * Calculate popularity score (0-1) based on engagement metrics.
 */
export function calculatePopularityScore(resource: RawResource): number {
  if (resource.metadata?.viewCount) {
    const views = resource.metadata.viewCount;
    return Math.min(1, Math.log10(Math.max(1, views)) / 7); // log scale, max at 10M
  }
  if (resource.metadata?.stars) {
    const stars = resource.metadata.stars;
    return Math.min(1, Math.log10(Math.max(1, stars)) / 5); // log scale, max at 100k
  }
  if (resource.metadata?.reactions) {
    return Math.min(1, resource.metadata.reactions / 500);
  }
  return 0.4; // default
}

/**
 * Calculate recency score (0-1) based on publish date.
 */
export function calculateRecencyFromDate(publishedAt?: string): number {
  if (!publishedAt) return 0.5;

  const published = new Date(publishedAt);
  const now = new Date();
  const ageInDays = (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24);

  if (ageInDays <= 30) return 1.0;
  if (ageInDays <= 90) return 0.9;
  if (ageInDays <= 180) return 0.8;
  if (ageInDays <= 365) return 0.6;
  if (ageInDays <= 730) return 0.4;
  return 0.2;
}

/**
 * Process a raw crawled resource into a structured ProcessedResource.
 */
export function processResource(raw: RawResource): ProcessedResource {
  const textForAnalysis = `${raw.title} ${raw.description || ""}`;

  return {
    title: raw.title,
    url: raw.url,
    type: raw.type,
    difficulty: inferDifficulty(textForAnalysis),
    duration: raw.duration || estimateDefaultDuration(raw.type),
    tags: [...new Set(raw.tags.map((t) => t.toLowerCase()))],
    source: raw.source,
    summary: raw.description?.slice(0, 500) || "",
    qualityScore: calculateQualityScore(raw),
    popularityScore: calculatePopularityScore(raw),
    recencyScore: calculateRecencyFromDate(raw.publishedAt),
  };
}

function estimateDefaultDuration(type: string): string {
  switch (type) {
    case "video": return "15 minutes";
    case "article": return "10 minutes";
    case "tutorial": return "20 minutes";
    case "documentation": return "10 minutes";
    case "repo": return "30 minutes";
    case "course": return "60 minutes";
    default: return "15 minutes";
  }
}
