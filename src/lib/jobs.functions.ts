import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SERPAPI = "https://serpapi.com/search.json";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Profile = {
  full_name: string | null;
  headline: string | null;
  target_roles: string[] | null;
  target_locations: string[] | null;
  search_keywords: string[] | null;
  experience_years: number | null;
  min_match_score: number | null;
  cv_summary: string | null;
};

function parsePostedAgeHours(posted: string | null | undefined): number {
  if (!posted) return Number.POSITIVE_INFINITY;

  const s = posted.toLowerCase().trim();
  if (!s) return Number.POSITIVE_INFINITY;
  if (s.includes("just") || s.includes("moment") || s === "today") return 0;
  if (s === "yesterday") return 24;

  const rel = s.match(/(\d+)\+?\s*(minute|min|hour|hr|day|week|month|year)/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    if (unit.startsWith("min")) return n / 60;
    if (unit.startsWith("hour") || unit.startsWith("hr")) return n;
    if (unit.startsWith("day")) return n * 24;
    if (unit.startsWith("week")) return n * 24 * 7;
    if (unit.startsWith("month")) return n * 24 * 30;
    if (unit.startsWith("year")) return n * 24 * 365;
  }

  const word = s.match(/^(an?|one)\s+(minute|hour|day|week|month|year)/);
  if (word) {
    const unit = word[2];
    if (unit === "minute") return 1 / 60;
    if (unit === "hour") return 1;
    if (unit === "day") return 24;
    if (unit === "week") return 24 * 7;
    if (unit === "month") return 24 * 30;
    if (unit === "year") return 24 * 365;
  }

  const t = Date.parse(posted);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (Date.now() - t) / (1000 * 60 * 60);
}

