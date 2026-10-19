# Sprint

A personal day planner that answers one question: **what should I do right now?**
It lays out the day hour by hour (wake-up, focus blocks, lectures, meals, planned rest),
shows the current block on the phone and pings Telegram when a block starts or stalls.
It drives a 19-week plan to a first Junior Full-stack offer ([`docs/plan.md`](docs/plan.md)).

**Stack:** Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS 4, Drizzle ORM,
PostgreSQL (Neon in production), grammY for the Telegram bot, Vercel.

## Screens

- **Now**: the current block with a countdown and one action (start, done, skip), shift the plan by
  30 minutes or rebuild the rest of the day, the "minimum day" checklist and daily counters.
- **Day**: the timeline, this week's tasks and a note for the day.
- **Settings**: wake-up and sleep time, focus budget, block length, fixed blocks (lectures, meals, sport).

The Telegram bot does the same from the chat: `/now`, `/today`, `/replan`, `/login`, with buttons on every reminder.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| Planner | `lib/planner/build-day.ts`, `demand.ts` | Pure functions. `buildDemand` turns the week's targets and tasks into a priority list (algorithms first, then the trainer and applications, then tasks). `buildDay` fits it between fixed blocks with breaks, a long break after ~100 minutes of focus, an evening review and planned rest. `validatePlan` holds the hard rules. |
| Service | `lib/planner/service.ts` | Loads data, saves plans, replans from now while keeping finished and running blocks, counts focus minutes. Used by the pages, the bot and the reminder job. |
| Reminders | `lib/planner/tick.ts`, `app/api/cron/tick` | Builds the day in the morning, announces each block once, nudges a focus block that has not started 10 minutes in. |
| Bot | `lib/bot`, `app/api/telegram` | Webhook protected by a secret; answers only `OWNER_TELEGRAM_ID`. |
| Login | `lib/auth.ts`, `app/auth`, `app/signin` | `/login` in the bot sends a one-time link (10 minutes, stored as a SHA-256 hash). The link page logs in on a button press, so a link preview cannot use it up. The session is an HMAC-signed httpOnly cookie for 30 days. |

Times are stored as UTC instants and planned as minutes since Kyiv midnight, so the clock change does not shift blocks.
More detail, in Russian: [`docs/how-it-works.md`](docs/how-it-works.md).

## Run locally

```bash
cp .env.example .env.local        # fill SESSION_SECRET and CRON_SECRET with random strings
docker compose up -d              # Postgres on port 5434
docker compose exec db createdb -U sprint sprint_test
npm install
npm run db:migrate
python3 artifact/scripts/seeds.py && npm run db:seed
npm run dev
npm run login-link                # prints a login link for http://localhost:3000
```

```bash
npm test          # unit tests, plus database tests when TEST_DATABASE_URL is set
npm run typecheck
```

## Deploy

1. Create a bot with [@BotFather](https://t.me/BotFather) and find your numeric id with @userinfobot.
2. Import the repository in Vercel and add a Neon Postgres database from the Vercel Marketplace (it sets `DATABASE_URL`).
3. In Vercel, set `APP_URL`, `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` and
   `SESSION_SECRET` (32+ random characters). Never commit them: this repository is public.
4. Run once from your machine with production values: `npm run db:migrate`, `npm run db:seed`, `npm run bot:webhook`.
5. Reminders: Vercel Cron on the Hobby plan runs once a day (`vercel.json`), so `.github/workflows/tick.yml` calls
   `/api/cron/tick` every 5 minutes. Add `APP_URL` and `CRON_SECRET` as repository secrets.
   GitHub can delay scheduled runs by a few minutes and pauses them after 60 days without commits.

## Roadmap

1. Planner without AI, bot, reminders: **done**.
2. Claude: plan the day, "I can't start" micro-steps, evening review, a coach chat. Optional, with a monthly token cap.
3. Move the tracker in: weekly targets, applications with follow-ups, interview trainer, ideas.
4. PWA manifest and icon, polish.

`artifact/` holds the earlier Claude Artifact version of the tracker, which keeps working until the app replaces it.
