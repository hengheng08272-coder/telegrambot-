-- ---------- security fix: is_admin could be self-granted at signup ----------
-- `prevent_is_admin_self_update` (in the base schema) only fires on
-- UPDATE. The self-service signup flow INSERTs a new profiles row, and
-- the insert_own_profile RLS policy only checks that the row's id
-- matches the signed-in user — it never restricts the is_admin value
-- itself. That means anyone who signs up could, by calling the Supabase
-- REST API directly with their own valid session (not through this
-- app's UI, but nothing stops a client from doing it), insert their
-- profile row with `is_admin: true` and grant themselves the admin
-- panel. This closes that gap the same way the UPDATE path is already
-- closed: force is_admin to false on insert unless it's the service
-- role doing it (e.g. a script you run yourself to promote an admin).
CREATE OR REPLACE FUNCTION prevent_is_admin_self_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_admin IS TRUE AND auth.role() <> 'service_role' THEN
    NEW.is_admin := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_is_admin_self_insert ON profiles;
CREATE TRIGGER trg_prevent_is_admin_self_insert
  BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_insert();

-- Promoting an actual admin still works exactly as documented in the
-- base schema file's own instructions — run this by hand in the SQL
-- Editor (which runs as service_role, so the trigger above lets it
-- through):
--   UPDATE profiles SET is_admin = true WHERE id = '<user-uuid-here>';
