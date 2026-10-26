-- =====================================================================
-- Metas do Gaspar — esquema do banco (Supabase / Postgres)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode rodar de novo sem problema (usa "if not exists").
-- =====================================================================

-- ---------- Metas (configuráveis pela tela de Configurações) ----------
create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null,                 -- "Leitura"
  question      text,                          -- rótulo na tela Hoje ("Roí unhas?")
  kind          text not null check (kind in ('numeric','boolean')),
  unit          text,                          -- "páginas" (só numéricas)
  step          numeric default 1,             -- incremento do stepper
  target        numeric,                       -- alvo diário (dia cumprido se valor >= alvo)
  success_value boolean,                       -- sim/não: qual resposta é sucesso
  default_value boolean,                       -- sim/não: valor assumido quando o dia fica em branco
  feeling_on    boolean,                       -- resposta que abre o campo "Sentimento" (nulo = nunca)
  weekdays      smallint[] not null default '{0,1,2,3,4,5,6}', -- 0=Dom ... 6=Sáb
  pct_mode      text not null default 'days' check (pct_mode in ('sum','days','answered')),
  start_date    date not null default '2026-10-18',
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Impede metas com o mesmo nome (evita importação duplicada no 1º login)
create unique index if not exists goals_user_nome on goals (user_id, name);

-- ---------- Valor de cada meta em cada dia ----------
create table if not exists entries (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  goal_id    uuid not null references goals on delete cascade,
  day        date not null,                    -- data local (America/Sao_Paulo), nunca timestamp
  num_value  numeric,                          -- nulo = não registrado
  bool_value boolean,                          -- nulo = em branco
  feeling    text,
  updated_at timestamptz not null default now(),
  primary key (user_id, goal_id, day)
);

-- ---------- OBS do dia (comum a todas as metas) ----------
create table if not exists day_notes (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  day        date not null,
  obs        text,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------- Listas editáveis (ex.: sentimentos) ----------
create table if not exists lists (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key     text not null,
  items   text[] not null default '{}',
  primary key (user_id, key)
);

-- ---------- Row Level Security: cada um só vê/edita as próprias linhas ----------
alter table goals     enable row level security;
alter table entries   enable row level security;
alter table day_notes enable row level security;
alter table lists     enable row level security;

drop policy if exists "dono" on goals;
drop policy if exists "dono" on entries;
drop policy if exists "dono" on day_notes;
drop policy if exists "dono" on lists;

create policy "dono" on goals     for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on entries   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on day_notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "dono" on lists     for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
