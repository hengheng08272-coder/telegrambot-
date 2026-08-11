-- ---------- automatic view-count tracking ----------
-- shows.view_count already exists in the base schema and was only ever
-- editable by hand from the admin panel. This adds a safe way for
-- viewers (who only have SELECT on `shows`, never UPDATE — see
-- "admin_write_shows") to bump it themselves each time they open an
-- episode, so the number reflects real plays instead of a manually
-- typed guess. SECURITY DEFINER lets it write just this one column
-- without granting anon/authenticated any broader write access to the
-- shows table; increments are atomic (view_count = view_count + 1 in a
-- single UPDATE), so concurrent viewers never race each other.
CREATE OR REPLACE FUNCTION increment_show_view_count(p_show_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE shows SET view_count = COALESCE(view_count, 0) + 1 WHERE id = p_show_id;
$$;

GRANT EXECUTE ON FUNCTION increment_show_view_count(uuid) TO anon, authenticated;
