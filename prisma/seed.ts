/**
 * Seed script – populates the database with example learning resources.
 *
 * Run with: npm run seed
 */

import prisma from "../src/config/database";
import { generateEmbedding, buildResourceText } from "../src/vector/embeddingService";

interface SeedResource {
  title: string;
  url: string;
  type: string;
  difficulty: string;
  duration: string;
  tags: string[];
  source: string;
  summary: string;
  qualityScore: number;
  popularityScore: number;
  recencyScore: number;
}

const SEED_RESOURCES: SeedResource[] = [
  // ─── Web Development ────────────────────────────────
  {
    title: "Complete Web Development Bootcamp 2026",
    url: "https://www.youtube.com/watch?v=LzMnsfqjzkA",
    type: "video",
    difficulty: "beginner",
    duration: "2880 minutes",
    tags: ["web-development", "html", "css", "javascript"],
    source: "YouTube",
    summary: "A comprehensive bootcamp covering HTML, CSS, and JavaScript from scratch. Perfect for absolute beginners who want to build their first website.",
    qualityScore: 0.90,
    popularityScore: 0.85,
    recencyScore: 0.95,
  },
  {
    title: "Advanced React Patterns and Performance Optimization",
    url: "https://www.youtube.com/watch?v=keTcXT145CI",
    type: "video",
    difficulty: "advanced",
    duration: "96 minutes",
    tags: ["web-development", "react", "performance", "javascript"],
    source: "YouTube",
    summary: "Deep dive into React performance optimization techniques including memoization, code splitting, lazy loading, and advanced component patterns.",
    qualityScore: 0.92,
    popularityScore: 0.80,
    recencyScore: 0.90,
  },
  {
    title: "Building REST APIs with Node.js and Express",
    url: "https://dev.to/nodejs-express-api-guide",
    type: "article",
    difficulty: "intermediate",
    duration: "25 minutes",
    tags: ["web-development", "node.js", "express", "rest-api"],
    source: "Dev.to",
    summary: "Step-by-step guide to building production-ready REST APIs with Node.js, Express, and middleware patterns.",
    qualityScore: 0.78,
    popularityScore: 0.70,
    recencyScore: 0.85,
  },
  {
    title: "MDN CSS Grid Layout Guide",
    url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout",
    type: "documentation",
    difficulty: "intermediate",
    duration: "30 minutes",
    tags: ["web-development", "css", "css-grid", "layout"],
    source: "MDN",
    summary: "Official MDN documentation for CSS Grid Layout, covering all grid properties, alignment, and responsive design patterns.",
    qualityScore: 0.95,
    popularityScore: 0.90,
    recencyScore: 0.80,
  },
  {
    title: "Full-Stack TypeScript Project Structure",
    url: "https://github.com/fullstack-ts-template",
    type: "repo",
    difficulty: "advanced",
    duration: "60 minutes",
    tags: ["web-development", "typescript", "full-stack", "project-structure"],
    source: "GitHub",
    summary: "A production-ready full-stack TypeScript project template with monorepo setup, shared types, and CI/CD configuration.",
    qualityScore: 0.85,
    popularityScore: 0.75,
    recencyScore: 0.88,
  },
  {
    title: "freeCodeCamp Responsive Web Design Certification",
    url: "https://www.freecodecamp.org/learn/responsive-web-design/",
    type: "interactive",
    difficulty: "beginner",
    duration: "300 minutes",
    tags: ["web-development", "html", "css", "responsive-design"],
    source: "freeCodeCamp",
    summary: "Free interactive certification covering HTML, CSS, Flexbox, Grid, and responsive design with hands-on projects.",
    qualityScore: 0.92,
    popularityScore: 0.95,
    recencyScore: 0.75,
  },
  {
    title: "Next.js 14 Server Components Deep Dive",
    url: "https://www.youtube.com/watch?v=nextjs14-rsc",
    type: "video",
    difficulty: "advanced",
    duration: "55 minutes",
    tags: ["web-development", "next.js", "react", "server-components"],
    source: "YouTube",
    summary: "Comprehensive guide to React Server Components in Next.js 14, covering streaming, suspense, and data fetching patterns.",
    qualityScore: 0.88,
    popularityScore: 0.82,
    recencyScore: 0.98,
  },

  // ─── Machine Learning ───────────────────────────────
  {
    title: "Introduction to Machine Learning with Python",
    url: "https://www.youtube.com/watch?v=ml-python-intro",
    type: "video",
    difficulty: "beginner",
    duration: "90 minutes",
    tags: ["machine-learning", "python", "scikit-learn", "data-science"],
    source: "YouTube",
    summary: "Beginner-friendly introduction to machine learning concepts using Python and scikit-learn. Covers supervised learning, classification, and regression.",
    qualityScore: 0.88,
    popularityScore: 0.90,
    recencyScore: 0.85,
  },
  {
    title: "Neural Networks from Scratch in Python",
    url: "https://dev.to/neural-networks-scratch",
    type: "article",
    difficulty: "advanced",
    duration: "35 minutes",
    tags: ["machine-learning", "neural-networks", "python", "deep-learning"],
    source: "Dev.to",
    summary: "Build a neural network from scratch using only NumPy. Understand backpropagation, gradient descent, and activation functions at a fundamental level.",
    qualityScore: 0.82,
    popularityScore: 0.75,
    recencyScore: 0.80,
  },
  {
    title: "TensorFlow Official Tutorials",
    url: "https://www.tensorflow.org/tutorials",
    type: "documentation",
    difficulty: "intermediate",
    duration: "45 minutes",
    tags: ["machine-learning", "tensorflow", "deep-learning", "python"],
    source: "MDN",
    summary: "Official TensorFlow tutorials covering image classification, text processing, and model deployment with practical examples.",
    qualityScore: 0.93,
    popularityScore: 0.88,
    recencyScore: 0.90,
  },
  {
    title: "Awesome Machine Learning - Curated Resources",
    url: "https://github.com/josephmisiti/awesome-machine-learning",
    type: "repo",
    difficulty: "intermediate",
    duration: "20 minutes",
    tags: ["machine-learning", "resources", "curated-list"],
    source: "GitHub",
    summary: "Curated list of machine learning frameworks, libraries, and software organized by programming language. 60k+ GitHub stars.",
    qualityScore: 0.90,
    popularityScore: 0.95,
    recencyScore: 0.70,
  },

  // ─── Data Science ───────────────────────────────────
  {
    title: "Pandas for Data Analysis - Complete Guide",
    url: "https://www.youtube.com/watch?v=pandas-guide",
    type: "video",
    difficulty: "intermediate",
    duration: "60 minutes",
    tags: ["data-science", "python", "pandas", "data-analysis"],
    source: "YouTube",
    summary: "Complete guide to data analysis with Pandas: DataFrames, data cleaning, aggregation, merging, and visualization.",
    qualityScore: 0.85,
    popularityScore: 0.82,
    recencyScore: 0.88,
  },
  {
    title: "SQL for Data Scientists",
    url: "https://dev.to/sql-data-scientists",
    type: "article",
    difficulty: "beginner",
    duration: "20 minutes",
    tags: ["data-science", "sql", "databases", "analytics"],
    source: "Dev.to",
    summary: "Essential SQL skills every data scientist needs: JOINs, window functions, CTEs, and analytical queries with practical examples.",
    qualityScore: 0.78,
    popularityScore: 0.72,
    recencyScore: 0.82,
  },

  // ─── DevOps ─────────────────────────────────────────
  {
    title: "Docker and Kubernetes for Beginners",
    url: "https://www.youtube.com/watch?v=docker-k8s-beginners",
    type: "video",
    difficulty: "beginner",
    duration: "75 minutes",
    tags: ["devops", "docker", "kubernetes", "containers"],
    source: "YouTube",
    summary: "Start your DevOps journey with Docker containers and Kubernetes orchestration. Covers Dockerfiles, images, pods, services, and deployments.",
    qualityScore: 0.87,
    popularityScore: 0.88,
    recencyScore: 0.92,
  },
  {
    title: "CI/CD Pipeline with GitHub Actions",
    url: "https://dev.to/cicd-github-actions",
    type: "article",
    difficulty: "intermediate",
    duration: "15 minutes",
    tags: ["devops", "ci-cd", "github-actions", "automation"],
    source: "Dev.to",
    summary: "Set up automated CI/CD pipelines with GitHub Actions for testing, building, and deploying applications.",
    qualityScore: 0.80,
    popularityScore: 0.76,
    recencyScore: 0.95,
  },
  {
    title: "Infrastructure as Code with Terraform",
    url: "https://github.com/hashicorp/learn-terraform",
    type: "repo",
    difficulty: "advanced",
    duration: "45 minutes",
    tags: ["devops", "terraform", "infrastructure", "cloud"],
    source: "GitHub",
    summary: "Learn Terraform through hands-on examples. Manage cloud infrastructure declaratively with HashiCorp Configuration Language.",
    qualityScore: 0.88,
    popularityScore: 0.80,
    recencyScore: 0.85,
  },

  // ─── Cybersecurity ──────────────────────────────────
  {
    title: "Web Application Security - OWASP Top 10",
    url: "https://www.youtube.com/watch?v=owasp-top-10",
    type: "video",
    difficulty: "intermediate",
    duration: "50 minutes",
    tags: ["cybersecurity", "owasp", "web-security", "vulnerabilities"],
    source: "YouTube",
    summary: "Understanding the OWASP Top 10 web application security risks with practical demonstrations and mitigation strategies.",
    qualityScore: 0.86,
    popularityScore: 0.78,
    recencyScore: 0.88,
  },
  {
    title: "Ethical Hacking for Beginners",
    url: "https://www.freecodecamp.org/news/ethical-hacking-for-beginners/",
    type: "tutorial",
    difficulty: "beginner",
    duration: "40 minutes",
    tags: ["cybersecurity", "ethical-hacking", "penetration-testing"],
    source: "freeCodeCamp",
    summary: "Introduction to ethical hacking concepts, tools, and methodologies. Covers reconnaissance, scanning, and basic exploitation techniques.",
    qualityScore: 0.82,
    popularityScore: 0.85,
    recencyScore: 0.80,
  },

  // ─── Mobile Development ─────────────────────────────
  {
    title: "React Native Crash Course 2024",
    url: "https://www.youtube.com/watch?v=react-native-2024",
    type: "video",
    difficulty: "intermediate",
    duration: "65 minutes",
    tags: ["mobile-development", "react-native", "javascript", "cross-platform"],
    source: "YouTube",
    summary: "Build cross-platform mobile apps with React Native. Covers navigation, state management, native modules, and app store deployment.",
    qualityScore: 0.84,
    popularityScore: 0.80,
    recencyScore: 0.95,
  },
  {
    title: "Flutter & Dart - The Complete Developer's Guide",
    url: "https://dev.to/flutter-complete-guide",
    type: "article",
    difficulty: "beginner",
    duration: "30 minutes",
    tags: ["mobile-development", "flutter", "dart", "cross-platform"],
    source: "Dev.to",
    summary: "Comprehensive guide to building beautiful mobile applications with Flutter and Dart. Covers widgets, state management, and material design.",
    qualityScore: 0.80,
    popularityScore: 0.78,
    recencyScore: 0.90,
  },

  // ─── TypeScript / JavaScript ────────────────────────
  {
    title: "TypeScript Design Patterns",
    url: "https://dev.to/typescript-design-patterns",
    type: "article",
    difficulty: "advanced",
    duration: "25 minutes",
    tags: ["typescript", "design-patterns", "object-oriented", "software-architecture"],
    source: "Dev.to",
    summary: "Implementing classic design patterns in TypeScript: Factory, Observer, Strategy, Decorator, and more with type-safe implementations.",
    qualityScore: 0.83,
    popularityScore: 0.72,
    recencyScore: 0.85,
  },
  {
    title: "JavaScript: Understanding the Weird Parts",
    url: "https://www.youtube.com/watch?v=js-weird-parts",
    type: "video",
    difficulty: "intermediate",
    duration: "40 minutes",
    tags: ["javascript", "closures", "prototypes", "this-keyword"],
    source: "YouTube",
    summary: "Deep understanding of JavaScript's unique concepts: closures, prototypal inheritance, hoisting, the event loop, and the 'this' keyword.",
    qualityScore: 0.91,
    popularityScore: 0.92,
    recencyScore: 0.65,
  },

  // ─── More diverse resources ─────────────────────────
  {
    title: "System Design Interview Preparation",
    url: "https://github.com/donnemartin/system-design-primer",
    type: "repo",
    difficulty: "expert",
    duration: "90 minutes",
    tags: ["system-design", "architecture", "scalability", "distributed-systems"],
    source: "GitHub",
    summary: "Learn how to design large-scale systems. 200k+ GitHub stars. Covers load balancers, caches, databases, microservices, and more.",
    qualityScore: 0.98,
    popularityScore: 0.99,
    recencyScore: 0.70,
  },
  {
    title: "PostgreSQL Performance Tuning",
    url: "https://dev.to/postgres-performance-tuning",
    type: "article",
    difficulty: "expert",
    duration: "20 minutes",
    tags: ["databases", "postgresql", "performance", "optimization"],
    source: "Dev.to",
    summary: "Expert-level PostgreSQL performance optimization: query planning, indexing strategies, connection pooling, and monitoring.",
    qualityScore: 0.80,
    popularityScore: 0.65,
    recencyScore: 0.88,
  },
];

