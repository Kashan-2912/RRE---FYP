/**
 * Crawler Service – discovers and retrieves learning resources
 * from multiple platforms: YouTube, GitHub, Dev.to, Medium,
 * freeCodeCamp, and MDN.
 */

import axios from "axios";
import { config } from "../config/environment";

// ── Types ──────────────────────────────────────────────────

export interface RawResource {
  title: string;
  url: string;
  type: string;          // video, article, repo, course, tutorial, documentation
  source: string;        // YouTube, GitHub, Medium, Dev.to, freeCodeCamp, MDN
  description?: string;
  tags: string[];
  publishedAt?: string;
  duration?: string;
  metadata?: Record<string, any>;
}

// ── YouTube Crawler ────────────────────────────────────────

/**
 * Crawl YouTube for educational videos using the Data API v3.
 */
export async function crawlYouTube(
  skill: string,
  maxResults: number = 20
): Promise<RawResource[]> {
  if (!config.youtubeApiKey) {
    console.log("⚠️  No YOUTUBE_API_KEY set, skipping YouTube crawl");
    return [];
  }

  try {
    const query = `${skill} tutorial programming`;
    const response = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: {
        part: "snippet",
        q: query,
        type: "video",
        maxResults,
        relevanceLanguage: "en",
        videoDuration: "medium",
        key: config.youtubeApiKey,
      },
    });

    const videoIds = response.data.items.map((item: any) => item.id.videoId).join(",");

    // Get video details for duration
    const detailsResponse = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "contentDetails,statistics",
        id: videoIds,
        key: config.youtubeApiKey,
      },
    });

    const detailsMap = new Map<string, any>();
    for (const item of detailsResponse.data.items) {
      detailsMap.set(item.id, item);
    }

    return response.data.items.map((item: any) => {
      const details = detailsMap.get(item.id.videoId);
      const duration = details ? parseISO8601Duration(details.contentDetails.duration) : undefined;
      const viewCount = details ? parseInt(details.statistics.viewCount || "0") : 0;

      return {
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        type: "video",
        source: "YouTube",
        description: item.snippet.description,
        tags: [skill.toLowerCase().replace(/\s+/g, "-")],
        publishedAt: item.snippet.publishedAt,
        duration,
        metadata: { viewCount, channelTitle: item.snippet.channelTitle },
      };
    });
  } catch (error: any) {
    console.error(`❌ YouTube crawl error: ${error.message}`);
    return [];
  }
}

// ── GitHub Crawler ─────────────────────────────────────────

/**
 * Crawl GitHub for educational repositories.
 */
export async function crawlGitHub(
  skill: string,
  maxResults: number = 15
): Promise<RawResource[]> {
  try {
    const query = `${skill} tutorial learning`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (config.githubToken) {
      headers.Authorization = `token ${config.githubToken}`;
    }

    const response = await axios.get("https://api.github.com/search/repositories", {
      params: {
        q: `${query} in:name,description,readme`,
        sort: "stars",
        order: "desc",
        per_page: maxResults,
      },
      headers,
    });

    return response.data.items.map((repo: any) => ({
      title: repo.full_name,
      url: repo.html_url,
      type: "repo",
      source: "GitHub",
      description: repo.description || "",
      tags: [
        skill.toLowerCase().replace(/\s+/g, "-"),
        ...(repo.topics || []).slice(0, 5),
      ],
      publishedAt: repo.created_at,
      metadata: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
      },
    }));
  } catch (error: any) {
    console.error(`❌ GitHub crawl error: ${error.message}`);
    return [];
  }
}

// ── Dev.to Crawler ─────────────────────────────────────────

/**
 * Crawl Dev.to articles (free API, no key needed).
 */
export async function crawlDevTo(
  skill: string,
  maxResults: number = 15
): Promise<RawResource[]> {
  try {
    const response = await axios.get("https://dev.to/api/articles", {
      params: {
        tag: skill.toLowerCase().replace(/\s+/g, ""),
        per_page: maxResults,
        top: 365, // top articles from past year
      },
    });

    return response.data.map((article: any) => ({
      title: article.title,
      url: article.url,
      type: "article",
      source: "Dev.to",
      description: article.description,
      tags: [
        skill.toLowerCase().replace(/\s+/g, "-"),
        ...(article.tag_list || []),
      ],
      publishedAt: article.published_at,
      duration: `${article.reading_time_minutes} minutes`,
      metadata: {
        reactions: article.positive_reactions_count,
        comments: article.comments_count,
        author: article.user?.name,
      },
    }));
  } catch (error: any) {
    console.error(`❌ Dev.to crawl error: ${error.message}`);
    return [];
  }
}

// ── Medium Crawler (via RSS) ───────────────────────────────

