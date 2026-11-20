ALTER TABLE harness.conversations DROP CONSTRAINT conversations_file_access_check;
ALTER TABLE harness.conversations ADD CONSTRAINT conversations_file_access_check
  CHECK (file_access IN ('none', 'read', 'write', 'develop', 'yolo'));
