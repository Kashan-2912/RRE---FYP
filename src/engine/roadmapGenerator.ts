/**
 * Roadmap Generator – orchestrates the full roadmap creation flow:
 *   1. Call LLM to generate a roadmap skeleton (master/slave nodes)
 *   2. For each slave node, do LIVE targeted searches (YouTube + Google)
 *   3. Attach real, relevant resources to each slave node
 *   4. Return the complete roadmap
 */

import { generateRoadmapFromLLM, RoadmapUserInput } from "./llmService";
import { searchResourcesForNode, LiveResource } from "./liveSearchService";

// ── Output Types ────────────────────────────────────────────

export interface ResourceAttachment {
  title: string;
  url: string;
  type: string;
  source: string;
  duration: string | null;
  snippet: string | null;
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

// ── Main Generator ─────────────────────────────────────────

/**
 * Generate a complete roadmap with live-searched resources.
 *
 * Flow:
 *   1. Call LLM for roadmap skeleton
 *   2. For each slave node, search YouTube + Google for concept-specific resources
 *   3. Guarantees at least 1 video per node, deduplicates globally
 *   4. Return the complete roadmap
 */
export async function generateRoadmap(
  input: RoadmapUserInput
): Promise<RoadmapOutput> {
  console.log(`\n📋 Starting roadmap generation for: ${input.skill}`);

  // Step 1: Get roadmap skeleton from LLM
  const skeleton = await generateRoadmapFromLLM(input);

  // Step 2: Live search resources for each slave node
  console.log(`\n🔍 Live-searching resources for each concept...`);

  const usedUrls = new Set<string>(); // Global dedup across all nodes
  let totalResourcesAttached = 0;
  let totalSlaveNodes = 0;

  const masterNodes: MasterNodeOutput[] = [];

  for (const masterNode of skeleton.masterNodes) {
    const slaveNodesOutput: SlaveNodeOutput[] = [];

    for (const slaveNode of masterNode.slaveNodes) {
      totalSlaveNodes++;

      // Live search — Serper video + web for this specific concept
      const liveResults = await searchResourcesForNode(
        {
          title: slaveNode.title,
          searchTerms: slaveNode.searchTerms,
          contentTypes: slaveNode.contentTypes,
          difficulty: slaveNode.difficulty,
        },
        input.skill,
        usedUrls,
        5 // max resources per node (actual count varies based on availability)
      );

      const resources: ResourceAttachment[] = liveResults.map((r) => ({
        title: r.title,
        url: r.url,
        type: r.type,
        source: r.source,
        duration: r.duration,
        snippet: r.snippet,
      }));

      totalResourcesAttached += resources.length;

      slaveNodesOutput.push({
        title: slaveNode.title,
        description: slaveNode.description,
        difficulty: slaveNode.difficulty,
        contentTypes: slaveNode.contentTypes,
        resources,
      });

      const types = resources.map((r) => r.type).join(", ");
      console.log(`   📍 ${slaveNode.title}: ${resources.length} resources [${types}]`);
    }

    masterNodes.push({
      title: masterNode.title,
      description: masterNode.description,
      order: masterNode.order,
      slaveNodes: slaveNodesOutput,
    });
  }

  console.log(`\n✅ Roadmap complete: ${masterNodes.length} master nodes, ${totalSlaveNodes} concepts, ${totalResourcesAttached} resources\n`);

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
