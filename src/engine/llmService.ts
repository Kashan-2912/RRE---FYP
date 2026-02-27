/**
 * LLM Service – calls Google Gemini (free tier) to generate a structured
 * learning roadmap given user profile details.
 *
 * Uses the Gemini REST API directly (no SDK needed) with structured JSON output.
 */

import axios from "axios";
import { config } from "../config/environment";

// ── Types ──────────────────────────────────────────────────

export interface SlaveNodeSkeleton {
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  contentTypes: string[];
  searchTerms: string[];
}

export interface MasterNodeSkeleton {
  title: string;
  description: string;
  order: number;
  slaveNodes: SlaveNodeSkeleton[];
}

export interface RoadmapSkeleton {
  skill: string;
  summary: string;
  estimatedTotalHours: number;
  masterNodes: MasterNodeSkeleton[];
}

export interface RoadmapUserInput {
  skill: string;
  contentPreferences: string[];
  learningPace: string;
  sessionLength: string;
  difficultyPreference: string;
  proficiencyScore: number;
}

// ── Prompt Builder ─────────────────────────────────────────

function buildRoadmapPrompt(input: RoadmapUserInput): string {
  const paceMap: Record<string, string> = {
    slow: "The learner prefers a slow, thorough pace. Break concepts into very small, digestible pieces. Include more review/reinforcement nodes. Each slave node should cover a single narrow concept.",
    medium: "The learner prefers a moderate pace. Balance depth with breadth. Group related concepts logically but don't rush.",
    fast: "The learner prefers an accelerated pace. Be concise, skip basics they likely know, focus on practical application. Combine closely related concepts into single nodes where possible.",
  };

  const sessionMap: Record<string, string> = {
    short: "The learner has short study sessions (5-10 minutes). Each slave node's content should be completable in under 10 minutes. Favor bite-sized content.",
    regular: "The learner has regular study sessions (15-30 minutes). Each slave node can have moderate-depth content.",
    dedicated: "The learner has dedicated study blocks (45-90 minutes). Each slave node can have in-depth, comprehensive content including longer videos and tutorials.",
  };

  const difficultyMap: Record<string, string> = {
    beginner: "Start from absolute fundamentals. Assume no prior knowledge of this skill. Explain prerequisites if any. Build up gradually.",
    moderate: "The learner has some familiarity. Skip very basic introductory content. Start from intermediate concepts but still provide some foundational review.",
    advanced: "The learner is already experienced. Focus on advanced patterns, performance optimization, best practices, edge cases, and professional-level techniques.",
  };

  const proficiencyContext = (() => {
    const s = input.proficiencyScore;
    if (s <= 2) return "Complete beginner. The roadmap must start from the very basics (what is this skill, how to set up environment, hello world equivalent).";
    if (s <= 4) return "Early learner. Knows the absolute basics but needs structured guidance through core concepts. Start just past 'hello world'.";
    if (s <= 6) return "Intermediate. Has working knowledge. Skip fundamentals like setup/installation. Focus on deepening understanding and introducing intermediate-to-advanced topics.";
    if (s <= 8) return "Advanced. Comfortable with the skill. Focus on advanced patterns, architecture, optimization, real-world project patterns, and less commonly known features.";
    return "Expert level. Focus only on cutting-edge features, performance mastery, contribution-level knowledge, and niche advanced topics.";
  })();

  const contentPrefsStr = input.contentPreferences.map(p => {
    const mapped: Record<string, string> = {
      video: "videos (YouTube tutorials, screencasts, conference talks)",
      article: "articles (blog posts, written tutorials, Medium/Dev.to articles)",
      repo: "repositories (GitHub repos with source code, example projects, boilerplates)",
      course: "courses (structured multi-part video courses)",
      tutorial: "tutorials (step-by-step hands-on guides)",
      documentation: "official documentation (API docs, reference guides, official manuals)",
    };
    return mapped[p] || p;
  }).join(", ");

  return `You are a world-class curriculum designer who creates detailed, progressive learning paths. You specialize in breaking complex skills into small, digestible learning units that build on each other organically — from the simplest atomic concept to advanced mastery.

## TASK
Create a comprehensive, granular learning roadmap for: "${input.skill}"

## LEARNER PROFILE
- **Proficiency Score**: ${input.proficiencyScore}/10 — ${proficiencyContext}
- **Starting Difficulty**: ${input.difficultyPreference} — ${difficultyMap[input.difficultyPreference] || ""}
- **Learning Pace**: ${input.learningPace} — ${paceMap[input.learningPace] || ""}
- **Session Length**: ${input.sessionLength} — ${sessionMap[input.sessionLength] || ""}
- **Preferred Content Types**: ${contentPrefsStr}

## CRITICAL RULES FOR ROADMAP QUALITY

### Structure
1. **Master Nodes** = major milestones/phases in the learning journey, ordered sequentially. A learner completes phase 1 before phase 2.
2. **Slave Nodes** = specific, atomic concepts within each phase. Each slave node teaches ONE focused thing.
3. You MUST generate AT LEAST 6 master nodes and AT MOST 12. Each master node MUST have AT LEAST 3 slave nodes and AT MOST 8. The roadmap must be COMPREHENSIVE — cover the ENTIRE skill from fundamentals to advanced topics, not just a handful of concepts.
4. IMPORTANT: The roadmap should cover ALL major areas of the skill. For example, for NextJS you must cover: project setup, pages/routing, components, data fetching, SSR/SSG/ISR, API routes, styling, middleware, authentication, deployment, testing, performance, etc. Do NOT skip major areas.

### Granularity — THIS IS THE MOST IMPORTANT RULE
5. Each slave node must teach a SINGLE, SPECIFIC concept — not an entire subject area. Think "one lesson" not "one course".

**BAD slave node examples (too broad):**
   - "What is ${input.skill}?" ← too vague, teach specific things instead
   - "Introduction to ${input.skill}" ← this is a course, not a concept
   - "Core Concepts" ← break these into individual concepts
   - "Setting up the environment" ← break into: install runtime, install CLI, create first project

**GOOD slave node examples (specific and atomic):**
   - For React: "JSX Syntax and Expressions", "Creating Functional Components", "useState for Local State", "Conditional Rendering with Ternaries"
   - For NestJS: "Decorators in TypeScript", "Creating Your First Controller", "Dependency Injection Basics", "Route Parameters and Query Strings"
   - For Python: "Variables and Data Types", "List Comprehensions", "Dictionary Methods", "Try/Except Error Handling"

6. Build from SMALL to BIG. The first master node should start with the smallest possible concept, not an overview. For example:
   - For React: Start with "What is JSX?" not "Introduction to React"
   - For NestJS: Start with "TypeScript Decorators" or "What are modules?" not "What is NestJS?"

### Search Terms
7. Each slave node's searchTerms must be UNIQUE and SPECIFIC to that exact concept. They will be used to find focused resources, NOT full courses.

**BAD search terms:** "${input.skill} full course", "${input.skill} tutorial for beginners", "learn ${input.skill}"
**GOOD search terms:** "${input.skill} decorators explained", "${input.skill} dependency injection tutorial", "${input.skill} middleware how to create"

8. Search terms should find SHORT, FOCUSED content (a single blog post about one topic, a 10-minute YouTube video on one concept) — NOT long comprehensive courses.

### Progression
9. Within each master node, slave nodes should progress from simpler to more complex.
10. Later master nodes should build on concepts from earlier ones. Reference this in descriptions.
11. Difficulty should progress naturally: early nodes mostly beginner, middle nodes intermediate, later nodes advanced.

### Content Variety
12. Distribute content types across slave nodes. Don't assign the same contentTypes to every node. Some concepts are better learned through video, others through documentation, others by reading code.

## RESPONSE FORMAT
Respond with ONLY valid JSON (no markdown, no code fences). Schema:

{
  "skill": "string",
  "summary": "string — 2-3 sentence overview of the learning journey",
  "estimatedTotalHours": number,
  "masterNodes": [
    {
      "title": "string — phase/milestone name",
      "description": "string — what this phase covers and why",
      "order": number,
      "slaveNodes": [
        {
          "title": "string — specific concept name",
          "description": "string — what the learner will understand after this single lesson",
          "difficulty": "beginner" | "intermediate" | "advanced" | "expert",
          "contentTypes": ["1-2 content types best suited for THIS specific concept"],
          "searchTerms": ["2-3 UNIQUE search queries specific to this exact concept"]
        }
      ]
    }
  ]
}`;
}

