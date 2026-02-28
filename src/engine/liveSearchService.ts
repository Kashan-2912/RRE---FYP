/**
 * Live Search Service – performs real-time, concept-specific searches
 * using YouTube Data API (for videos) + Serper.dev (for articles/docs).
 *
 * Videos are ranked by semantic similarity using pgvector embeddings.
 * User preferences (session length, difficulty, learning pace) influence ranking.
 */

import axios from "axios";
import { config } from "../config/environment";
import prisma from "../config/database";
import {
  generateEmbedding,
  buildVideoText,
  buildVideoQueryText,
} from "../vector/embeddingService";

// ── Types ──────────────────────────────────────────────────

export interface LiveResource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "repo";
  source: string;
  duration: string | null;
  snippet: string | null;
  similarityScore?: number;
}

// ── YouTube Data API ───────────────────────────────────────

async function searchYouTube(
  query: string,
  maxResults: number = 8
): Promise<LiveResource[]> {
  const apiKey = config.youtubeApiKey;
  if (!apiKey) {
    console.warn("   ⚠️ YOUTUBE_API_KEY not set, skipping YouTube search");
    return [];
  }

  try {
    const response = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          key: apiKey,
          q: query,
          part: "snippet",
          type: "video",
          maxResults,
          order: "relevance",
          relevanceLanguage: "en",
        },
        timeout: 10000,
      }
    );

    const items = response.data?.items || [];

    // Batch-fetch durations
    const videoIds = items
      .map((item: any) => item.id?.videoId)
      .filter(Boolean)
      .join(",");
    let durations: Record<string, string> = {};

    if (videoIds) {
      try {
        const detailsRes = await axios.get(
          "https://www.googleapis.com/youtube/v3/videos",
          {
            params: { key: apiKey, id: videoIds, part: "contentDetails" },
            timeout: 10000,
          }
        );
        for (const v of detailsRes.data?.items || []) {
          durations[v.id] = parseISO8601Duration(v.contentDetails.duration);
        }
      } catch {
        // Duration fetch failed, continue without
      }
    }

    return items
      .filter((item: any) => item.id?.videoId)
      .map((item: any) => ({
        title: decodeHtmlEntities(item.snippet.title),
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        type: "video" as const,
        source: "YouTube",
        duration: durations[item.id.videoId] || null,
        snippet: item.snippet.description?.slice(0, 200) || null,
      }));
  } catch (err: any) {
    console.error(`   ⚠️ YouTube search failed: ${err.message}`);
    return [];
  }
}

// ── Serper Web Search ──────────────────────────────────────

