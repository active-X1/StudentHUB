-- Hashtags, private (personal) assignments and department-published (general) assignments.

CREATE TABLE hashtags (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,                         -- stored without the leading "#", original casing kept for display
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hashtags_name_format_check CHECK (name ~ '^[A-Za-z0-9_]{1,50}$')
);
CREATE UNIQUE INDEX hashtags_name_lower_key ON hashtags (lower(name));

CREATE TABLE personal_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- ownership: every query MUST filter by the signed-in user
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  course       text NOT NULL,
  lecturer     text,
  due_date     date NOT NULL,
  priority     text NOT NULL DEFAULT 'medium',
  status       text NOT NULL DEFAULT 'todo',
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_assignments_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT personal_assignments_description_check CHECK (char_length(description) <= 1000),
  CONSTRAINT personal_assignments_course_check CHECK (char_length(btrim(course)) BETWEEN 1 AND 120),
  CONSTRAINT personal_assignments_priority_check CHECK (priority IN ('low', 'medium', 'high')),
  CONSTRAINT personal_assignments_status_check CHECK (status IN ('todo', 'in-progress', 'done')),
  CONSTRAINT personal_assignments_completed_check CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX personal_assignments_user_due_idx ON personal_assignments (user_id, due_date);
CREATE INDEX personal_assignments_user_status_idx ON personal_assignments (user_id, status);
CREATE TRIGGER personal_assignments_set_updated_at BEFORE UPDATE ON personal_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE general_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  course       text NOT NULL,
  category     text NOT NULL DEFAULT 'Coursework',
  description  text NOT NULL DEFAULT '',
  due_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT general_assignments_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT general_assignments_course_check CHECK (char_length(btrim(course)) BETWEEN 1 AND 120),
  CONSTRAINT general_assignments_description_check CHECK (char_length(description) <= 4000),
  CONSTRAINT general_assignments_status_check CHECK (status IN ('draft', 'published', 'unpublished')),
  CONSTRAINT general_assignments_published_check CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX general_assignments_status_due_idx ON general_assignments (status, due_date);
CREATE INDEX general_assignments_status_published_idx ON general_assignments (status, published_at DESC);
CREATE INDEX general_assignments_course_idx ON general_assignments (course);
CREATE INDEX general_assignments_created_by_idx ON general_assignments (created_by);
CREATE INDEX general_assignments_updated_by_idx ON general_assignments (updated_by);
CREATE TRIGGER general_assignments_set_updated_at BEFORE UPDATE ON general_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE personal_assignment_hashtags (
  assignment_id uuid NOT NULL REFERENCES personal_assignments (id) ON DELETE CASCADE,
  hashtag_id    integer NOT NULL REFERENCES hashtags (id) ON DELETE RESTRICT,
  PRIMARY KEY (assignment_id, hashtag_id)
);
CREATE INDEX personal_assignment_hashtags_hashtag_idx ON personal_assignment_hashtags (hashtag_id);

CREATE TABLE general_assignment_hashtags (
  assignment_id uuid NOT NULL REFERENCES general_assignments (id) ON DELETE CASCADE,
  hashtag_id    integer NOT NULL REFERENCES hashtags (id) ON DELETE RESTRICT,
  PRIMARY KEY (assignment_id, hashtag_id)
);
CREATE INDEX general_assignment_hashtags_hashtag_idx ON general_assignment_hashtags (hashtag_id);
