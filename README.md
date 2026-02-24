# RRE MicroMono – AI Resource Recommendation Engine

An AI-powered personalized learning resource recommendation engine built with TypeScript, Express, PostgreSQL + pgvector, and local HuggingFace embeddings.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   Client     │────▶│  Express API     │────▶│ Recommendation    │
│   (POST)     │     │  (Zod validated) │     │ Engine            │
└──────────────┘     └──────────────────┘     └───────┬───────────┘
                                                      │
                     ┌────────────────────────────────┤
                     ▼                                ▼
              ┌──────────────┐              ┌──────────────────┐
              │ Ranking      │              │ Vector Search    │
              │ Engine       │              │ (pgvector)       │
              │              │              │                  │
              │ 0.45 semantic│              │ Cosine distance  │
              │ 0.20 quality │              │ on 384-dim       │
              │ 0.15 format  │              │ embeddings       │
              │ 0.12 diff    │              │                  │
              │ 0.08 recency │              └──────────────────┘
              └──────────────┘
                                            ┌──────────────────┐
              ┌──────────────┐              │ Embedding Svc    │
              │ Crawler      │──────────────│ (all-MiniLM-L6)  │
              │ Pipeline     │              │ local, free      │
              │              │              └──────────────────┘
              │ YouTube      │
              │ GitHub       │              ┌──────────────────┐
              │ Dev.to       │──────────────│ PostgreSQL       │
              │ Medium       │              │ + pgvector       │
              │ freeCodeCamp │              │                  │
              │ MDN          │              └──────────────────┘
              └──────────────┘
```

## Setup

### Prerequisites
- **Node.js** 18+
- **PostgreSQL** with the `pgvector` extension

### 1. Install pgvector extension
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. Create the database
```sql
CREATE DATABASE rre_micromono;
```

### 3. Configure environment
Edit `.env` with your database credentials:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/rre_micromono?schema=public"
YOUTUBE_API_KEY=""        # Optional: get from Google Cloud Console
GITHUB_TOKEN=""           # Optional: increases GitHub API rate limit
```

### 4. Install dependencies
```bash
cd backend
npm install
```

### 5. Run database migrations
```bash
npx prisma db push
```

### 6. Seed example data
```bash
npm run seed
```

### 7. Start the server
```bash
npm run dev
```

Server runs at `http://localhost:3000`

---

## API Endpoints

### POST `/api/recommendations`
Get personalized resource recommendations.

**Request:**
```json
{
  "skill_selected": "Web Development",
  "content_preferences": ["video", "text", "external_links"],
  "learning_pace": "medium",
  "session_length": "regular",
  "difficulty_preference": "moderate",
  "proficiency_score": 7.1
}
```

**Response:**
```json
{
  "success": true,
  "input": {
    "skill": "Web Development",
    "proficiency_score": 7.1,
    "content_preferences": ["video", "text", "external_links"],
    "learning_pace": "medium",
    "session_length": "regular",
    "difficulty_preference": "moderate"
  },
  "count": 10,
  "recommendations": [
    {
      "title": "Advanced React Performance Optimization",
      "type": "video",
      "url": "https://...",
      "difficulty": "advanced",
      "estimated_time": "35 minutes",
      "source": "YouTube",
      "recommendation_score": 0.92,
      "reason": "Recommended because it highly relevant to Web Development, matches your preferred video format, matches your advanced skill level.",
      "tags": ["web-development", "react", "performance"]
    }
  ]
}
```

### POST `/api/resources/ingest`
Trigger the crawler pipeline to build the resource dataset.

```json
{ "skill": "React" }             // Single skill
{ "skills": ["React", "Python"] } // Multiple skills
{}                                 // All default skills
```

### GET `/api/resources/stats`
Get resource database statistics.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run seed` | Seed database with 25 example resources |
| `npm run ingest` | Run the full dataset builder |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:generate` | Regenerate Prisma client |

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL + pgvector
- **ORM**: Prisma
- **Embeddings**: `@xenova/transformers` (all-MiniLM-L6-v2, local, free)
- **Crawling**: Axios + Cheerio
- **Validation**: Zod
- **Security**: express-rate-limit, CORS
