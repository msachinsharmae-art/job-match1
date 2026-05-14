import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const SERPAPI = "https://serpapi.com/search.json";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function scoreJobWithAI(profile: any, job: any) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { score: 0, reasons: [] };
  const sys = `You are an expert recruiter. Score 0-100 how well a job matches a candidate. Return strict JSON {"score":number,"reasons":[string,string,string]}. Each reason ≤12 words.`;
  const user = `CANDIDATE: ${profile.full_name}, ${profile.headline}, ${profile.experience_years}y. Roles: ${(profile.target_roles||[]).join(", ")}. Locations: ${(profile.target_locations||[]).join(", ")}. Skills: ${(profile.search_keywords||[]).join(", ")}. Summary: ${profile.cv_summary}\n\nJOB: ${job.title} at ${job.company} (${job.location})\n${(job.description||"").slice(0,2500)}\n\nReturn ONLY JSON.`;
  try {
    const res = await fetch(LOVABLE_AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
    });
    if (!res.ok) return { score: 0, reasons: [] };
    const d = await res.json();
    const t = (d.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
    const p = JSON.parse(t);
    return { score: Math.max(0, Math.min(100, Number(p.score) || 0)), reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 4).map(String) : [] };
  } catch { return { score: 0, reasons: [] }; }
}

async function fetchSerpJobs(query: string, location: string) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY missing");
  const url = `${SERPAPI}?engine=google_jobs&q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&hl=en&api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const d = await res.json();
  return d.jobs_results ?? [];
}

export const Route = createFileRoute("/api/public/hooks/scan")({
  server: {
    handlers: {
      POST: async () => {
        const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data: profiles } = await supabase.from("profiles").select("*");
        if (!profiles?.length) return Response.json({ ok: true, scanned: 0 });

        let totalUsers = 0, totalNew = 0;
        for (const profile of profiles) {
          totalUsers++;
          const { data: run } = await supabase.from("scan_runs").insert({ user_id: profile.user_id, status: "running" }).select().single();
          let found = 0, matched = 0;
          const errors: string[] = [];
          const seen = new Set<string>();
          try {
            for (const role of (profile.target_roles ?? []).slice(0, 3)) {
              for (const loc of (profile.target_locations ?? []).slice(0, 2)) {
                let jobs: any[] = [];
                try { jobs = await fetchSerpJobs(role, `${loc}, India`); }
                catch (e: any) { errors.push(`${role}@${loc}: ${e.message}`); continue; }
                for (const j of jobs) {
                  const externalId = j.job_id || `${j.title}-${j.company_name}-${j.location}`.replace(/\s+/g, "-").toLowerCase();
                  if (seen.has(externalId)) continue;
                  seen.add(externalId);
                  found++;
                  const { data: existing } = await supabase.from("jobs").select("id").eq("user_id", profile.user_id).eq("external_id", externalId).maybeSingle();
                  if (existing) continue;
                  const description: string = j.description ?? "";
                  const sourceUrl = j.apply_options?.[0]?.link || j.share_link || "";
                  const { score, reasons } = await scoreJobWithAI(profile, { title: j.title, company: j.company_name, location: j.location, description });
                  if (score >= (profile.min_match_score ?? 70)) { matched++; totalNew++; }
                  await supabase.from("jobs").insert({
                    user_id: profile.user_id, external_id: externalId,
                    title: j.title, company: j.company_name, location: j.location,
                    posted_at: j.detected_extensions?.posted_at ?? null,
                    source: j.via ?? "Google Jobs", source_url: sourceUrl,
                    description: description.slice(0, 5000),
                    match_score: score, match_reasons: reasons, status: "new",
                  });
                }
              }
            }
            if (run) await supabase.from("scan_runs").update({ status: "done", finished_at: new Date().toISOString(), jobs_found: found, jobs_matched: matched, error: errors.length ? errors.join("; ") : null }).eq("id", run.id);
          } catch (e: any) {
            if (run) await supabase.from("scan_runs").update({ status: "error", finished_at: new Date().toISOString(), error: e.message }).eq("id", run.id);
          }
        }
        return Response.json({ ok: true, users: totalUsers, newMatches: totalNew });
      },
    },
  },
});
