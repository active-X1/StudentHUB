-- Feed: published posts, student suggestions awaiting moderation, comments and reactions.

CREATE TABLE feed_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  category      text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  published_at  timestamptz,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_posts_category_check CHECK (category IN ('Announcement', 'Study Material', 'Class Info', 'Resource', 'Event')),
  CONSTRAINT feed_posts_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  CONSTRAINT feed_posts_status_check CHECK (status IN ('draft', 'published', 'unpublished')),
  CONSTRAINT feed_posts_published_check CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX feed_posts_status_published_idx ON feed_posts (status, published_at DESC);
CREATE INDEX feed_posts_category_idx ON feed_posts (category, published_at DESC);
CREATE INDEX feed_posts_author_idx ON feed_posts (author_id);
CREATE INDEX feed_posts_search_idx ON feed_posts USING GIN (search_vector);
CREATE TRIGGER feed_posts_set_updated_at BEFORE UPDATE ON feed_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE post_hashtags (
  post_id    uuid NOT NULL REFERENCES feed_posts (id) ON DELETE CASCADE,
  hashtag_id integer NOT NULL REFERENCES hashtags (id) ON DELETE RESTRICT,
  PRIMARY KEY (post_id, hashtag_id)
);
CREATE INDEX post_hashtags_hashtag_idx ON post_hashtags (hashtag_id);

CREATE TABLE post_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category          text NOT NULL,
  body              text NOT NULL,
  tags              text[] NOT NULL DEFAULT '{}',            -- validated hashtags; turned into post_hashtags rows on approval
  status            text NOT NULL DEFAULT 'pending',
  reviewed_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  review_note       text,
  published_post_id uuid REFERENCES feed_posts (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_suggestions_category_check CHECK (category IN ('Announcement', 'Study Material', 'Class Info', 'Resource', 'Event')),
  CONSTRAINT post_suggestions_body_check CHECK (char_length(btrim(body)) BETWEEN 10 AND 1000),
  CONSTRAINT post_suggestions_tags_check CHECK (cardinality(tags) <= 10),
  CONSTRAINT post_suggestions_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT post_suggestions_review_check CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CONSTRAINT post_suggestions_note_check CHECK (review_note IS NULL OR char_length(review_note) <= 500)
);
CREATE INDEX post_suggestions_status_created_idx ON post_suggestions (status, created_at);
CREATE INDEX post_suggestions_author_idx ON post_suggestions (author_id, created_at DESC);
CREATE INDEX post_suggestions_reviewed_by_idx ON post_suggestions (reviewed_by);
CREATE INDEX post_suggestions_published_post_idx ON post_suggestions (published_post_id);
CREATE TRIGGER post_suggestions_set_updated_at BEFORE UPDATE ON post_suggestions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES feed_posts (id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,                                    -- soft delete so moderation can hide a comment without losing the thread
  CONSTRAINT comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 300)
);
CREATE INDEX comments_post_created_idx ON comments (post_id, created_at);
CREATE INDEX comments_author_idx ON comments (author_id);

CREATE TABLE reactions (
  post_id    uuid NOT NULL REFERENCES feed_posts (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reaction   text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, reaction),
  CONSTRAINT reactions_reaction_check CHECK (reaction IN ('like'))
);
CREATE INDEX reactions_user_idx ON reactions (user_id);
