import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl: process.env.DATABASE_URL || "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  githubToken: process.env.GITHUB_TOKEN || "",

  // Recommendation engine weights
  weights: {
    semanticSimilarity: 0.45,
    qualityScore: 0.20,
    formatMatch: 0.15,
    difficultyMatch: 0.12,
    recencyScore: 0.08,
  },

  // Number of recommendations to return
  topN: 10,

  // Embedding model config
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingDimension: 384,
} as const;
