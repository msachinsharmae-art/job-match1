# JobMatch

AI-powered job discovery and matching app. Scans multiple job boards (LinkedIn, Naukri, Indeed, Google Jobs, Glassdoor, Foundit, Hirist, Instahyre, Wellfound) and ranks results against your CV using Lovable AI.

## Features

- **Multi-source scanning** — Pulls jobs in parallel from 9+ job boards via SerpAPI.
- **AI match scoring** — Each job is scored 0–100 against your profile with reasoning.
- **CV-driven personalization** — Target roles, locations, keywords, and CV summary drive matches.
- **Time filters** — View jobs posted in the last 24 hours, 7 days, or 30 days (uses real source-posted date).
- **Cover letter generation** — One-click tailored cover letters per job.
- **Status tracking** — Mark jobs as new / saved / applied / rejected.

## Tech Stack

- **Framework:** TanStack Start (React 19 + Vite 7)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Backend:** Lovable Cloud (Supabase) — Postgres, Auth, RLS
- **Server logic:** TanStack `createServerFn` (no edge functions)
- **AI:** Lovable AI Gateway (`google/gemini-2.5-flash`)
- **Job data:** SerpAPI (Google Jobs engine)
- **Deploy target:** Cloudflare Workers (edge)

## Getting Started

This project runs on [Lovable](https://lovable.dev). Edit it live in the Lovable editor — changes auto-sync to GitHub.

To run locally:

```bash
bun install
bun run dev
```

## Required Secrets

Configured in Lovable Cloud → Secrets:

- `LOVABLE_API_KEY` — auto-provided by Lovable AI
- `SERPAPI_KEY` — for job board scanning

## Project Structure

```
src/
  routes/              # File-based routes (TanStack)
    index.tsx          # Job dashboard + filters
    auth.tsx           # Sign in / sign up
    api/public/        # Webhooks (e.g. cron scan trigger)
  lib/
    jobs.functions.ts  # Server functions: scanJobs, generateCoverLetter, etc.
  integrations/
    supabase/          # Auto-generated client + types
```

## License

Private project.
