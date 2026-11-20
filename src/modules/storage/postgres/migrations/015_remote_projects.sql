-- IDs can refer to the remote authority. Preserve all legacy rows and references.
ALTER TABLE harness.conversations DROP CONSTRAINT conversations_project_id_fkey;
ALTER TABLE harness.memories DROP CONSTRAINT memories_project_id_fkey;
