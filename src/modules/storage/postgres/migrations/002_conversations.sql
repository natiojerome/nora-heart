ALTER TABLE harness.sessions ADD COLUMN active_run uuid;
ALTER TABLE harness.events DROP CONSTRAINT events_type_check;
ALTER TABLE harness.events ADD CONSTRAINT events_type_check CHECK (type IN (
  'run.started', 'message', 'tool.started', 'tool.finished', 'run.completed', 'run.failed', 'context.checkpoint'
));
CREATE TABLE harness.conversations (
  id text PRIMARY KEY REFERENCES harness.sessions(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  selection jsonb
);
CREATE INDEX ON harness.conversations (updated_at DESC, id);