// ── Groq API Call (OpenAI-compatible) ──────────────────────

/**
 * Call Groq API to generate a roadmap skeleton.
 * Groq uses an OpenAI-compatible chat completions endpoint.
 */
export async function generateRoadmapFromLLM(
  input: RoadmapUserInput
): Promise<RoadmapSkeleton> {
  const apiKey = config.llmApiKey;
  if (!apiKey) {
    throw new Error(
      "LLM_API_KEY is not set. Please add your Groq API key to .env"
    );
  }

  const prompt = buildRoadmapPrompt(input);
  const model = config.llmModel;
  const url = "https://api.groq.com/openai/v1/chat/completions";

  console.log(`\n🤖 Calling Groq (${model}) for roadmap generation...`);
  console.log(`   Skill: ${input.skill}, Proficiency: ${input.proficiencyScore}/10`);

  try {
    const response = await axios.post(
      url,
      {
        model,
        messages: [
          {
            role: "system",
            content: "You are an expert curriculum designer. Always respond with valid JSON only. No markdown, no code fences, no extra text.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 16384,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 60000, // 60 second timeout for LLM
      }
    );

    // Extract the text response
    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) {
      console.error("❌ Empty LLM response:", JSON.stringify(response.data, null, 2));
      throw new Error("LLM returned an empty response");
    }

    // Parse JSON
    let roadmap: RoadmapSkeleton;
    try {
      roadmap = JSON.parse(text);
    } catch (parseErr) {
      // Try to extract JSON from potential markdown fencing
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        roadmap = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object directly
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) {
          roadmap = JSON.parse(objMatch[0]);
        } else {
          console.error("❌ Failed to parse LLM response as JSON:", text.slice(0, 500));
          throw new Error("LLM response is not valid JSON");
        }
      }
    }

    // Basic validation
    if (!roadmap.masterNodes || !Array.isArray(roadmap.masterNodes) || roadmap.masterNodes.length === 0) {
      throw new Error("LLM returned a roadmap with no master nodes");
    }

    // Ensure order is set correctly
    roadmap.masterNodes.forEach((node, idx) => {
      node.order = idx + 1;
    });

    // Set skill in case LLM changed it
    roadmap.skill = input.skill;

    console.log(`   ✅ Roadmap generated: ${roadmap.masterNodes.length} master nodes`);
    roadmap.masterNodes.forEach((mn) => {
      console.log(`      ${mn.order}. ${mn.title} (${mn.slaveNodes.length} sub-topics)`);
    });

    return roadmap;
  } catch (error: any) {
    if (error.response) {
      console.error("❌ Groq API error:", error.response.status, error.response.data);
      const errMsg = error.response.data?.error?.message || error.message;
      throw new Error(`Groq API error: ${errMsg}`);
    }
    throw error;
  }
}

