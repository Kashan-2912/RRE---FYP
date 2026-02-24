import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import ws from 'ws';
import { config } from "./environment";

// Set up the Neon connection pool
neonConfig.webSocketConstructor = ws;
const adapter = new PrismaNeon({ connectionString: config.databaseUrl });

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

export default prisma;
