-- Shared helpers. Requires PostgreSQL 13+ (gen_random_uuid() is built in; no extensions are needed).

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
