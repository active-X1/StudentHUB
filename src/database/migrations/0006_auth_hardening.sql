-- Phase 3: distinguish admin sessions (shorter lifetime, stricter handling) from regular user sessions.
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'user';
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('user', 'admin'));
