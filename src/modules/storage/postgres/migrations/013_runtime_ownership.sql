-- Runtime-scoped advisory lease; old claims remain explicit and unverifiable.
ALTER TABLE harness.sessions ADD COLUMN runtime_owner uuid;
CREATE TABLE harness.reconciled_runs (
  session_id text NOT NULL REFERENCES harness.sessions(id),
  run_id text NOT NULL,
  PRIMARY KEY(session_id, run_id)
);
