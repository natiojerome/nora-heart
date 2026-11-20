CREATE TABLE harness.instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE harness.sessions (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  next_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE harness.events (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES harness.sessions(id),
  sequence bigint NOT NULL,
  run_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  type text NOT NULL CHECK (type IN (
    'run.started', 'message', 'tool.started', 'tool.finished', 'run.completed', 'run.failed'
  )),
  data jsonb NOT NULL,
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1),
  UNIQUE (session_id, sequence)
);

CREATE TABLE harness.memories (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  content_hash text NOT NULL UNIQUE CHECK (length(content_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
