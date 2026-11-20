CREATE TABLE harness.assistant_profile (
  instance_id uuid PRIMARY KEY REFERENCES harness.instance(id),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  version integer NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