async function main() {
  console.log("\n🌱 Seeding database with example resources...\n");

  // Ensure the pgvector extension and embedding column exist
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("✅ pgvector extension ready");
  } catch (e: any) {
    console.log(`⚠️  pgvector extension: ${e.message}`);
  }

  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE resources ADD COLUMN IF NOT EXISTS embedding vector(384)`
    );
    console.log("✅ Embedding column ready");
  } catch (e: any) {
    console.log(`⚠️  Embedding column: ${e.message}`);
  }

  let seeded = 0;
  let skipped = 0;

  for (const resource of SEED_RESOURCES) {
    try {
      // Check if already exists
      const existing = await prisma.resource.findUnique({
        where: { url: resource.url },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Generate embedding
      const text = buildResourceText({
        title: resource.title,
        summary: resource.summary,
        tags: resource.tags,
        difficulty: resource.difficulty,
        source: resource.source,
      });

      console.log(`  📥 Embedding: "${resource.title.slice(0, 50)}..."`);
      const embedding = await generateEmbedding(text);
      const embeddingStr = `[${embedding.join(",")}]`;

      // Insert with embedding
      await prisma.$queryRawUnsafe(
        `INSERT INTO resources (
          id, title, url, type, difficulty, duration, tags, source,
          summary, "qualityScore", "popularityScore", "recencyScore",
          embedding, "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6::text[], $7,
          $8, $9, $10, $11,
          $12::vector, NOW(), NOW()
        )
        ON CONFLICT (url) DO NOTHING`,
        resource.title,
        resource.url,
        resource.type,
        resource.difficulty,
        resource.duration,
        resource.tags,
        resource.source,
        resource.summary,
        resource.qualityScore,
        resource.popularityScore,
        resource.recencyScore,
        embeddingStr
      );

      seeded++;
    } catch (error: any) {
      console.error(`  ❌ Failed: "${resource.title}" – ${error.message}`);
    }
  }

  console.log(`\n✅ Seeding complete: ${seeded} added, ${skipped} skipped\n`);

  // Print stats
  const total = await prisma.resource.count();
  console.log(`📊 Total resources in database: ${total}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Seed error:", e);
  prisma.$disconnect();
  process.exit(1);
});
