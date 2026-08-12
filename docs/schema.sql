-- EduVault — schema v0.1 (Postgres / Supabase)
-- Chạy trong Supabase SQL editor. Mọi bảng thuộc user đều bật RLS.
-- Nguyên tắc: user_id được denormalize xuống cả bảng con để policy đơn giản và index tốt.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent() không immutable nên không dùng trực tiếp trong generated column.
-- Wrapper immutable là cách chuẩn để index được tìm kiếm không dấu.
create or replace function public.f_unaccent(text)
returns text language sql immutable strict parallel safe as
$$ select public.unaccent('public.unaccent', $1) $$;

-- ---------------------------------------------------------------- enums

create type question_type   as enum ('MC', 'TF', 'SHORT', 'ESSAY');
create type difficulty      as enum ('NB', 'TH', 'VD', 'VDC');
create type question_status as enum ('draft', 'approved', 'archived');
create type job_status      as enum ('queued', 'processing', 'review', 'done', 'failed');
create type asset_kind      as enum ('crop', 'tikz', 'enhanced', 'upload');
create type export_kind     as enum ('exam', 'answer_key', 'solution', 'matrix');
create type exam_section    as enum ('I', 'II', 'III');

-- ---------------------------------------------------------------- user & gói

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  school        text,
  created_at    timestamptz not null default now()
);

create table subscriptions (
  user_id             uuid primary key references profiles on delete cascade,
  plan                text not null default 'free',   -- free | pro | school
  quota_pages_month   int  not null default 30,
  used_pages_period   int  not null default 0,
  period_start        date not null default date_trunc('month', now())::date,
  provider_ref        text,                            -- mã giao dịch SePay/PayOS
  valid_until         timestamptz
);

-- Ghi từng trang đã xử lý: vừa để tính quota, vừa để đo giá vốn thật/trang.
create table usage_ledger (
  id            bigserial primary key,
  user_id       uuid not null references profiles on delete cascade,
  source_id     uuid,
  pages         int  not null,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,6),
  created_at    timestamptz not null default now()
);
create index on usage_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------- taxonomy dùng chung

-- Không thuộc user nào. Ai đăng nhập cũng đọc được, chỉ service_role ghi.
create table topics (
  id         uuid primary key default gen_random_uuid(),
  subject    text not null,              -- 'physics' trước, sau mới thêm môn
  grade      int  check (grade between 10 and 12),
  code       text not null,              -- 'p12.nuclear'
  name       text not null,              -- 'Vật lí hạt nhân và phóng xạ'
  parent_id  uuid references topics on delete cascade,
  sort_order int not null default 0,
  unique (subject, code)
);
create index on topics (subject, grade);

-- ---------------------------------------------------------------- nhập liệu

create table sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,
  filename     text not null,
  storage_path text not null,
  mime_type    text not null,
  page_count   int,
  created_at   timestamptz not null default now()
);
create index on sources (user_id, created_at desc);

create table ingest_jobs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles on delete cascade,
  source_id      uuid not null references sources on delete cascade,
  status         job_status not null default 'queued',
  pages_done     int not null default 0,
  questions_found int not null default 0,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index on ingest_jobs (user_id, status);

-- ---------------------------------------------------------------- kho câu hỏi

create table questions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles on delete cascade,
  source_id     uuid references sources on delete set null,
  source_page   int,

  subject       text not null default 'physics',
  grade         int check (grade between 10 and 12),
  topic_id      uuid references topics on delete set null,
  type          question_type not null,
  difficulty    difficulty not null default 'TH',
  status        question_status not null default 'draft',

  -- Nguồn sự thật là LaTeX-subset. Hình nhúng bằng placeholder [[IMG:n]].
  stem_latex     text not null,
  solution_latex text,

  -- Chỉ một trong ba trường sau có giá trị, tuỳ theo `type`.
  mc_choices    jsonb,  -- [{"label":"A","text_latex":"..."}, ...]
  mc_correct    char(1) check (mc_correct in ('A','B','C','D')),
  tf_statements jsonb,  -- [{"idx":"a","text_latex":"...","is_true":true}, ... x4]
  short_answer  jsonb,  -- {"value":3.14,"unit":"m/s","tolerance":0.01}

  tags          text[] not null default '{}',
  ai_confidence numeric(3,2),          -- từ bước đối chiếu, dùng cho "duyệt hàng loạt"
  ai_flags      jsonb,                 -- các trường hai model bất đồng

  -- Chống trùng khi upload nhiều nguồn chồng chéo.
  stem_hash text generated always as
    (md5(lower(regexp_replace(stem_latex, '\s+', '', 'g')))) stored,

  search_vector tsvector generated always as (
    to_tsvector('simple', public.f_unaccent(coalesce(stem_latex, '')))
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mc_shape    check (type <> 'MC'    or (mc_choices is not null and mc_correct is not null)),
  constraint tf_shape    check (type <> 'TF'    or jsonb_array_length(tf_statements) = 4),
  constraint short_shape check (type <> 'SHORT' or short_answer ? 'value')
);

