-- TimeWorth: employee table (auth via Supabase Auth; no password stored here)
create extension if not exists "pgcrypto";

create table public.employee (
  id uuid primary key,  -- same as auth.users.id (set on insert from app)
  name text not null,
  position_in_company text not null,
  company_branch text not null,
  employee_no bigint not null unique,
  picture text,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- RLS example: allow insert for authenticated user with matching id
-- create policy "Users can insert own employee row"
-- on public.employee for insert to authenticated
-- with check (auth.uid() = id);
