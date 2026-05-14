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

async function scoreJobWithAI(profile: Profile, job: {
  title: string; company: string | null; location: string | null; description: string;
}): Promise<{ score: number; reasons: string[] }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { score: 0, reasons: ["LOVABLE_API_KEY missing"] };

  const sys = `You are an expert recruiter. Score how well a job posting matches a candidate from 0-100. Return strict JSON: {"score": number, "reasons": [string, string, string]}.
Scoring:
- 90-100: perfect role + location + skills
- 75-89: strong match, minor gaps
- 60-74: relevant but missing some core requirements
- below 60: weak match
Reasons should each be ≤12 words, citing specific overlap or gaps.`;

  const user = `CANDIDATE:
Name: ${profile.full_name}
Headline: ${profile.headline}
Experience: ${profile.experience_years} years
Target roles: ${(profile.target_roles ?? []).join(", ")}
Target locations: ${(profile.target_locations ?? []).join(", ")}
Key skills/keywords: ${(profile.search_keywords ?? []).join(", ")}
CV summary: ${profile.cv_summary}

JOB:
Title: ${job.title}
Company: ${job.company ?? "?"}
Location: ${job.location ?? "?"}
Description: ${(job.description ?? "").slice(0, 2500)}

Return ONLY valid JSON, no markdown.`;

  try {
    const res = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("AI score failed:", res.status, t);
      return { score: 0, reasons: [`AI error ${res.status}`] };
    }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4).map(String) : [],
    };
  } catch (e) {
    console.error("AI parse error:", e);
    return { score: 0, reasons: ["scoring failed"] };
  }
}

async function fetchSerpJobs(query: string, location: string): Promise<any[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY missing");
  const url = `${SERPAPI}?engine=google_jobs&q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&hl=en&api_key=${key}`;
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
      // Keep the per-scan work small enough to finish under the worker's
      // ~30s request budget. We rotate the role/location pair each run by
      // using the scan_runs count, so over a few scans every combo is hit.
      const allRoles = (profile.target_roles ?? []).slice(0, 4);
      const allLocs = (profile.target_locations ?? []).slice(0, 3);
      const { count: prevRuns } = await supabase
        .from("scan_runs").select("id", { count: "exact", head: true }).eq("user_id", userId);
      const idx = prevRuns ?? 0;
      const role = allRoles[idx % Math.max(allRoles.length, 1)] ?? "Product Manager";
      const loc = allLocs[Math.floor(idx / Math.max(allRoles.length, 1)) % Math.max(allLocs.length, 1)] ?? "Gurgaon";

      let jobs: any[] = [];
      try {
        jobs = await fetchSerpJobs(role, `${loc}, India`);
      } catch (e: any) {
        errors.push(`${role}@${loc}: ${e.message}`);
        jobs = [];
      }

      // Dedupe within batch + against DB, then cap to 8 to keep AI scoring fast.
      const seen = new Set<string>();
      const candidates: any[] = [];
      for (const j of jobs) {
        const externalId = j.job_id || `${j.title}-${j.company_name}-${j.location}`.replace(/\s+/g, "-").toLowerCase();
        if (seen.has(externalId)) continue;
        seen.add(externalId);
        const { data: existing } = await supabase
          .from("jobs").select("id").eq("user_id", userId).eq("external_id", externalId).maybeSingle();
        if (existing) continue;
        candidates.push({ ...j, _externalId: externalId });
        if (candidates.length >= 8) break;
      }
      totalFound = candidates.length;

      // Score in parallel (Lovable AI handles concurrency fine).
      const scored = await Promise.all(candidates.map((j) =>
        scoreJobWithAI(profile as Profile, {
          title: j.title, company: j.company_name, location: j.location, description: j.description ?? "",
        }).then((s) => ({ j, ...s }))
      ));

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
          source: j.via ?? "Google Jobs",
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
    target_roles: z.array(z.string().min(1).max(100)).min(1).max(10),
    target_locations: z.array(z.string().min(1).max(100)).min(1).max(10),
    search_keywords: z.array(z.string().min(1).max(80)).max(30),
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
