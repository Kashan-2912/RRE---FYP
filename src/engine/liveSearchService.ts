/**
 * Live Search Service – performs real-time, concept-specific searches
 * using YouTube Data API (for videos) + Serper.dev (for articles/docs).
 *
 * Videos come ONLY from YouTube API — Serper /videos was removed because
 * it returned LinkedIn/Instagram/TikTok results, not educational content.
 */

import axios from "axios";
import { config } from "../config/environment";
import prisma from "../config/database";

// ── Types ──────────────────────────────────────────────────

export interface LiveResource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "repo";
  source: string;
  duration: string | null;
  snippet: string | null;
}

// ── YouTube Data API ───────────────────────────────────────

/**
 * Search YouTube directly via YouTube Data API v3.
 * This is the ONLY source for video content — guaranteed YouTube-only.
 */
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
    console.error(
      `   ⚠️ YouTube search failed for "${query}": ${err.message}`
    );
    return [];
  }
}

// ── Serper Web Search ──────────────────────────────────────

/**
 * Search Google via Serper.dev for articles, docs, repos.
 * Returns highly relevant web results for a specific concept.
 */
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
      {
        q: query,
        num: maxResults,
      },
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
    console.error(`   ⚠️ Serper search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ── Main Search Function ───────────────────────────────────

export interface SlaveNodeSearchInput {
  title: string;
  searchTerms: string[];
  contentTypes: string[];
  difficulty: string;
}

/**
 * Search for resources for a single slave node.
 * YouTube API for videos + Serper for articles.
 * Videos are deduped by YouTube VIDEO ID (not URL), articles by URL.
 */
export async function searchResourcesForNode(
  node: SlaveNodeSearchInput,
  skill: string,
  usedVideoIds: Set<string>,
  usedArticleUrls: Set<string>,
  maxResources: number = 5
): Promise<LiveResource[]> {
  const diffLabel =
    node.difficulty === "expert" ? "advanced" : node.difficulty;

  // Different queries for videos vs articles for better diversity
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

  // Dedup videos by YouTube VIDEO ID (extract from URL)
  const availableVideos: LiveResource[] = [];
  for (const vid of youtubeResults) {
    const videoId = extractYouTubeId(vid.url);
    if (videoId && !usedVideoIds.has(videoId)) {
      availableVideos.push(vid);
    }
  }

  // Dedup articles by normalized URL
  const availableArticles: LiveResource[] = [];
  const seenArticles = new Set<string>();
  for (const art of webResults) {
    // Filter out YouTube links from web results (we have them from YT API)
    if (art.type === "video") continue;
    const norm = normalizeUrl(art.url);
    if (!usedArticleUrls.has(norm) && !seenArticles.has(norm)) {
      seenArticles.add(norm);
      availableArticles.push(art);
    }
  }

  console.log(
    `      📊 After dedup: ${availableVideos.length} YT videos, ${availableArticles.length} articles (${usedVideoIds.size} used video IDs, ${usedArticleUrls.size} used article URLs)`
  );

  // Build selection: ~60% videos
  const selected: LiveResource[] = [];
  const maxVideos = Math.ceil(maxResources * 0.6);

  // Add videos first
  for (const item of availableVideos) {
    if (selected.length >= maxVideos) break;
    selected.push(item);
    const vid = extractYouTubeId(item.url);
    if (vid) usedVideoIds.add(vid);
  }

  // Fill with articles
  for (const item of availableArticles) {
    if (selected.length >= maxResources) break;
    selected.push(item);
    usedArticleUrls.add(normalizeUrl(item.url));
  }

  // If still room, add more videos
  for (const item of availableVideos.slice(maxVideos)) {
    if (selected.length >= maxResources) break;
    const vid = extractYouTubeId(item.url);
    if (vid && !usedVideoIds.has(vid)) {
      selected.push(item);
      usedVideoIds.add(vid);
    }
  }

  const finalVids = selected.filter((r) => r.type === "video").length;
  console.log(
    `      ✅ Selected: ${finalVids} videos + ${selected.length - finalVids} articles = ${selected.length} total`
  );

  // Save each resource to DB
  for (const r of selected) {
    try {
      await prisma.resource.upsert({
        where: { url: r.url },
        update: { updatedAt: new Date() },
        create: {
          title: r.title,
          url: r.url,
          type: r.type,
          difficulty: node.difficulty,
          duration: r.duration,
          tags: [skill.toLowerCase(), node.title.toLowerCase()],
          source: r.source,
          summary: r.snippet,
        },
      });
    } catch {
      // Silently skip save failures (e.g. constraint violations)
    }
  }

  return selected;
}

// ── Helpers ────────────────────────────────────────────────

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
