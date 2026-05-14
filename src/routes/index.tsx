import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scanJobs, generateCoverLetter, updateJobStatus, updateProfile } from "@/lib/jobs.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Briefcase, ExternalLink, FileText, RefreshCw, LogOut, Sparkles, MapPin, Building2, Calendar, Copy } from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

function parsePostedHours(posted: string | null, createdAt: string): number | null {
  if (posted) {
    const s = posted.toLowerCase().trim();
    if (s.includes("just") || s.includes("moment")) return 0;
    const m = s.match(/(\d+)\s*(minute|min|hour|hr|day|week|month|year)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      if (unit.startsWith("min")) return n / 60;
      if (unit.startsWith("hour") || unit.startsWith("hr")) return n;
      if (unit.startsWith("day")) return n * 24;
      if (unit.startsWith("week")) return n * 24 * 7;
      if (unit.startsWith("month")) return n * 24 * 30;
      if (unit.startsWith("year")) return n * 24 * 365;
    }
  }
  // Fallback: use created_at
  if (createdAt) {
    return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  }
  return null;
}

function Home() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (ready && !session) navigate({ to: "/auth" });
  }, [ready, session, navigate]);

  if (!ready || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  return <Dashboard userId={session.user.id} email={session.user.email} />;
}

type Job = {
  id: string; title: string; company: string | null; location: string | null;
  posted_at: string | null; source: string | null; source_url: string | null;
  description: string | null; match_score: number | null; match_reasons: string[] | null;
  cover_letter: string | null; status: string; created_at: string;
};

type Profile = {
  user_id: string; full_name: string; headline: string;
  target_roles: string[]; target_locations: string[]; search_keywords: string[];
  experience_years: number; min_match_score: number; cv_summary: string;
};

