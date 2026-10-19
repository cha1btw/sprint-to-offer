// Usage: npm run login-link
// Prints a one-time login link without Telegram, for local development and as a
// way back in if the bot is down. It needs direct access to the database.
import { createLoginToken } from "../lib/auth.ts";
import { createDb } from "../lib/db/index.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}
const db = createDb(url);
try {
  const token = await createLoginToken(db);
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`${appUrl}/auth?token=${token}`);
} finally {
  await db.$client.end();
}