// Free, local heuristic scorer (no AI credits required).
function scoreJobHeuristic(profile: Profile, job: {
  title: string; company: string | null; location: string | null; description: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const jobText = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const jobTitle = (job.title || "").toLowerCase();
  const jobLoc = (job.location || "").toLowerCase();

  // 1. Role match (max 40 pts)
  const roles = (profile.target_roles ?? []).map((r) => r.toLowerCase().trim()).filter(Boolean);
  let roleScore = 0;
  const matchedRoles: string[] = [];
  for (const role of roles) {
    if (jobTitle.includes(role)) { roleScore = Math.max(roleScore, 40); matchedRoles.push(role); }
    else if (jobText.includes(role)) { roleScore = Math.max(roleScore, 25); matchedRoles.push(role); }
    else {
      const roleTokens = role.split(/\s+/).filter((t) => t.length > 2);
      const hit = roleTokens.filter((t) => jobTitle.includes(t)).length;
      if (hit > 0) roleScore = Math.max(roleScore, Math.min(20, hit * 10));
    }
  }
  if (matchedRoles.length) reasons.push(`Role match: ${matchedRoles.slice(0, 2).join(", ")}`);
  else if (roleScore > 0) reasons.push("Adjacent role family");
  else reasons.push("Role not in your targets");

  // 2. Location match (max 20 pts)
  const locs = (profile.target_locations ?? []).map((l) => l.toLowerCase().trim()).filter(Boolean);
  let locScore = 0;
  let matchedLoc = "";
  const remote = /remote|anywhere|work from home|wfh/.test(jobLoc) || /\bremote\b/.test(jobText);
  for (const loc of locs) {
    if (loc.includes("remote") && remote) { locScore = 20; matchedLoc = "Remote"; break; }
    const first = loc.split(",")[0].trim();
    if (jobLoc.includes(loc) || (first && jobLoc.includes(first))) {
      locScore = 20; matchedLoc = loc; break;
    }
  }
  if (!locScore && remote && locs.length === 0) { locScore = 15; matchedLoc = "Remote"; }
  if (matchedLoc) reasons.push(`Location: ${matchedLoc}`);
  else if (jobLoc) reasons.push(`Location: ${job.location} (outside targets)`);

  // 3. Keyword overlap (max 30 pts)
  const keywords = (profile.search_keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const matchedKw: string[] = [];
  for (const kw of keywords) {
    if (kw && jobText.includes(kw)) matchedKw.push(kw);
  }
  const kwScore = keywords.length
    ? Math.min(30, Math.round((matchedKw.length / Math.max(1, keywords.length)) * 30) + (matchedKw.length >= 3 ? 5 : 0))
    : 0;
  if (matchedKw.length) reasons.push(`Skills matched: ${matchedKw.slice(0, 4).join(", ")}`);

  // 4. Experience seniority alignment (max 10 pts)
  const years = profile.experience_years ?? 0;
  let expScore = 5;
  if (years >= 8 && /(senior|lead|principal|staff|head of|director)/.test(jobTitle)) expScore = 10;
  else if (years >= 4 && /(mid|intermediate|\bii\b|\biii\b)/.test(jobTitle)) expScore = 10;
  else if (years <= 3 && /(junior|entry|graduate|associate|intern)/.test(jobTitle)) expScore = 10;
  else if (/(senior|lead|principal|staff)/.test(jobTitle) && years < 4) expScore = 0;

  const total = Math.max(0, Math.min(100, roleScore + locScore + kwScore + expScore));
  return { score: total, reasons: reasons.slice(0, 4) };
}

async function fetchSerpJobs(query: string, location: string, freshness?: "qdr:d" | "qdr:w"): Promise<any[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY missing");

  const params = new URLSearchParams({
    engine: "google_jobs",
    q: query,
    location,
    hl: "en",
    api_key: key,
  });
  if (freshness) params.set("tbs", freshness);

  const url = `${SERPAPI}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SerpAPI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.jobs_results ?? [];
}

export const scanJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile, error: pErr } = await supabase
      .from("profiles").select("*").eq("user_id", userId).single();
    if (pErr || !profile) throw new Error("Profile not found");

    const { data: run } = await supabase
      .from("scan_runs")
      .insert({ user_id: userId, status: "running" })
      .select().single();

    let totalFound = 0;
    let totalMatched = 0;
    const errors: string[] = [];

    try {
      // Scan every role × location, one Google Jobs query per combo.
      // Cap combos to stay within the worker's ~30s budget.
      const roles = (profile.target_roles ?? ["Product Manager"]).slice(0, 5);
      const locs = (profile.target_locations ?? ["Gurgaon"]).slice(0, 4);
      const combos: { role: string; loc: string }[] = [];
      for (const r of roles) for (const l of locs) combos.push({ role: r, loc: l });
      const cappedCombos = combos.slice(0, 12);

      const results = await Promise.all(cappedCombos.map(async ({ role, loc }) => {
        const scans = await Promise.all([
          fetchSerpJobs(role, `${loc}, India`)
            .then((r) => r.map((j: any) => ({ ...j, _sourceTag: "Google Jobs" })))
            .catch((e: any) => {
              errors.push(`${role}@${loc}: ${e.message}`);
              return [];
            }),
          fetchSerpJobs(role, `${loc}, India`, "qdr:w")
            .then((r) => r.map((j: any) => ({ ...j, _sourceTag: "Google Jobs" })))
            .catch((e: any) => {
              errors.push(`${role}@${loc} [fresh]: ${e.message}`);
              return [];
            }),
        ]);

        return scans.flat();
      }));

      const jobs: any[] = results.flat().map((j: any) => {
        const postedAt = j.detected_extensions?.posted_at ?? j.posted_at ?? null;
        const externalId = j.job_id || `${j.title}-${j.company_name}-${j.location}`.replace(/\s+/g, "-").toLowerCase();

        return {
          ...j,
          _externalId: externalId,
          _postedAgeHours: parsePostedAgeHours(postedAt),
        };
      });

      const seen = new Set<string>();
      const uniqueJobs = jobs
        .sort((a, b) => a._postedAgeHours - b._postedAgeHours)
        .filter((j) => {
          if (seen.has(j._externalId)) return false;
          seen.add(j._externalId);
          return true;
        });

      const lookupIds = uniqueJobs.slice(0, 160).map((j) => j._externalId);
      const { data: existingRows, error: existingErr } = lookupIds.length
        ? await supabase
            .from("jobs")
            .select("external_id")
            .eq("user_id", userId)
            .in("external_id", lookupIds)
        : { data: [], error: null };
      if (existingErr) throw new Error(existingErr.message);

      const existingIds = new Set((existingRows ?? []).map((row) => row.external_id));
      const candidates = uniqueJobs.filter((j) => !existingIds.has(j._externalId)).slice(0, 24);
      totalFound = candidates.length;

      // Free local heuristic scoring (no API credits).
      const scored = candidates.map((j) => {
        const s = scoreJobHeuristic(profile as Profile, {
          title: j.title, company: j.company_name, location: j.location, description: j.description ?? "",
        });
        return { j, ...s };
      });

      // Insert all rows.
      const minScore = profile.min_match_score ?? 70;
      const rows = scored.map(({ j, score, reasons }) => {
        if (score >= minScore) totalMatched++;
        const sourceUrl = j.apply_options?.[0]?.link || j.share_link || j.related_links?.[0]?.link || "";
        return {
          user_id: userId,
          external_id: j._externalId,
          title: j.title,
          company: j.company_name,
          location: j.location,
          posted_at: j.detected_extensions?.posted_at ?? null,
          source: j.via ?? j._sourceTag ?? "Google Jobs",
          source_url: sourceUrl,
          description: (j.description ?? "").slice(0, 5000),
          match_score: score,
          match_reasons: reasons,
          status: "new",
        };
      });
      if (rows.length) await supabase.from("jobs").insert(rows);

      if (run) {
        await supabase.from("scan_runs")
          .update({ status: "done", finished_at: new Date().toISOString(),
                    jobs_found: totalFound, jobs_matched: totalMatched,
                    error: errors.length ? errors.join("; ") : null })
          .eq("id", run.id);
      }
      return { found: totalFound, matched: totalMatched, errors };
    } catch (e: any) {
      if (run) {
        await supabase.from("scan_runs")
          .update({ status: "error", finished_at: new Date().toISOString(), error: e.message })
          .eq("id", run.id);
      }
      throw e;
    }
  });

export const generateCoverLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured");

    const [{ data: profile }, { data: job }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("jobs").select("*").eq("id", data.jobId).eq("user_id", userId).single(),
    ]);
    if (!profile || !job) throw new Error("Profile or job not found");

    const prompt = `Write a tailored, concise (140-180 words) cover letter for this job. Plain text, no markdown. Open with a confident hook, mention 2-3 specific overlaps with the role, end with a clear ask for an interview.

CANDIDATE:
${profile.full_name}, ${profile.headline}
${profile.experience_years} years experience.
CV: ${profile.cv_summary}

JOB:
${job.title} at ${job.company} (${job.location})
${(job.description ?? "").slice(0, 2000)}`;

    const res = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`AI error ${res.status}`);
    const ai = await res.json();
    const letter: string = ai.choices?.[0]?.message?.content ?? "";

    await supabase.from("jobs").update({ cover_letter: letter }).eq("id", job.id);
    return { coverLetter: letter };
  });

export const updateJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(),
    status: z.enum(["new", "saved", "applied", "rejected"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("jobs").update({ status: data.status })
      .eq("id", data.jobId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    full_name: z.string().min(1).max(200),
    headline: z.string().min(1).max(300),
    target_roles: z.array(z.string().min(1).max(100)).min(1).max(50),
    target_locations: z.array(z.string().min(1).max(100)).min(1).max(20),
    search_keywords: z.array(z.string().min(1).max(80)).max(100),
    experience_years: z.number().min(0).max(60),
    min_match_score: z.number().int().min(0).max(100),
    cv_summary: z.string().min(10).max(4000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles").update(data).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
