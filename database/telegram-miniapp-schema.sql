/*
# NINT VIP Mini App — standalone schema (no subscriptions, no payments)

Run this once, in order, on a brand-new Supabase project (SQL Editor ->
paste -> Run). It creates only what this Mini App actually needs:
content tables (public read, admin-only write) + an admin flag + storage
buckets for posters and videos. There are no profiles/subscriptions/
payment/OCR/session tables, because access is controlled by Telegram
group membership, not by this app.

After running this file:
1. Sign up once from the app's own sign-in screen (desktop) to create
   your admin auth user.
2. In the SQL Editor, promote that user:
     UPDATE profiles SET is_admin = true WHERE id = '<your-user-uuid>';
   (find the id under Authentication -> Users)
*/

-- ---------- content tables ----------
CREATE TABLE IF NOT EXISTS genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  synopsis text,
  poster_url text,
  banner_url text,
  release_year int,
  rating numeric(3,1) DEFAULT 0,
  status text DEFAULT 'ongoing',
  studio text,
  type text DEFAULT 'series',
  featured boolean NOT NULL DEFAULT false,
  view_count bigint DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS show_genres (
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  genre_id uuid NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (show_id, genre_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  episode_number int NOT NULL,
  season int NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  thumbnail_url text,
  video_url text,
  duration int,
  created_at timestamptz DEFAULT now(),
  UNIQUE (show_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_shows_featured ON shows(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_episodes_show_id ON episodes(show_id);

-- ---------- admin-only profiles (just enough for the desktop admin login) ----------
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_is_admin_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND auth.role() <> 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_is_admin_self_update ON profiles;
CREATE TRIGGER trg_prevent_is_admin_self_update
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_update();

-- ---------- RLS ----------
ALTER TABLE genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Public read on content — anyone opening the Mini App can browse, no login.
CREATE POLICY "public_read_genres" ON genres FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_read_shows" ON shows FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_read_show_genres" ON show_genres FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public_read_episodes" ON episodes FOR SELECT TO anon, authenticated USING (true);

-- Admin-only writes on content
CREATE POLICY "admin_write_genres" ON genres FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_write_shows" ON shows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_write_show_genres" ON show_genres FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_write_episodes" ON episodes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Profiles: a signed-in admin can read/update their own row
CREATE POLICY "select_own_profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ---------- lucky spin: one free spin, plus one bonus spin per purchase ----------
-- A small retention perk. Each Telegram account gets exactly one free
-- spin ever, PLUS one additional bonus spin per approved VIP purchase
-- (reward pool sized to what they bought — see lib/spin.ts BONUS_POOLS).
-- `source` distinguishes these ('free' vs 'purchase:<submission_id>'),
-- and the unique index below allows multiple rows per person as long as
-- each source is only ever claimed once.
CREATE TABLE IF NOT EXISTS spin_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  source text NOT NULL DEFAULT 'free',
  telegram_username text,
  reward_days int NOT NULL,
  reward_label text NOT NULL,
  created_at timestamptz DEFAULT now(),
  redeemed boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS spin_claims_one_per_source
  ON spin_claims(telegram_user_id, source);

ALTER TABLE spin_claims ENABLE ROW LEVEL SECURITY;

-- Anyone can log their own spin and read the claims list (usernames are
-- already visible to everyone in the Telegram group anyway). Only an
-- admin can mark a claim redeemed.
CREATE POLICY "public_insert_spin_claims" ON spin_claims FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_read_spin_claims" ON spin_claims FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_update_spin_claims" ON spin_claims FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));


-- ---------- announcements (shown on the Mini App home screen) ----------
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_announcements" ON announcements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_write_announcements" ON announcements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('videos', 'videos', true, 524288000,
  ARRAY['video/mp4','video/webm','application/vnd.apple.mpegurl','video/mp2t','application/x-mpegURL'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('posters', 'posters', true, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_videos" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'videos');
CREATE POLICY "admin_upload_videos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'videos' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_update_videos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'videos' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (bucket_id = 'videos' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_delete_videos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'videos' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "public_read_posters" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'posters');
CREATE POLICY "admin_upload_posters" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'posters' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_update_posters" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'posters' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (bucket_id = 'posters' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_delete_posters" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'posters' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "avatar_upload_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatar_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatar_read_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
