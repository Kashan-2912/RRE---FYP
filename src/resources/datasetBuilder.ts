/**
 * Dataset Builder – orchestrates the full resource collection pipeline:
 *   1. Crawl all sources for each skill
 *   2. Process & extract structured content
 *   3. Ingest into database with embeddings
 */

import { crawlAllSources, RawResource } from "./crawlerService";
import { processResource, ProcessedResource } from "./contentExtractor";
import { batchIngest } from "./ingestionService";

// Skills to crawl for
export const DEFAULT_SKILLS = [
  "Web Development",
  "React",
  "Node.js",
  "Python",
  "Machine Learning",
  "Data Science",
  "DevOps",
  "Cybersecurity",
  "Mobile Development",
  "TypeScript",
  "JavaScript",
  "Docker",
  "Kubernetes",
  "SQL",
  "Cloud Computing",
];

export interface DatasetBuildResult {
  skill: string;
  crawled: number;
  processed: number;
  ingested: number;
  skipped: number;
  failed: number;
}

/**
 * Build dataset for a single skill: crawl → process → ingest.
 */
export async function buildDatasetForSkill(
  skill: string,
  maxPerSource: number = 15,
  sessionLength: string = "regular"
): Promise<DatasetBuildResult> {
  console.log(`\n━━━ Building dataset for: ${skill} (Session: ${sessionLength}) ━━━`);

  // Step 1: Crawl all sources
  const rawResources: RawResource[] = await crawlAllSources(skill, maxPerSource, sessionLength);

  // Step 2: Process and extract structured content
  const processed: ProcessedResource[] = rawResources.map(processResource);

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = processed.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`   🔄 Processing ${unique.length} unique resources (${processed.length - unique.length} duplicates removed)`);

  // Step 3: Batch ingest with progress
  const result = await batchIngest(unique, (current, total) => {
    if (current % 5 === 0 || current === total) {
      console.log(`   📥 Ingesting: ${current}/${total}`);
    }
  });

  const buildResult: DatasetBuildResult = {
    skill,
    crawled: rawResources.length,
    processed: unique.length,
    ingested: result.ingested,
    skipped: result.skipped,
    failed: result.failed,
  };

  console.log(`   ✅ Complete: ${result.ingested} ingested, ${result.skipped} skipped, ${result.failed} failed`);
  return buildResult;
}

/**
 * Build the full dataset across all default skills.
 */
export async function buildFullDataset(
  skills: string[] = DEFAULT_SKILLS,
  maxPerSource: number = 10
): Promise<DatasetBuildResult[]> {
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║   Dataset Builder – Starting Build    ║");
  console.log(`║   Skills: ${skills.length.toString().padEnd(27)}║`);
  console.log("╚═══════════════════════════════════════╝\n");

  const results: DatasetBuildResult[] = [];

  for (const skill of skills) {
    const result = await buildDatasetForSkill(skill, maxPerSource, "regular"); // Default to regular for full build
    results.push(result);
  }

  // Print summary
  const totalIngested = results.reduce((sum, r) => sum + r.ingested, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║   Dataset Build Complete              ║");
  console.log(`║   Total Ingested: ${totalIngested.toString().padEnd(19)}║`);
  console.log(`║   Total Skipped:  ${totalSkipped.toString().padEnd(19)}║`);
  console.log(`║   Total Failed:   ${totalFailed.toString().padEnd(19)}║`);
  console.log("╚═══════════════════════════════════════╝\n");

  return results;
}
