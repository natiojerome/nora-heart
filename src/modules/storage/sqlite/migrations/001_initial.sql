CREATE TABLE instance(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL UNIQUE) STRICT;
CREATE TABLE sessions(id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 100),next_sequence INTEGER NOT NULL DEFAULT 0,active_run TEXT,runtime_owner TEXT) STRICT;
CREATE TABLE events(
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),sequence INTEGER NOT NULL,run_id TEXT NOT NULL,
 occurred_at TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('run.started','run.progress','message','tool.started','tool.finished','run.completed','run.failed','context.checkpoint','context.usage','interaction.requested','interaction.resolved')),
 data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(session_id,sequence)
) STRICT;
CREATE TABLE reconciled_runs(session_id TEXT NOT NULL REFERENCES sessions(id),run_id TEXT NOT NULL,PRIMARY KEY(session_id,run_id)) STRICT;
CREATE TABLE projects(id TEXT PRIMARY KEY,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160)) STRICT;
CREATE TABLE conversations(
 id TEXT PRIMARY KEY REFERENCES sessions(id),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 selection TEXT CHECK(selection IS NULL OR json_valid(selection)),project_id TEXT REFERENCES projects(id),
 file_access TEXT NOT NULL DEFAULT 'read' CHECK(file_access IN('none','read','write','develop','yolo')),
 network_access INTEGER NOT NULL DEFAULT 0 CHECK(network_access IN(0,1)),max_steps INTEGER NOT NULL DEFAULT 0 CHECK(max_steps>=0)
) STRICT;
CREATE INDEX conversations_updated ON conversations(updated_at DESC,id);
CREATE TABLE memories(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),content_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('fact','preference','constraint','decision')),scope TEXT NOT NULL CHECK(scope IN('personal','project')),
 project_id TEXT REFERENCES projects(id),status TEXT NOT NULL CHECK(status IN('active','forgotten')),version INTEGER NOT NULL CHECK(version>=1),source TEXT NOT NULL CHECK(json_valid(source)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK((scope='personal' AND project_id IS NULL) OR (scope='project' AND project_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX memories_active_content ON memories(scope,coalesce(project_id,'00000000-0000-0000-0000-000000000000'),content_hash) WHERE status='active';
CREATE TABLE memory_revisions(memory_id TEXT NOT NULL REFERENCES memories(id),version INTEGER NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),PRIMARY KEY(memory_id,version)) STRICT;
CREATE TABLE assistant_profile(singleton INTEGER PRIMARY KEY CHECK(singleton=1),settings TEXT NOT NULL CHECK(json_valid(settings) AND json_type(settings)='object'),version INTEGER NOT NULL CHECK(version>0)) STRICT;
CREATE TABLE quick_prompts(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL CHECK(version>0)) STRICT;
CREATE TABLE chat_attachments(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),metadata TEXT NOT NULL CHECK(json_valid(metadata)),data BLOB NOT NULL CHECK(length(data) BETWEEN 1 AND 8388608),used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1))) STRICT;
CREATE INDEX attachments_conversation ON chat_attachments(conversation_id);
CREATE TABLE external_tools(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),config TEXT NOT NULL CHECK(json_valid(config) AND json_type(config)='object')) STRICT;
