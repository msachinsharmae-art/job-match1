
-- profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text default 'Sachin Sharma',
  headline text default 'Product Manager / Business Analyst',
  target_roles text[] default array['Product Manager','Business Analyst','Associate Product Manager','Product Owner','Senior Business Analyst'],
  target_locations text[] default array['Gurgaon','Gurugram','Delhi','Noida','New Delhi'],
  search_keywords text[] default array['Agile','Scrum','SaaS','SQL','Postman','Stakeholder Management','Cross-functional','Customer Requirements','Roadmap','JIRA'],
  experience_years numeric default 3.5,
  min_match_score int default 70,
  cv_summary text default 'PM/BA with 3.5 years experience in SaaS, B2B platforms, agile delivery, sprint planning, customer requirements gathering, cross-functional team collaboration, SQL, Postman, Jira. Strong in roadmap, stakeholder management, AI/LLM workflows.',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = user_id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = user_id);
create policy "own profile update" on public.profiles for update using (auth.uid() = user_id);
create policy "own profile delete" on public.profiles for delete using (auth.uid() = user_id);

-- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null,
  company text,
  location text,
  posted_at text,
  source text,
  source_url text,
  description text,
  match_score int,
  match_reasons text[],
  cover_letter text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);

create index jobs_user_score_idx on public.jobs (user_id, match_score desc, created_at desc);
alter table public.jobs enable row level security;
create policy "own jobs select" on public.jobs for select using (auth.uid() = user_id);
create policy "own jobs insert" on public.jobs for insert with check (auth.uid() = user_id);
create policy "own jobs update" on public.jobs for update using (auth.uid() = user_id);
create policy "own jobs delete" on public.jobs for delete using (auth.uid() = user_id);

-- scan_runs
create table public.scan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  jobs_found int default 0,
  jobs_matched int default 0,
  status text not null default 'running',
  error text
);

alter table public.scan_runs enable row level security;
create policy "own runs select" on public.scan_runs for select using (auth.uid() = user_id);
create policy "own runs insert" on public.scan_runs for insert with check (auth.uid() = user_id);

-- updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_updated before update on public.profiles for each row execute function public.tg_set_updated_at();
create trigger jobs_updated before update on public.jobs for each row execute function public.tg_set_updated_at();

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
