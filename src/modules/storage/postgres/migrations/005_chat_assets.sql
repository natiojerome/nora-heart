CREATE TABLE harness.quick_prompts (
  id uuid PRIMARY KEY,
  data jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0)
);
CREATE TABLE harness.chat_attachments (
  id uuid PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES harness.conversations(id),
  metadata jsonb NOT NULL,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 8388608),
  used boolean NOT NULL DEFAULT false
);
CREATE INDEX ON harness.chat_attachments (conversation_id);
