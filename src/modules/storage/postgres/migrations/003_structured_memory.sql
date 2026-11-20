CREATE TABLE harness.projects (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160)
);
ALTER TABLE harness.conversations ADD COLUMN project_id uuid REFERENCES harness.projects(id);
ALTER TABLE harness.memories
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN kind text NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'preference', 'constraint', 'decision')),
  ADD COLUMN scope text NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'project')),
  ADD COLUMN project_id uuid REFERENCES harness.projects(id),
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forgotten')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN source jsonb NOT NULL DEFAULT '{"type":"legacy"}',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT memories_scope_project CHECK ((scope = 'personal' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL));
UPDATE harness.memories SET title = left(content, 160), updated_at = created_at;
ALTER TABLE harness.memories DROP CONSTRAINT memories_content_hash_key;
CREATE UNIQUE INDEX memories_active_content ON harness.memories (
  scope, (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)), content_hash
) WHERE status = 'active';
CREATE TABLE harness.memory_revisions (
  memory_id uuid NOT NULL REFERENCES harness.memories(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (memory_id, version)
);
INSERT INTO harness.memory_revisions (memory_id, version, snapshot)
SELECT id, version, jsonb_build_object('id', id, 'title', title, 'content', content,
  'kind', kind, 'scope', scope, 'projectId', project_id, 'status', status, 'version', version,
  'source', source, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM harness.memories;
