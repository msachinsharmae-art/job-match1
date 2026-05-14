
# PM/BA Job Hunter — built into your Lovable app

A web app that does everything the n8n workflow was supposed to do, but hosted on Lovable (one-click publish to `.lovable.app`, no Vercel/n8n needed).

## What you get

**Dashboard** (the homepage)
- Your CV profile (pre-filled from the PDF you uploaded — Sachin, PM/BA, Gurugram, 3.5y SaaS)
- Editable: target roles, target locations, min match score, search keywords
- Live feed of matched jobs sorted by AI match score
- Each job card: title, company, location, posted date, match score, AI reasons, "Apply" button (opens job site), "Generate cover letter" button
- Filters: status (new / applied / saved / rejected), score range, location
- Stats strip: jobs scanned this week, matches ≥70, avg score

**Automation (runs in background)**
- Every 2 hours: fetches new PM/BA jobs in Delhi/Gurgaon/Noida from Google Jobs (via SerpAPI)
- AI scores each job 0–100 against your CV using Lovable AI (free tier built in — no OpenAI key needed)
- Dedupes against jobs already in your dashboard
- Sends an email to **msachinsharmae@gmail.com** for every new match ≥70 with a tailored cover letter and apply link

**Login**
- Just you — email/password sign-in so your job feed stays private

## What you need to provide
1. **One API key**: SerpAPI (free 100 searches/month at serpapi.com) — I'll show a clean "paste your key" screen on first login
2. Click **Publish** when it's ready — your app goes live at a public `.lovable.app` URL

## What I'll set up automatically
- Lovable Cloud (database, auth, secrets)
- Lovable AI (for matching + cover letters — no API key needed)
- Lovable Emails (for the alerts to your Gmail — no SMTP setup needed)
- pg_cron job that runs the fetcher every 2 hours

## Honest limits (same as before)
- **No LinkedIn auto-apply** — violates LinkedIn ToS, gets accounts banned
- App finds + drafts everything; you click "Apply" on the job site (1 click)
- LinkedIn jobs *appear* in Google Jobs results, so you'll still see most LinkedIn postings

## Build order
1. Set up Cloud + auth + database tables (jobs, profile, settings)
2. Build dashboard UI with your CV profile pre-filled
3. Add SerpAPI key entry screen + job-fetch server function
4. Wire AI matching + cover-letter generation
5. Set up email alerts to your Gmail
6. Schedule the 2-hourly cron job
7. You hit Publish → live URL

About 1 build cycle. Ready to go?
