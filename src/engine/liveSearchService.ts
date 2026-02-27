/**
 * Live Search Service – performs real-time, concept-specific searches
 * using Serper.dev (Google Search + Video Search APIs).
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

// ── Serper Video Search ────────────────────────────────────

/**
 * Search for videos using Serper.dev's /videos endpoint.
 * Returns YouTube and other platform video results.
 */
async function searchVideos(
  query: string,
  maxResults: number = 5
): Promise<LiveResource[]> {
  const apiKey = config.serperApiKey;
  if (!apiKey) {
    console.warn("   ⚠️ SERPER_API_KEY not set, skipping video search");
    return [];
  }

  try {
    const response = await axios.post(
      "https://google.serper.dev/videos",
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

    const videos = response.data?.videos || [];

    return videos.map((v: any) => ({
      title: decodeHtmlEntities(v.title || ""),
      url: v.link,
      type: "video" as const,
      source: extractDomain(v.link),
      duration: v.duration || null,
      snippet: v.snippet?.slice(0, 200) || null,
    }));
  } catch (err: any) {
    console.error(`   ⚠️ Video search failed for "${query}": ${err.message}`);
    return [];
  }
}

// ── Serper Web Search ──────────────────────────────────────

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
 * @param usedUrls - Set of URLs already used in previous nodes (strict global dedup — NO duplicates at all)
 */
export async function searchResourcesForNode(
  node: SlaveNodeSearchInput,
  usedUrls: Set<string>,
  maxResources: number = 3
): Promise<LiveResource[]> {
  // Use the node TITLE for video search (most specific) and search terms for web search
  const videoQuery = node.title + " tutorial";
  const webQuery = node.searchTerms[0] || node.title;

  // Run video and web searches in parallel
  const [videoResults, webResults] = await Promise.all([
    searchVideos(videoQuery, 6),
    searchGoogle(webQuery, 5),
  ]);

  // Strict global dedup — no resource appears in more than one slave node
  const availableVideos: LiveResource[] = [];
  const availableNonVideos: LiveResource[] = [];
  const seenUrls = new Set<string>();

  for (const result of videoResults) {
    const normalized = normalizeUrl(result.url);
    if (!usedUrls.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      availableVideos.push(result);
    }
  }

  for (const result of webResults) {
    const normalized = normalizeUrl(result.url);
    if (!usedUrls.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      // Web results that are actually videos go to video pool
      if (result.type === "video") {
        availableVideos.push(result);
      } else {
        availableNonVideos.push(result);
      }
    }
  }

  // Build final selection: 1 video (guaranteed) + mix of other types
  const selected: LiveResource[] = [];

  // Always include at least 1 video
  if (availableVideos.length > 0) {
    selected.push(availableVideos[0]);
  }

  // Fill with non-videos for variety
  for (const item of availableNonVideos) {
    if (selected.length >= maxResources) break;
    selected.push(item);
  }

  // If still have room, add more videos
  for (const item of availableVideos.slice(1)) {
    if (selected.length >= maxResources) break;
    selected.push(item);
  }

  // Mark ALL selected URLs as used globally
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
