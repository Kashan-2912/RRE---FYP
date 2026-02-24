/**
 * Ingestion CLI script – run the dataset builder from the command line.
 *
 * Usage:
 *   npm run ingest                          – Build dataset for all default skills
 *   npx tsx src/scripts/ingest.ts react     – Build dataset for specific skill
 */

import { buildDatasetForSkill, buildFullDataset, DEFAULT_SKILLS } from "../resources/datasetBuilder";
import prisma from "../config/database";

async function main() {
  const skill = process.argv[2];

  if (skill) {
    console.log(`\n🚀 Building dataset for: "${skill}"\n`);
    const result = await buildDatasetForSkill(skill);
    console.log("\nResult:", JSON.stringify(result, null, 2));
  } else {
    console.log(`\n🚀 Building full dataset for ${DEFAULT_SKILLS.length} skills\n`);
    const results = await buildFullDataset();
    console.log("\nResults:", JSON.stringify(results, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Ingestion error:", e);
  prisma.$disconnect();
  process.exit(1);
});
