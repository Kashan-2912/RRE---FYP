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

  return `You are an expert curriculum designer and technical educator with deep knowledge across all technology domains. Your job is to design a comprehensive, structured learning roadmap.

## TASK
Create a detailed learning roadmap for the skill: "${input.skill}"

## LEARNER PROFILE
- **Proficiency Score**: ${input.proficiencyScore}/10 — ${proficiencyContext}
- **Starting Difficulty**: ${input.difficultyPreference} — ${difficultyMap[input.difficultyPreference] || ""}
- **Learning Pace**: ${input.learningPace} — ${paceMap[input.learningPace] || ""}
- **Session Length**: ${input.sessionLength} — ${sessionMap[input.sessionLength] || ""}
- **Preferred Content Types**: ${contentPrefsStr}

## ROADMAP STRUCTURE RULES

1. **Master Nodes** represent major topic areas/milestones in the learning journey. They MUST be ordered sequentially — a learner should complete Master Node 1 before moving to Master Node 2, etc.

2. **Slave Nodes** are specific sub-concepts within each Master Node. Each slave node represents one focused learning unit.

3. The roadmap must be specifically tailored to "${input.skill}" — not a generic template. Use real, specific topic names, frameworks, tools, and concepts that are actually part of learning this skill.

4. The number of master nodes should vary based on the skill's breadth and the learner's proficiency. Use between 4 and 12 master nodes. Broader skills (e.g., "Web Development") need more master nodes; narrower skills (e.g., "CSS Grid") need fewer. Lower proficiency = more nodes to cover fundamentals. Higher proficiency = fewer but deeper nodes.

5. Each master node should have between 2 and 8 slave nodes, depending on how complex that topic area is. Some master nodes may need only 2-3 slave nodes if the topic is narrow, others may need 6-8 if the topic is broad. Vary the count naturally — don't make every master node have the same number.

6. Slave node titles should be specific and searchable (e.g., "React useState Hook" not just "State"). These titles will be used to search for real learning resources, so make them specific enough to find relevant content.

7. Each slave node must specify:
   - A clear, specific title
   - A 1-2 sentence description of what the learner will understand after completing this node
   - The difficulty level (beginner/intermediate/advanced/expert)
   - Which content types are most useful for this specific concept (from the learner's preferences: ${input.contentPreferences.join(", ")})
   - 2-3 specific search terms that would find the best resources for this concept (e.g., "React useEffect tutorial beginner", "CSS Grid layout guide")

8. Search terms must be:
   - Specific to the concept (not generic like "learn programming")
   - Include the technology/skill name
   - Mix of tutorial-focused and concept-focused queries
   - Appropriate for the difficulty level

9. The roadmap should have a logical progression where later nodes build on earlier ones.

10. Provide a brief overall summary of the roadmap and an estimated total learning time in hours.

## RESPONSE FORMAT
You MUST respond with ONLY a valid JSON object (no markdown, no code fences, no extra text). The JSON must strictly follow this schema:

{
  "skill": "string — the skill name",
  "summary": "string — 2-3 sentence overview of what this roadmap covers and the learning journey",
  "estimatedTotalHours": number,
  "masterNodes": [
    {
      "title": "string — major topic area name",
      "description": "string — what this master node covers and why it's important",
      "order": number (starting from 1),
      "slaveNodes": [
        {
          "title": "string — specific concept name",
          "description": "string — what the learner will understand after this",
          "difficulty": "beginner" | "intermediate" | "advanced" | "expert",
          "contentTypes": ["array of preferred content types for this concept"],
          "searchTerms": ["array of 2-3 specific search queries"]
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
        max_tokens: 8192,
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