async function searchGoogle(
  query: string,
  maxResults: number = 5
): Promise<LiveResource[]> {
  const apiKey = config.serperApiKey;
  if (!apiKey) {
    console.warn("   ⚠️ SERPER_API_KEY not set, skipping Google search");
    return [];
  }

  try {
    const response = await axios.post(
      "https://google.serper.dev/search",
      { q: query, num: maxResults },
      {
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const organic = response.data?.organic || [];

    return organic.map((result: any) => ({
      title: result.title,
      url: result.link,
      type: classifyUrl(result.link),
      source: extractDomain(result.link),
      duration: null,
      snippet: result.snippet?.slice(0, 200) || null,
    }));
  } catch (err: any) {
    console.error(`   ⚠️ Serper search failed: ${err.message}`);
    return [];
  }
}

// ── Embedding + Save to DB ─────────────────────────────────

/**
 * Save a YouTube video to the resources table WITH its embedding.
 * Returns the resource ID.
 */
async function saveVideoWithEmbedding(
  video: LiveResource,
  skill: string,
  concept: string,
  difficulty: string
): Promise<string | null> {
  try {
    // Build text for embedding
    const videoText = buildVideoText({
      title: video.title,
      snippet: video.snippet,
      duration: video.duration,
      difficulty,
      tags: [skill.toLowerCase(), concept.toLowerCase()],
    });

    // Generate embedding
    const embedding = await generateEmbedding(videoText);
    const embeddingStr = `[${embedding.join(",")}]`;

    // Upsert resource and set embedding via raw SQL (Prisma doesn't support pgvector natively)
    await prisma.resource.upsert({
      where: { url: video.url },
      update: { updatedAt: new Date() },
      create: {
        title: video.title,
        url: video.url,
        type: "video",
        difficulty,
        duration: video.duration,
        tags: [skill.toLowerCase(), concept.toLowerCase()],
        source: video.source,
        summary: video.snippet,
      },
    });

    // Set embedding via raw SQL
    await prisma.$executeRawUnsafe(
      `UPDATE resources SET embedding = $1::vector WHERE url = $2`,
      embeddingStr,
      video.url
    );

    return video.url;
  } catch (err: any) {
    // Silently skip — resource might already exist
    return null;
  }
}

/**
 * Rank saved videos by cosine similarity to a query embedding.
 * Returns video URLs ordered by relevance.
 */
async function rankVideosBySimilarity(
  queryEmbedding: number[],
  videoUrls: string[],
  limit: number
): Promise<{ url: string; score: number }[]> {
  if (videoUrls.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const urlPlaceholders = videoUrls.map((_, i) => `$${i + 2}`).join(", ");

  try {
    const results: any[] = await prisma.$queryRawUnsafe(
      `SELECT url, 1 - (embedding <=> $1::vector) as similarity
       FROM resources
       WHERE url IN (${urlPlaceholders})
       AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT ${limit}`,
      embeddingStr,
      ...videoUrls
    );

    return results.map((r) => ({
      url: r.url,
      score: parseFloat(r.similarity) || 0,
    }));
  } catch (err: any) {
    console.error(`   ⚠️ Similarity search failed: ${err.message}`);
    // Fallback: return in original order
    return videoUrls.slice(0, limit).map((url) => ({ url, score: 0 }));
  }
}

// ── Main Search Function ───────────────────────────────────

export interface SlaveNodeSearchInput {
  title: string;
  searchTerms: string[];
  contentTypes: string[];
  difficulty: string;
}

export interface UserPreferences {
  sessionLength: string;
  learningPace: string;
}

/**
 * Search for resources for a single slave node.
 * YouTube API for videos (ranked by embedding similarity) + Serper for articles.
 */
export async function searchResourcesForNode(
  node: SlaveNodeSearchInput,
  skill: string,
  userPrefs: UserPreferences,
  usedVideoIds: Set<string>,
  usedArticleUrls: Set<string>,
  maxResources: number = 5
): Promise<LiveResource[]> {
  const diffLabel =
    node.difficulty === "expert" ? "advanced" : node.difficulty;

  const ytQuery = `${skill} ${node.title} ${diffLabel} tutorial`;
  const webQuery = `${skill} ${node.searchTerms[0] || node.title} ${diffLabel} tutorial OR guide`;

  // Run YouTube + Google in parallel
  const [youtubeResults, webResults] = await Promise.all([
    searchYouTube(ytQuery, 8),
    searchGoogle(webQuery, 5),
  ]);

  console.log(
    `      🔎 "${node.title}" raw: YT=${youtubeResults.length} videos, Web=${webResults.length} articles`
  );

  // ── Step 1: Dedup + STRICT duration filter based on session length ──
  const minDuration = getMinDuration(userPrefs.sessionLength);
  const maxDuration = getMaxDuration(userPrefs.sessionLength);
  const freshVideos: LiveResource[] = [];
  const usedTitles = new Set<string>();
  for (const vid of youtubeResults) {
    const videoId = extractYouTubeId(vid.url);
    const normalizedTitle = vid.title.toLowerCase().trim();
    const minutes = vid.duration ? parseDurationToMinutes(vid.duration) : 0;
    if (
      videoId &&
      !usedVideoIds.has(videoId) &&
      !usedTitles.has(normalizedTitle) &&
      minutes >= minDuration &&
      minutes <= maxDuration
    ) {
      usedTitles.add(normalizedTitle);
      freshVideos.push(vid);
    }
  }

  // ── Step 2: Save videos with embeddings ──
  console.log(`      📦 Embedding ${freshVideos.length} YouTube videos...`);
  const savedUrls: string[] = [];
  for (const vid of freshVideos) {
    const saved = await saveVideoWithEmbedding(vid, skill, node.title, diffLabel);
    if (saved) savedUrls.push(saved);
  }

  // ── Step 3: Build query embedding with user preferences ──
  const queryText = buildVideoQueryText({
    skill,
    concept: node.title,
    difficulty: diffLabel,
    sessionLength: userPrefs.sessionLength,
    learningPace: userPrefs.learningPace,
  });
  const queryEmbedding = await generateEmbedding(queryText);

  // ── Step 4: Rank videos by cosine similarity ──
  const maxVideos = Math.ceil(maxResources * 0.6);
  const ranked = await rankVideosBySimilarity(queryEmbedding, savedUrls, maxVideos + 2);

  console.log(
    `      🎯 Top ranked: ${ranked.map((r) => `${r.score.toFixed(3)}`).join(", ")}`
  );

  // ── Step 5: Select top-ranked videos (already duration-filtered at Step 1) ──
  const selectedVideos: LiveResource[] = [];
  for (const { url, score } of ranked) {
    if (selectedVideos.length >= maxVideos) break;
    const vid = freshVideos.find((v) => v.url === url);
    if (vid) {
      selectedVideos.push({ ...vid, similarityScore: score });
      const videoId = extractYouTubeId(vid.url);
      if (videoId) usedVideoIds.add(videoId);
    }
  }

  // ── Step 6: Add articles (no embedding needed) ──
  const selectedArticles: LiveResource[] = [];
  for (const art of webResults) {
    if (selectedVideos.length + selectedArticles.length >= maxResources) break;
    if (art.type === "video") continue; // Skip YT links from Google
    const norm = normalizeUrl(art.url);
    if (!usedArticleUrls.has(norm)) {
      selectedArticles.push(art);
      usedArticleUrls.add(norm);
    }
  }

  // Save articles to DB (without embeddings)
  for (const art of selectedArticles) {
    try {
      await prisma.resource.upsert({
        where: { url: art.url },
        update: { updatedAt: new Date() },
        create: {
          title: art.title,
          url: art.url,
          type: art.type,
          difficulty: diffLabel,
          tags: [skill.toLowerCase(), node.title.toLowerCase()],
          source: art.source,
          summary: art.snippet,
        },
      });
    } catch {
      // Skip
    }
  }

  const selected = [...selectedVideos, ...selectedArticles];
  const finalVids = selected.filter((r) => r.type === "video").length;
  console.log(
    `      ✅ Selected: ${finalVids} videos + ${selected.length - finalVids} articles = ${selected.length} total`
  );

  return selected;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Get minimum allowed video duration based on session length.
 */
function getMinDuration(sessionLength: string): number {
  switch (sessionLength) {
    case "short":
      return 3;       // 3-15 minutes
    case "regular":
      return 15;      // 15-45 minutes
    case "dedicated":
      return 45;      // 45+ minutes
    default:
      return 3;
  }
}

/**
 * Get maximum allowed video duration based on session length.
 */
function getMaxDuration(sessionLength: string): number {
  switch (sessionLength) {
    case "short":
      return 15;      // 3-15 minutes
    case "regular":
      return 45;      // 15-45 minutes
    case "dedicated":
      return 9999;    // 45+ minutes, no upper limit
    default:
      return 45;
  }
}

/**
 * Check if a video duration matches the user's session length preference.
 * Loose matching — prefers matching but doesn't strictly exclude.
 */
function matchesDuration(
  duration: string | null,
  sessionLength: string
): boolean {
  if (!duration) return true;

  const minutes = parseDurationToMinutes(duration);
  if (minutes === 0) return true;

  switch (sessionLength) {
    case "short":
      return minutes >= 3 && minutes <= 15;
    case "regular":
      return minutes > 15 && minutes <= 45;
    case "dedicated":
      return minutes > 45;
    default:
      return true;
  }
}

function parseDurationToMinutes(duration: string): number {
  // Handle "X minutes" format
  const minMatch = duration.match(/(\d+)\s*minutes?/i);
  if (minMatch) return parseInt(minMatch[1]);

  // Handle "X hours Y minutes" format
  const hourMatch = duration.match(/(\d+)\s*hours?/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    const mins = minMatch ? parseInt(minMatch[1]) : 0;
    return hours * 60 + mins;
  }

  // Handle "X seconds" format
  const secMatch = duration.match(/(\d+)\s*seconds?/i);
  if (secMatch) return Math.ceil(parseInt(secMatch[1]) / 60);

  return 0;
}

function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function parseISO8601Duration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "Unknown";
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");
  if (hours > 0)
    return `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minutes`;
  if (minutes > 0) return `${minutes} minutes`;
  return `${seconds} seconds`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url.toLowerCase().trim();
  }
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const names: Record<string, string> = {
      "youtube.com": "YouTube",
      "github.com": "GitHub",
      "dev.to": "Dev.to",
      "medium.com": "Medium",
      "freecodecamp.org": "freeCodeCamp",
      "developer.mozilla.org": "MDN",
      "stackoverflow.com": "StackOverflow",
      "w3schools.com": "W3Schools",
      "geeksforgeeks.org": "GeeksForGeeks",
      "tutorialspoint.com": "TutorialsPoint",
      "digitalocean.com": "DigitalOcean",
      "baeldung.com": "Baeldung",
    };
    return names[hostname] || hostname;
  } catch {
    return "Web";
  }
}

function classifyUrl(url: string): LiveResource["type"] {
  const lower = url.toLowerCase();
  if (
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("dailymotion") ||
    lower.includes("vimeo.com")
  )
    return "video";
  if (lower.includes("github.com")) return "repo";
  if (
    lower.includes("docs.") ||
    lower.includes("/docs/") ||
    lower.includes("documentation") ||
    lower.includes("developer.mozilla.org") ||
    lower.includes("devdocs.io")
  )
    return "documentation";
  return "article";
}
