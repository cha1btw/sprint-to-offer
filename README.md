# Sprint to Offer

A personal tracker for a 19-week plan (19 Oct 2026 to 28 Feb 2027) to land a first
Junior Full-stack offer or internship. It runs as a private Claude Artifact, so it opens
from a phone and a computer and keeps its data in the Artifact's own database.

The plan itself is in [`docs/plan.md`](docs/plan.md) (in Russian): role choice, course
verdicts, week-by-week roadmap, milestones and the rules that keep the plan alive.

## What it does

- **Today**: countdown to the deadline, streak of "minimum days", focus timer, daily counters.
- **Week**: plan vs. actual for hours, LeetCode, applications, networking and mock interviews,
  weekly review form and an AI review.
- **Plan**: strategy, milestones, all 19 weeks and a "Later" list for new ideas.
- **Applications**: a small CRM with statuses, follow-up dates and a conversion funnel.
- **Trainer**: 126 interview questions with spaced repetition (Leitner boxes) and
  answer grading by Claude.

## How it works

`src/sprint.html` is one self-contained page (vanilla JS, no build step, no dependencies).
It talks to the Claude Artifact runtime through `window.claude`:

| Capability | Used for |
| --- | --- |
| `db` | Shared documents: `settings`, `weeks`, `tasks`, `days`, `apps`, `questions`, `ideas`. Access rules make the data readable and writable by the owner only. |
| `sample` | "Check with Claude" in the trainer and the weekly AI review. Hidden when unavailable. |

Because of that, the page is **not a standalone website**: outside claude.ai there is no
`window.claude`, and it shows an empty template with a banner.

## Repository layout

```
src/sprint.html          the tracker page (publish this as an Artifact)
scripts/seeds.py         generates the initial documents: 19 weeks, 75 tasks, 126 questions
scripts/build_preview.py wraps the page with an in-memory mock of window.claude for local checks
docs/plan.md             the 19-week plan
```

## Local preview

```bash
python3 scripts/seeds.py          # writes seed/ (one JSON file per document)
python3 scripts/build_preview.py  # writes preview/index.html
python3 -m http.server 8765 --directory preview
```

Open http://localhost:8765. The mock keeps data in memory only and returns canned answers
for the Claude features, so it is for checking the UI, not for real use.

## Publishing

Publish `src/sprint.html` as a private Artifact with the `db` capability (owner-only rules)
and the `sample` capability, then load the files from `seed/` into its database.
