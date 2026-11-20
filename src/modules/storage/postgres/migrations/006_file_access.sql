ALTER TABLE harness.conversations ADD COLUMN file_access text NOT NULL DEFAULT 'read'
  CHECK (file_access IN ('none', 'read', 'write'));
