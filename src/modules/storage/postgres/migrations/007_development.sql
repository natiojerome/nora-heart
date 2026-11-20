ALTER TABLE harness.conversations DROP CONSTRAINT conversations_file_access_check;
ALTER TABLE harness.conversations ADD CONSTRAINT conversations_file_access_check
  CHECK (file_access IN ('none', 'read', 'write', 'develop'));
ALTER TABLE harness.conversations ADD COLUMN network_access boolean NOT NULL DEFAULT false;
ALTER TABLE harness.conversations ADD COLUMN max_steps integer NOT NULL DEFAULT 0 CHECK (max_steps >= 0);
