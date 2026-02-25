/**
 * Scoring utility helpers for the recommendation engine.
 */

/** Clamp a value between min and max */
export function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalize a value from [inMin, inMax] to [0, 1] */
export function normalize(value: number, inMin: number, inMax: number): number {
  if (inMax === inMin) return 0.5;
  return clamp((value - inMin) / (inMax - inMin));
}

/** Weighted average of values with corresponding weights */
export function weightedAverage(
  values: number[],
  weights: number[]
): number {
  if (values.length !== weights.length) {
    throw new Error("Values and weights arrays must have the same length");
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = values.reduce((sum, v, i) => sum + v * weights[i], 0);
  return weightedSum / totalWeight;
}

/** Calculate recency score based on how recent a resource is (0-1) */
export function calculateRecencyScore(createdAt: Date): number {
  const now = new Date();
  const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // Resources less than 30 days old get score 1.0
  // Score decays over 2 years (730 days)
  if (ageInDays <= 30) return 1.0;
  if (ageInDays >= 730) return 0.1;
  return clamp(1.0 - (ageInDays - 30) / 700);
}

/** Format match score: 1.0 if resource type matches any preference, 0.2 otherwise */
export function calculateFormatMatchScore(
  resourceType: string,
  contentPreferences: string[]
): number {
  const typeMapping: Record<string, string[]> = {
    video: ["video"],
    article: ["text", "article"],
    documentation: ["text", "documentation", "docs"],
    tutorial: ["text", "tutorial", "hands-on"],
    repo: ["hands-on", "practice", "external_links"],
    course: ["video", "hands-on"],
    interactive: ["hands-on", "interactive", "practice"],
    "external_links": ["external_links"],
  };

  const normalizedPrefs = contentPreferences.map((p) => p.toLowerCase().trim());
  const matchesFor = typeMapping[resourceType.toLowerCase()] || [resourceType.toLowerCase()];

  for (const match of matchesFor) {
    if (normalizedPrefs.includes(match)) return 1.0;
  }
  return 0.2;
}

/**
 * Check if a resource duration is compatible with the user's session length preference.
 * @param duration String duration (e.g., "15:20" for videos, or null)
 * @param sessionLength "short" (0-10m), "regular" (10-30m), "dedicated" (>30m)
 */
export function isSessionLengthCompatible(
  duration: string | null,
  sessionLength: string
): boolean {
  if (!duration) return true; // Default to compatible if no duration info

  // Try to parse duration (expecting format like MM:SS or HH:MM:SS)
  const parts = duration.split(":").map(Number);
  let totalMinutes = 0;
  
  if (parts.length === 2) {
    totalMinutes = parts[0];
  } else if (parts.length === 3) {
    totalMinutes = parts[0] * 60 + parts[1];
  } else {
    return true; // Unrecognized format, don't filter it out
  }


  if (sessionLength === "short") {
    return totalMinutes <= 10;
  } else if (sessionLength === "regular") {
    return totalMinutes >= 5 && totalMinutes <= 45;
  } else if (sessionLength === "dedicated") {
    return totalMinutes >= 20;
  }

  return true;
}
