-- Remove only local-project foreign keys; preserve IDs, content and all child references.
CREATE TABLE conversations_remote(
 id TEXT PRIMARY KEY REFERENCES sessions(id),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 selection TEXT CHECK(selection IS NULL OR json_valid(selection)),project_id TEXT,
 file_access TEXT NOT NULL DEFAULT 'read' CHECK(file_access IN('none','read','write','develop','yolo')),
 network_access INTEGER NOT NULL DEFAULT 0 CHECK(network_access IN(0,1)),max_steps INTEGER NOT NULL DEFAULT 0 CHECK(max_steps>=0)
) STRICT;
INSERT INTO conversations_remote SELECT * FROM conversations;
DROP TABLE conversations;
ALTER TABLE conversations_remote RENAME TO conversations;

CREATE INDEX conversations_updated ON conversations(updated_at DESC,id);

CREATE TABLE memories_remote(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),content_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('fact','preference','constraint','decision')),scope TEXT NOT NULL CHECK(scope IN('personal','project')),
 project_id TEXT,status TEXT NOT NULL CHECK(status IN('active','forgotten')),version INTEGER NOT NULL CHECK(version>=1),source TEXT NOT NULL CHECK(json_valid(source)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((scope='personal' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL))
) STRICT;
INSERT INTO memories_remote SELECT * FROM memories;
DROP TABLE memories;
ALTER TABLE memories_remote RENAME TO memories;

CREATE UNIQUE INDEX memories_active_content ON memories(scope,coalesce(project_id,'00000000-0000-0000-0000-000000000000'),content_hash) WHERE status='active';