/**
 * Crawl Medium articles using RSS-to-JSON proxy.
 */
export async function crawlMedium(
  skill: string,
  maxResults: number = 10
): Promise<RawResource[]> {
  try {
    const tag = skill.toLowerCase().replace(/\s+/g, "-");
    const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=https://medium.com/feed/tag/${tag}`;
    const response = await axios.get(rssUrl);

    if (response.data.status !== "ok") return [];

    return response.data.items.slice(0, maxResults).map((item: any) => ({
      title: item.title,
      url: item.link,
      type: "article",
      source: "Medium",
      description: stripHtml(item.description || "").slice(0, 500),
      tags: [skill.toLowerCase().replace(/\s+/g, "-")],
      publishedAt: item.pubDate,
      duration: estimateReadingTime(item.content || item.description || ""),
      metadata: { author: item.author },
    }));
  } catch (error: any) {
    console.error(`❌ Medium crawl error: ${error.message}`);
    return [];
  }
}

// ── freeCodeCamp Crawler ───────────────────────────────────

/**
 * Crawl freeCodeCamp news articles.
 */
export async function crawlFreeCodeCamp(
  skill: string,
  maxResults: number = 10
): Promise<RawResource[]> {
  try {
    const query = skill.toLowerCase().replace(/\s+/g, "+");
    const response = await axios.get(
      `https://www.freecodecamp.org/news/ghost/api/v3/content/posts/`,
      {
        params: {
          key: "b830f74af9ec97c5b03c5de7cf",  // public content API key
          filter: `tag:${skill.toLowerCase().replace(/\s+/g, "-")}`,
          limit: maxResults,
          fields: "title,url,excerpt,published_at,reading_time,slug",
        },
      }
    );

    if (!response.data?.posts) return [];

    return response.data.posts.map((post: any) => ({
      title: post.title,
      url: `https://www.freecodecamp.org/news/${post.slug}/`,
      type: "tutorial",
      source: "freeCodeCamp",
      description: post.excerpt || "",
      tags: [skill.toLowerCase().replace(/\s+/g, "-")],
      publishedAt: post.published_at,
      duration: `${post.reading_time || 5} minutes`,
    }));
  } catch (error: any) {
    console.error(`❌ freeCodeCamp crawl error: ${error.message}`);
    return [];
  }
}

// ── MDN Crawler ────────────────────────────────────────────

/**
 * Crawl MDN Web Docs via their search API.
 */
export async function crawlMDN(
  skill: string,
  maxResults: number = 10
): Promise<RawResource[]> {
  try {
    const response = await axios.get("https://developer.mozilla.org/api/v1/search", {
      params: {
        q: skill,
        size: maxResults,
        locale: "en-US",
      },
    });

    if (!response.data?.documents) return [];

    return response.data.documents.map((doc: any) => ({
      title: doc.title,
      url: `https://developer.mozilla.org${doc.mdn_url}`,
      type: "documentation",
      source: "MDN",
      description: doc.summary || "",
      tags: [skill.toLowerCase().replace(/\s+/g, "-"), "web-development"],
      duration: "10 minutes",
    }));
  } catch (error: any) {
    console.error(`❌ MDN crawl error: ${error.message}`);
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────

/** Parse ISO 8601 duration (PT1H30M10S) to human-readable */
function parseISO8601Duration(duration: string): string {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "Unknown";
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minutes`;
  return `${minutes} minutes`;
}

/** Strip HTML tags from a string */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
}

/** Estimate reading time from content */
function estimateReadingTime(content: string): string {
  const text = stripHtml(content);
  const words = text.split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} minutes`;
}

/**
 * Crawl all sources for a given skill.
 */
export async function crawlAllSources(
  skill: string,
  maxPerSource: number = 15
): Promise<RawResource[]> {
  console.log(`\n🕷️  Crawling all sources for: "${skill}"`);

  const results = await Promise.allSettled([
    crawlYouTube(skill, maxPerSource),
    crawlGitHub(skill, maxPerSource),
    crawlDevTo(skill, maxPerSource),
    crawlMedium(skill, Math.min(maxPerSource, 10)),
    crawlFreeCodeCamp(skill, Math.min(maxPerSource, 10)),
    crawlMDN(skill, Math.min(maxPerSource, 10)),
  ]);

  const allResources: RawResource[] = [];
  const sourceNames = ["YouTube", "GitHub", "Dev.to", "Medium", "freeCodeCamp", "MDN"];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      console.log(`   ✅ ${sourceNames[i]}: ${result.value.length} resources`);
      allResources.push(...result.value);
    } else {
      console.log(`   ❌ ${sourceNames[i]}: failed – ${result.reason}`);
    }
  }

  console.log(`   📊 Total: ${allResources.length} raw resources crawled\n`);
  return allResources;
}
