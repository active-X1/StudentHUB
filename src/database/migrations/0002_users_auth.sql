-- Accounts, roles, OAuth identities, sessions and login-attempt tracking.
-- Authentication logic arrives in Phase 3; the schema is created now so later phases build on stable tables.

CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username             text,                       -- lowercase; used by the admin account ("admin") rather than email
  email                text,
  display_name         text NOT NULL,
  password_hash        text,                       -- NULL for OAuth-only accounts; only Argon2id/bcrypt hashes are ever stored
  avatar_url           text,
  department           text,
  study_level          text,
  bio                  text,
  status               text NOT NULL DEFAULT 'active',
  email_verified_at    timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,   -- forced change on first admin login
  password_changed_at  timestamptz,
  failed_login_count   smallint NOT NULL DEFAULT 0,      -- persisted counters survive restarts and cleared browser storage
  last_failed_login_at timestamptz,
  locked_until         timestamptz,                      -- admin lockout: reset at the next calendar day in SERVER_TIMEZONE
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT users_identifier_check CHECK (email IS NOT NULL OR username IS NOT NULL),
  CONSTRAINT users_email_format_check CHECK (email IS NULL OR (char_length(email) <= 254 AND position('@' IN email) > 1)),
  CONSTRAINT users_username_format_check CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  CONSTRAINT users_display_name_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT users_bio_check CHECK (bio IS NULL OR char_length(bio) <= 160),
  CONSTRAINT users_failed_login_count_check CHECK (failed_login_count >= 0)
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_username_key ON users (username) WHERE username IS NOT NULL;
CREATE INDEX users_status_idx ON users (status);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id          smallint PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text NOT NULL,
  CONSTRAINT roles_name_check CHECK (name ~ '^[a-z_]+$')
);
-- Reference data (not sample data): the role set the application authorises against.
INSERT INTO roles (id, name, description) VALUES
  (1, 'student',  'Department student'),
  (2, 'lecturer', 'Teaching staff who can post course content'),
  (3, 'admin',    'Administrator with access to the admin dashboard');

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id    smallint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);
CREATE INDEX user_roles_granted_by_idx ON user_roles (granted_by);

CREATE TABLE oauth_identities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         text NOT NULL,
  provider_user_id text NOT NULL,
  provider_email   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identities_provider_check CHECK (provider IN ('google', 'github')),
  CONSTRAINT oauth_identities_provider_uid_key UNIQUE (provider, provider_user_id)
);
CREATE INDEX oauth_identities_user_id_idx ON oauth_identities (user_id);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL,                      -- SHA-256 of the cookie token; the raw token is never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip_address   inet,
  user_agent   text,
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_len_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  identifier_hash bytea NOT NULL,                   -- keyed hash of the normalised email/username, so unknown names are throttled without storing them
  ip_address      inet,
  succeeded       boolean NOT NULL,
  is_admin_login  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_user_id_idx ON login_attempts (user_id);
CREATE INDEX login_attempts_identifier_idx ON login_attempts (identifier_hash, created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip_address, created_at DESC);
CREATE INDEX login_attempts_created_at_idx ON login_attempts (created_at);
