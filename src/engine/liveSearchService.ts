/**
 * Live Search Service – performs real-time, concept-specific searches
 * using YouTube Data API + Serper.dev (Google Search API).
 *
 * This replaces the old pre-crawl + embedding approach with targeted
 * live searches for each slave node's specific topic.
 */

import axios from "axios";
import { config } from "../config/environment";

// ── Types ──────────────────────────────────────────────────

export interface LiveResource {
  title: string;
  url: string;
  type: "video" | "article" | "documentation" | "repo" | "tutorial";
  source: string;
  duration: string | null;
  snippet: string | null;
}

// ── YouTube Search ─────────────────────────────────────────

/**
 * Search YouTube for videos matching a specific query.
 * Returns focused, topic-specific video results.
 */
async function searchYouTube(
  query: string,
  maxResults: number = 3
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
          maxResults: maxResults + 2, // fetch extra in case of dedup
          order: "relevance",
          relevanceLanguage: "en",
        },
        timeout: 10000,
      }
    );

    const items = response.data?.items || [];

    // Get video durations in a batch call
    const videoIds = items.map((item: any) => item.id.videoId).join(",");
    let durations: Record<string, string> = {};

    if (videoIds) {
      try {
        const detailsResponse = await axios.get(
          "https://www.googleapis.com/youtube/v3/videos",
          {
            params: {
              key: apiKey,
              id: videoIds,
              part: "contentDetails",
            },
            timeout: 10000,
          }
        );

        for (const video of detailsResponse.data?.items || []) {
          durations[video.id] = parseISO8601Duration(
            video.contentDetails.duration
          );
        }
      } catch {
        // Duration fetch failed, continue without durations
      }
    }

    return items.map((item: any) => ({
      title: decodeHtmlEntities(item.snippet.title),
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      type: "video" as const,
      source: "YouTube",
      duration: durations[item.id.videoId] || null,
      snippet: item.snippet.description?.slice(0, 200) || null,
    }));
  } catch (err: any) {
    console.error(`   ⚠️ YouTube search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ── Serper.dev (Google Search) ─────────────────────────────

/**
 * Search Google via Serper.dev for articles, docs, tutorials.
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
        q: query + " tutorial OR guide OR documentation",
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
      type: classifyUrl(result.link, result.title),
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
}

/**
 * Search for resources for a single slave node.
 * Guarantees at least 1 video result. Returns deduplicated, ranked results.
 *
 * @param usedUrls - Set of URLs already used in previous nodes (for global dedup)
 */
export async function searchResourcesForNode(
  node: SlaveNodeSearchInput,
  usedUrls: Set<string>,
  maxResources: number = 3
): Promise<LiveResource[]> {
  // Use the first search term for primary search
  const primaryQuery = node.searchTerms[0] || node.title;
  const secondaryQuery = node.searchTerms[1] || node.title;

  // Run YouTube and Google searches in parallel
  const [youtubeResults, googleResults] = await Promise.all([
    searchYouTube(primaryQuery, 4),
    searchGoogle(secondaryQuery, 5),
  ]);

  // Deduplicate: remove URLs already used in other slave nodes
  const allResults: LiveResource[] = [];
  const seenUrls = new Set<string>();

  // Add YouTube results first (videos are priority)
  for (const result of youtubeResults) {
    const normalized = normalizeUrl(result.url);
    if (!usedUrls.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      allResults.push(result);
    }
  }

  // Add Google results (articles, docs, tutorials)
  for (const result of googleResults) {
    const normalized = normalizeUrl(result.url);
    if (!usedUrls.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      allResults.push(result);
    }
  }

  // Enforce: at least 1 video, then fill with variety
  const videos = allResults.filter((r) => r.type === "video");
  const nonVideos = allResults.filter((r) => r.type !== "video");

  const selected: LiveResource[] = [];

  // Always include at least 1 video
  if (videos.length > 0) {
    selected.push(videos[0]);
  }

  // Fill remaining slots with non-videos for variety, then more videos
  const remaining = maxResources - selected.length;
  const pool = [...nonVideos, ...videos.slice(1)];
  for (const item of pool) {
    if (selected.length >= maxResources) break;
    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  // Mark these URLs as used
  for (const r of selected) {
    usedUrls.add(normalizeUrl(r.url));
  }

  return selected;
}

// ── Helpers ────────────────────────────────────────────────

function parseISO8601Duration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "Unknown";
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minutes`;
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
    // Friendly names for common sources
    const names: Record<string, string> = {
      "youtube.com": "YouTube",
      "github.com": "GitHub",
      "dev.to": "Dev.to",
      "medium.com": "Medium",
      "freecodecamp.org": "freeCodeCamp",
      "developer.mozilla.org": "MDN",
      "stackoverflow.com": "StackOverflow",
      "docs.google.com": "Google Docs",
      "w3schools.com": "W3Schools",
      "geeksforgeeks.org": "GeeksForGeeks",
      "tutorialspoint.com": "TutorialsPoint",
      "digitalocean.com": "DigitalOcean",
      "baeldung.com": "Baeldung",
      "css-tricks.com": "CSS-Tricks",
      "smashingmagazine.com": "Smashing Magazine",
    };
    return names[hostname] || hostname;
  } catch {
    return "Web";
  }
}

function classifyUrl(url: string, title: string): LiveResource["type"] {
  const lower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "video";
  if (lower.includes("github.com")) return "repo";
  if (
    lower.includes("docs.") ||
    lower.includes("/docs/") ||
    lower.includes("documentation") ||
    lower.includes("developer.mozilla.org") ||
    lower.includes("devdocs.io")
  ) return "documentation";
  if (
    titleLower.includes("tutorial") ||
    titleLower.includes("how to") ||
    titleLower.includes("step by step") ||
    titleLower.includes("guide")
  ) return "tutorial";

  return "article";
}
