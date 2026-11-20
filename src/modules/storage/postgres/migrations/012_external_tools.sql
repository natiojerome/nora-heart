-- Owner-reviewed connection metadata and JSON Schema snapshots, never credentials.
CREATE TABLE harness.external_tools (
  id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object')
);
