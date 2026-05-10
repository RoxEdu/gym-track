-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)

-- 1. Create the progress_photos table
create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  filename text not null,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table progress_photos enable row level security;

-- Users can only see/manage their own photos
create policy "Users own their photos"
  on progress_photos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Create the Storage bucket
-- Go to: Supabase Dashboard → Storage → New Bucket
--   Name: progress-photos
--   Public bucket: YES  (so generated URLs work without signed tokens)
--
-- Then add these Storage policies:
--   INSERT: auth.uid()::text = (storage.foldername(name))[1]
--   SELECT: bucket_id = 'progress-photos'
--   DELETE: auth.uid()::text = (storage.foldername(name))[1]