function Dashboard({ userId, email }: { userId: string; email?: string }) {
  const qc = useQueryClient();
  const scanFn = useServerFn(scanJobs);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>("all");

  const { data: profile, isLoading: pLoading } = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).single();
      if (error) throw error;
      return data as Profile;
    },
  });

  const { data: jobs = [], isLoading: jLoading } = useQuery({
    queryKey: ["jobs", userId, filterStatus],
    queryFn: async () => {
      let q = supabase.from("jobs").select("*").eq("user_id", userId).order("match_score", { ascending: false }).order("created_at", { ascending: false });
      if (filterStatus !== "all") q = q.eq("status", filterStatus);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });

  const { data: lastRun } = useQuery({
    queryKey: ["last-run", userId],
    queryFn: async () => {
      const { data } = await supabase.from("scan_runs").select("*").eq("user_id", userId).order("started_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    refetchInterval: 5000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => scanFn(),
    onSuccess: (r) => {
      toast.success(`Scan done — ${r.found} jobs found, ${r.matched} matches`);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["last-run"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filteredJobs = jobs.filter(j => {
    if (filterDate === "all") return true;
    const maxHours = filterDate === "24h" ? 24 : filterDate === "7d" ? 24 * 7 : 24 * 30;
    const hours = parsePostedHours(j.posted_at, j.created_at);
    return hours !== null && hours <= maxHours;
  });

  const stats = {
    total: filteredJobs.length,
    matches: filteredJobs.filter(j => (j.match_score ?? 0) >= (profile?.min_match_score ?? 70)).length,
    applied: filteredJobs.filter(j => j.status === "applied").length,
    avg: filteredJobs.length ? Math.round(filteredJobs.reduce((a, j) => a + (j.match_score ?? 0), 0) / filteredJobs.length) : 0,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Briefcase className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Job Hunter</h1>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
              {scanMutation.isPending ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Scanning…</> : <><Sparkles className="mr-2 h-4 w-4" />Scan now</>}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total jobs" value={stats.total} />
          <StatCard label={`Matches ≥${profile?.min_match_score ?? 70}`} value={stats.matches} accent />
          <StatCard label="Applied" value={stats.applied} />
          <StatCard label="Avg score" value={stats.avg} />
        </div>

        <Tabs defaultValue="jobs">
          <TabsList>
            <TabsTrigger value="jobs">Jobs ({filteredJobs.length})</TabsTrigger>
            <TabsTrigger value="profile">CV & Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="space-y-4 mt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Label className="text-sm">Status:</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="saved">Saved</SelectItem>
                  <SelectItem value="applied">Applied</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Label className="text-sm">Posted:</Label>
              <Select value={filterDate} onValueChange={setFilterDate}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any time</SelectItem>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              {lastRun && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Last scan: {new Date(lastRun.started_at).toLocaleString()} — {lastRun.status}
                </span>
              )}
            </div>

            {jLoading ? <p className="text-muted-foreground">Loading…</p> :
              filteredJobs.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">
                  <Briefcase className="mx-auto mb-3 h-10 w-10 opacity-50" />
                  {jobs.length === 0
                    ? <>No jobs yet. Click <strong>Scan now</strong> to fetch the latest PM/BA roles.</>
                    : <>No jobs match the selected filters.</>}
                </CardContent></Card>
              ) : filteredJobs.map(j => <JobCard key={j.id} job={j} />)}
          </TabsContent>

          <TabsContent value="profile" className="mt-4">
            {pLoading ? <p>Loading…</p> : profile && <ProfileForm profile={profile} />}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className={`text-3xl font-bold ${accent ? "text-primary" : ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function scoreColor(s: number | null) {
  const n = s ?? 0;
  if (n >= 85) return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  if (n >= 70) return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  if (n >= 50) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-muted text-muted-foreground";
}

function JobCard({ job }: { job: Job }) {
  const qc = useQueryClient();
  const coverFn = useServerFn(generateCoverLetter);
  const statusFn = useServerFn(updateJobStatus);
  const [showLetter, setShowLetter] = useState(false);
  const [letter, setLetter] = useState(job.cover_letter ?? "");
  const [genLoading, setGenLoading] = useState(false);

  const handleGen = async () => {
    setGenLoading(true);
    try {
      const r = await coverFn({ data: { jobId: job.id } });
      setLetter(r.coverLetter);
      setShowLetter(true);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Cover letter ready");
    } catch (e: any) { toast.error(e.message); }
    setGenLoading(false);
  };

  const setStatus = async (status: "new" | "saved" | "applied" | "rejected") => {
    await statusFn({ data: { jobId: job.id, status } });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    toast.success(`Marked ${status}`);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{job.title}</CardTitle>
            <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs">
              {job.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{job.company}</span>}
              {job.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.location}</span>}
              {job.posted_at && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{job.posted_at}</span>}
              {job.source && <span>{job.source}</span>}
            </CardDescription>
          </div>
          <Badge variant="outline" className={`shrink-0 ${scoreColor(job.match_score)}`}>
            {job.match_score ?? 0}/100
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {job.match_reasons && job.match_reasons.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {job.match_reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {job.source_url && (
            <Button asChild size="sm" variant="default">
              <a href={job.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" />Apply
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleGen} disabled={genLoading}>
            <FileText className="mr-1 h-3 w-3" />{genLoading ? "Writing…" : job.cover_letter ? "View letter" : "Cover letter"}
          </Button>
          <Select value={job.status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="saved">Saved</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(showLetter || (job.cover_letter && showLetter)) && letter && (
          <div className="rounded-md bg-muted p-3 text-sm space-y-2">
            <pre className="whitespace-pre-wrap font-sans">{letter}</pre>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(letter); toast.success("Copied"); }}>
              <Copy className="mr-1 h-3 w-3" />Copy
            </Button>
          </div>
        )}
        {job.cover_letter && !showLetter && (
          <button onClick={() => { setLetter(job.cover_letter!); setShowLetter(true); }} className="text-xs text-primary underline">
            Show saved cover letter
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateProfile);
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);

  const arrField = (key: keyof Profile) => (form[key] as string[]).join(", ");
  const setArr = (key: keyof Profile, v: string) =>
    setForm({ ...form, [key]: v.split(",").map(s => s.trim()).filter(Boolean) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateFn({ data: {
        full_name: form.full_name, headline: form.headline,
        target_roles: form.target_roles, target_locations: form.target_locations,
        search_keywords: form.search_keywords,
        experience_years: Number(form.experience_years),
        min_match_score: Number(form.min_match_score),
        cv_summary: form.cv_summary,
      }});
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Card><CardContent className="space-y-4 pt-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div><Label>Full name</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Headline</Label><Input value={form.headline} onChange={e => setForm({ ...form, headline: e.target.value })} /></div>
        </div>
        <div><Label>Target roles (comma-separated)</Label><Input value={arrField("target_roles")} onChange={e => setArr("target_roles", e.target.value)} /></div>
        <div><Label>Target locations (comma-separated)</Label><Input value={arrField("target_locations")} onChange={e => setArr("target_locations", e.target.value)} /></div>
        <div><Label>Keywords / skills (comma-separated)</Label><Input value={arrField("search_keywords")} onChange={e => setArr("search_keywords", e.target.value)} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><Label>Experience (years)</Label><Input type="number" step="0.5" value={form.experience_years} onChange={e => setForm({ ...form, experience_years: Number(e.target.value) })} /></div>
          <div><Label>Min match score (0–100)</Label><Input type="number" min={0} max={100} value={form.min_match_score} onChange={e => setForm({ ...form, min_match_score: Number(e.target.value) })} /></div>
        </div>
        <div><Label>CV summary (used by AI to score jobs)</Label><Textarea rows={6} value={form.cv_summary} onChange={e => setForm({ ...form, cv_summary: e.target.value })} /></div>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
      </CardContent></Card>
    </form>
  );
}