create index on questions (user_id, status, type);
create index on questions (user_id, topic_id, difficulty);
create index on questions (user_id, stem_hash);
create index on questions using gin (search_vector);
create index on questions using gin (stem_latex gin_trgm_ops);   -- tìm câu gần trùng
create index on questions using gin (tags);

create table question_assets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles on delete cascade,
  question_id uuid not null references questions on delete cascade,
  slot        int  not null,              -- khớp với [[IMG:n]] trong stem_latex
  kind        asset_kind not null,
  storage_path text,                      -- ảnh đã render/crop
  original_path text,                     -- luôn giữ bản gốc để so sánh và hoàn tác
  tikz_source text,
  width_px    int,
  height_px   int,
  created_at  timestamptz not null default now(),
  unique (question_id, slot)
);

-- ---------------------------------------------------------------- ráp đề

create table blueprints (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  name       text not null,               -- 'Giữa kỳ 1 — Lý 12'
  -- [{"section":"I","type":"MC","count":18,
  --   "difficulty":{"NB":6,"TH":7,"VD":4,"VDC":1},
  --   "topics":[{"topic_id":"...","count":5}]}, ...]
  spec       jsonb not null,
  duration_min int default 50,
  created_at timestamptz not null default now()
);
create index on blueprints (user_id);

create table layouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references profiles on delete cascade,  -- null = mẫu dựng sẵn
  name          text not null,
  header_config jsonb not null,   -- {"org":"SỞ GD&ĐT…","school":"…","logo_path":"…","title":"…"}
  reference_docx_path text,       -- user tự upload để khớp quy định của trường
  created_at    timestamptz not null default now()
);

create table exams (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,
  title        text not null,
  blueprint_id uuid references blueprints on delete set null,
  layout_id    uuid references layouts on delete set null,
  duration_min int default 50,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on exams (user_id, created_at desc);

create table exam_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles on delete cascade,
  exam_id     uuid not null references exams on delete cascade,
  question_id uuid not null references questions on delete restrict,
  section     exam_section not null,
  position    int not null,
  unique (exam_id, section, position)
);
create index on exam_items (exam_id);

-- Mã đề 101/102/103/104. Thứ tự trộn tái tạo được từ seed, không cần lưu cả hoán vị.
create table exam_versions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,
  exam_id      uuid not null references exams on delete cascade,
  code         text not null,          -- '101'
  shuffle_seed bigint not null,
  shuffle_choices boolean not null default true,
  unique (exam_id, code)
);

-- Undo: lưu snapshot nguyên trạng, không lưu diff. Restore = ghi đè lại từ snapshot.
create table exam_revisions (
  id         bigserial primary key,
  user_id    uuid not null references profiles on delete cascade,
  exam_id    uuid not null references exams on delete cascade,
  snapshot   jsonb not null,
  note       text,
  created_at timestamptz not null default now()
);
create index on exam_revisions (exam_id, created_at desc);

-- File đã xuất. Giữ snapshot nội dung để mở lại đề cũ vẫn đúng nguyên bản,
-- kể cả khi câu gốc trong kho đã bị sửa.
create table exports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,
  exam_id      uuid not null references exams on delete cascade,
  version_code text,
  kind         export_kind not null,
  format       text not null default 'docx',
  storage_path text not null,
  content_snapshot jsonb not null,
  created_at   timestamptz not null default now()
);
create index on exports (exam_id, created_at desc);

-- ---------------------------------------------------------------- RLS

alter table profiles        enable row level security;
alter table subscriptions   enable row level security;
alter table usage_ledger    enable row level security;
alter table sources         enable row level security;
alter table ingest_jobs     enable row level security;
alter table questions       enable row level security;
alter table question_assets enable row level security;
alter table blueprints      enable row level security;
alter table layouts         enable row level security;
alter table exams           enable row level security;
alter table exam_items      enable row level security;
alter table exam_versions   enable row level security;
alter table exam_revisions  enable row level security;
alter table exports         enable row level security;
alter table topics          enable row level security;

create policy "self" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'subscriptions','usage_ledger','sources','ingest_jobs','questions',
    'question_assets','blueprints','exams','exam_items','exam_versions',
    'exam_revisions','exports'
  ] loop
    execute format(
      'create policy "owner" on %I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- layouts: mẫu dựng sẵn (user_id null) ai cũng đọc, mẫu riêng chỉ chủ sở hữu.
create policy "read own or builtin" on layouts
  for select using (user_id is null or auth.uid() = user_id);
create policy "write own" on layouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- topics là dữ liệu chung, chỉ service_role được ghi.
create policy "read all" on topics for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------- kiểm tra bắt buộc
-- Trước khi lên production phải có test tự động: đăng nhập bằng user A, cố SELECT
-- questions của user B, khẳng định trả về 0 dòng. Rò dữ liệu giữa giáo viên là lỗi
-- không thể sửa sau khi đã xảy ra.
