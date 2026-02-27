/**
 * Roadmap Generator – orchestrates the full roadmap creation flow:
 *   1. Call LLM to generate a roadmap skeleton (master/slave nodes)
 *   2. For each slave node, query the existing Neon DB for matching resources
 *   3. Attach real resources to each slave node
 *   4. Return the complete roadmap
 */

import { generateRoadmapFromLLM, RoadmapUserInput, RoadmapSkeleton, MasterNodeSkeleton, SlaveNodeSkeleton } from "./llmService";
import { generateEmbedding } from "../vector/embeddingService";
import { searchSimilarResources } from "../vector/vectorSearch";
import prisma from "../config/database";

// ── Output Types ────────────────────────────────────────────

export interface ResourceAttachment {
  id: string;
  title: string;
  url: string;
  type: string;
  source: string;
  difficulty: string;
  duration: string | null;
  summary: string | null;
}

export interface SlaveNodeOutput {
  title: string;
  description: string;
  difficulty: string;
  contentTypes: string[];
  resources: ResourceAttachment[];
}

export interface MasterNodeOutput {
  title: string;
  description: string;
  order: number;
  slaveNodes: SlaveNodeOutput[];
}

export interface RoadmapOutput {
  skill: string;
  summary: string;
  estimatedTotalHours: number;
  masterNodes: MasterNodeOutput[];
  metadata: {
    totalMasterNodes: number;
    totalSlaveNodes: number;
    totalResourcesAttached: number;
    generatedAt: string;
  };
}

// ── Resource Matching ──────────────────────────────────────

/**
 * Find matching resources for a slave node using a combination of:
 *   1. Tag-based text search (fast, precise)
 *   2. Semantic vector search using search terms (more flexible)
 * Then rank and deduplicate results.
 */
async function findResourcesForSlaveNode(
  slaveNode: SlaveNodeSkeleton,
  skill: string,
  contentPreferences: string[],
  maxResources: number = 3
): Promise<ResourceAttachment[]> {
  const allResults: Map<string, ResourceAttachment & { score: number }> = new Map();

  // Strategy 1: Direct tag + type search via Prisma
  try {
    const skillTag = skill.toLowerCase().trim();
    const typeFilter = slaveNode.contentTypes.length > 0
      ? slaveNode.contentTypes
      : contentPreferences;

    // Map content preferences to resource types
    const typeMapping: Record<string, string[]> = {
      video: ["video"],
      article: ["article"],
      repo: ["repo"],
      course: ["course"],
      tutorial: ["tutorial"],
      documentation: ["documentation"],
    };

    const dbTypes: string[] = [];
    for (const pref of typeFilter) {
      const mapped = typeMapping[pref.toLowerCase()];
      if (mapped) dbTypes.push(...mapped);
    }

    const tagResults: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, title, url, type, source, difficulty, duration, summary
       FROM resources
       WHERE tags && $1::text[]
       AND ($2::text[] = '{}' OR type = ANY($2::text[]))
       ORDER BY "qualityScore" DESC
       LIMIT $3`,
      [skillTag],
      dbTypes.length > 0 ? dbTypes : [],
      maxResources * 2
    );

    for (const row of tagResults) {
      if (!allResults.has(row.id)) {
        allResults.set(row.id, {
          id: row.id,
          title: row.title,
          url: row.url,
          type: row.type,
          source: row.source,
          difficulty: row.difficulty,
          duration: row.duration,
          summary: row.summary,
          score: 0.5, // base score for tag match
        });
      }
    }
  } catch (err: any) {
    console.error(`   ⚠️ Tag search failed for "${slaveNode.title}": ${err.message}`);
  }

  // Strategy 2: Semantic vector search using the slave node's search terms
  try {
    for (const searchTerm of slaveNode.searchTerms.slice(0, 2)) {
      const embedding = await generateEmbedding(searchTerm);
      const results = await searchSimilarResources(embedding, maxResources * 2);

      for (const result of results) {
        const existing = allResults.get(result.id);
        if (existing) {
          // Boost score if found by both methods
          existing.score = Math.max(existing.score, result.similarity);
        } else {
          allResults.set(result.id, {
            id: result.id,
            title: result.title,
            url: result.url,
            type: result.type,
            source: result.source,
            difficulty: result.difficulty,
            duration: result.duration,
            summary: result.summary,
            score: result.similarity,
          });
        }
      }
    }
  } catch (err: any) {
    console.error(`   ⚠️ Vector search failed for "${slaveNode.title}": ${err.message}`);
  }

  // Sort by score and take top N, preferring content type matches
  const sorted = Array.from(allResults.values()).sort((a, b) => {
    // Boost items matching preferred content types
    const aTypeMatch = contentPreferences.includes(a.type) ? 0.2 : 0;
    const bTypeMatch = contentPreferences.includes(b.type) ? 0.2 : 0;
    return (b.score + bTypeMatch) - (a.score + aTypeMatch);
  });

  return sorted.slice(0, maxResources).map(({ score, ...resource }) => resource);
}

// ── Main Generator ─────────────────────────────────────────

/**
 * Generate a complete roadmap with resources attached.
 */
export async function generateRoadmap(
  input: RoadmapUserInput
): Promise<RoadmapOutput> {
  console.log(`\n📋 Starting roadmap generation for: ${input.skill}`);

  // Step 1: Get roadmap skeleton from LLM
  const skeleton = await generateRoadmapFromLLM(input);

  // Step 2: Attach resources to each slave node
  console.log(`\n📚 Attaching resources from database...`);
  let totalResourcesAttached = 0;
  let totalSlaveNodes = 0;

  const masterNodes: MasterNodeOutput[] = [];

  for (const masterNode of skeleton.masterNodes) {
    const slaveNodesOutput: SlaveNodeOutput[] = [];

    for (const slaveNode of masterNode.slaveNodes) {
      totalSlaveNodes++;

      const resources = await findResourcesForSlaveNode(
        slaveNode,
        input.skill,
        input.contentPreferences,
        3 // max resources per slave node
      );

      totalResourcesAttached += resources.length;

      slaveNodesOutput.push({
        title: slaveNode.title,
        description: slaveNode.description,
        difficulty: slaveNode.difficulty,
        contentTypes: slaveNode.contentTypes,
        resources,
      });

      console.log(`   📍 ${masterNode.title} > ${slaveNode.title}: ${resources.length} resources`);
    }

    masterNodes.push({
      title: masterNode.title,
      description: masterNode.description,
      order: masterNode.order,
      slaveNodes: slaveNodesOutput,
    });
  }

  console.log(`\n✅ Roadmap complete: ${masterNodes.length} master nodes, ${totalSlaveNodes} slave nodes, ${totalResourcesAttached} resources attached\n`);

  return {
    skill: skeleton.skill,
    summary: skeleton.summary,
    estimatedTotalHours: skeleton.estimatedTotalHours,
    masterNodes,
    metadata: {
      totalMasterNodes: masterNodes.length,
      totalSlaveNodes,
      totalResourcesAttached,
      generatedAt: new Date().toISOString(),
    },
  };
}
