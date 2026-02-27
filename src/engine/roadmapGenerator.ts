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
 * 
 * @param usedResourceIds - Set of resource IDs already assigned to other nodes (for global dedup)
 */
async function findResourcesForSlaveNode(
  slaveNode: SlaveNodeSkeleton,
  skill: string,
  contentPreferences: string[],
  maxResources: number = 3,
  usedResourceIds: Set<string> = new Set()
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
      maxResources * 4 // Fetch extra to account for dedup filtering
    );

    for (const row of tagResults) {
      if (!allResults.has(row.id) && !usedResourceIds.has(row.id)) {
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
      const results = await searchSimilarResources(embedding, maxResources * 4);

      for (const result of results) {
        const existing = allResults.get(result.id);
        if (existing) {
          // Boost score if found by both methods
          existing.score = Math.max(existing.score, result.similarity);
        } else if (!usedResourceIds.has(result.id)) {
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

// ── Auto-Ingest Logic ──────────────────────────────────────

import { buildDatasetForSkill } from "../resources/datasetBuilder";

const MIN_RESOURCES_THRESHOLD = 5; // Minimum resources needed before we skip ingestion

/**
 * Check if the database has enough resources for a given skill.
 * If not, auto-crawl and ingest resources for that skill.
 */
async function ensureResourcesExist(
  skill: string,
  sessionLength: string
): Promise<{ existed: boolean; count: number }> {
  const skillTag = skill.toLowerCase().trim();

  // Count how many resources we have for this skill
  const countResult: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM resources WHERE tags && $1::text[]`,
    [skillTag]
  );
  const existingCount = parseInt(countResult[0]?.count || "0");

  if (existingCount >= MIN_RESOURCES_THRESHOLD) {
    console.log(`   ✅ Found ${existingCount} existing resources for "${skill}" — using cached`);
    return { existed: true, count: existingCount };
  }

  // Not enough resources — auto-crawl
  console.log(`\n🕷️  Only ${existingCount} resources found for "${skill}" — auto-ingesting...`);
  const result = await buildDatasetForSkill(skill, 15, sessionLength);
  const totalNow = existingCount + result.ingested;
  console.log(`   ✅ Auto-ingestion complete: ${result.ingested} new resources (${totalNow} total)`);

  return { existed: false, count: totalNow };
}

// ── Main Generator ─────────────────────────────────────────

/**
 * Generate a complete roadmap with resources attached.
 *
 * Flow:
 *   1. Check if DB has resources for this skill (auto-ingest if not)
 *   2. Call LLM for roadmap skeleton (runs in parallel with ingestion if needed)
 *   3. Attach real resources to each slave node
 *   4. Return the complete roadmap
 */
export async function generateRoadmap(
  input: RoadmapUserInput
): Promise<RoadmapOutput> {
  console.log(`\n📋 Starting roadmap generation for: ${input.skill}`);

  // Step 1 & 2: Run LLM call and resource check/ingestion in PARALLEL
  // This saves time — the LLM call takes a few seconds, and so does crawling
  const [skeleton, resourceCheck] = await Promise.all([
    generateRoadmapFromLLM(input),
    ensureResourcesExist(input.skill, input.sessionLength),
  ]);

  console.log(`\n📚 Attaching resources from database (${resourceCheck.count} available)...`);

  // Step 3: Attach resources to each slave node
  // Track used resource IDs globally so no resource appears in more than one slave node
  const usedResourceIds = new Set<string>();
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
        3, // max resources per slave node
        usedResourceIds
      );

      // Mark these resources as used so they won't appear in subsequent nodes
      for (const r of resources) {
        usedResourceIds.add(r.id);
      }

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

  console.log(`\n✅ Roadmap complete: ${masterNodes.length} master nodes, ${totalSlaveNodes} slave nodes, ${totalResourcesAttached} resources attached`);
  console.log(`   ${resourceCheck.existed ? "📦 Used cached resources" : "🆕 Fresh resources were auto-crawled"}\n`);

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

