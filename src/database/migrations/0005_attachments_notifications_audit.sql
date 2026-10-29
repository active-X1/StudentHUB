-- Attachments (metadata only; file bytes live in object storage), notifications and the admin audit log.

CREATE TABLE attachments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  personal_assignment_id uuid REFERENCES personal_assignments (id) ON DELETE CASCADE,
  general_assignment_id  uuid REFERENCES general_assignments (id) ON DELETE CASCADE,
  feed_post_id           uuid REFERENCES feed_posts (id) ON DELETE CASCADE,
  post_suggestion_id     uuid REFERENCES post_suggestions (id) ON DELETE CASCADE,
  storage_key            text NOT NULL,                      -- random key; the user-supplied file name is NEVER used in a storage path
  original_filename      text NOT NULL,
  content_type           text NOT NULL,                      -- the server-detected type, not the browser-declared one
  size_bytes             bigint NOT NULL,
  checksum_sha256        text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Exactly one owner. Read access to a personal assignment's attachment is decided through personal_assignments.user_id.
  CONSTRAINT attachments_single_owner_check CHECK (num_nonnulls(personal_assignment_id, general_assignment_id, feed_post_id, post_suggestion_id) = 1),
  CONSTRAINT attachments_storage_key_key UNIQUE (storage_key),
  CONSTRAINT attachments_storage_key_format_check CHECK (storage_key ~ '^[A-Za-z0-9_-]{32,128}$'),
  CONSTRAINT attachments_filename_check CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  CONSTRAINT attachments_content_type_check CHECK (content_type IN (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  CONSTRAINT attachments_size_check CHECK (size_bytes > 0 AND size_bytes <= 5242880),   -- 5 MB, matching the prototype limit
  CONSTRAINT attachments_checksum_check CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT attachments_status_check CHECK (status IN ('pending', 'ready', 'rejected'))
);
CREATE INDEX attachments_uploaded_by_idx ON attachments (uploaded_by);
CREATE INDEX attachments_personal_assignment_idx ON attachments (personal_assignment_id) WHERE personal_assignment_id IS NOT NULL;
CREATE INDEX attachments_general_assignment_idx ON attachments (general_assignment_id) WHERE general_assignment_id IS NOT NULL;
CREATE INDEX attachments_feed_post_idx ON attachments (feed_post_id) WHERE feed_post_id IS NOT NULL;
CREATE INDEX attachments_post_suggestion_idx ON attachments (post_suggestion_id) WHERE post_suggestion_id IS NOT NULL;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_type_check CHECK (type IN ('announcement', 'deadline_reminder', 'reply', 'suggestion_reviewed')),
  CONSTRAINT notifications_title_check CHECK (char_length(title) BETWEEN 1 AND 200)
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE admin_audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE RESTRICT,   -- RESTRICT (not SET NULL): audit rows are immutable, so accounts with history are suspended, never hard-deleted
  actor_label text NOT NULL,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_action_check CHECK (char_length(action) BETWEEN 1 AND 200)
);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_logs_actor_idx ON admin_audit_logs (actor_id);
CREATE INDEX admin_audit_logs_entity_idx ON admin_audit_logs (entity_type, entity_id);

-- Append-only: rows cannot be updated, deleted or truncated through normal SQL.
CREATE FUNCTION prevent_audit_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$$;
CREATE TRIGGER admin_audit_logs_no_change BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_change();
CREATE TRIGGER admin_audit_logs_no_truncate BEFORE TRUNCATE ON admin_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_change();
