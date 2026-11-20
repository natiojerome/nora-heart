CREATE TABLE tasks(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),conversation_id TEXT NOT NULL REFERENCES conversations(id),data TEXT NOT NULL CHECK(json_valid(data)),next_at TEXT,active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
CREATE INDEX tasks_due ON tasks(next_at) WHERE active=1;
CREATE TABLE task_runs(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,task_id TEXT NOT NULL REFERENCES tasks(id),data TEXT NOT NULL CHECK(json_valid(data)),due_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('queued','running','waiting','succeeded','failed','interrupted','skipped','cancelled')),revision INTEGER NOT NULL CHECK(revision>0),scheduled INTEGER NOT NULL CHECK(scheduled IN(0,1)),notify INTEGER NOT NULL CHECK(notify IN(0,1)),seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN(0,1))) STRICT;
CREATE UNIQUE INDEX task_runs_occurrence ON task_runs(task_id,due_at) WHERE scheduled=1;
CREATE INDEX task_runs_history ON task_runs(task_id,sequence DESC);
CREATE INDEX task_runs_open ON task_runs(status) WHERE status IN('queued','running','waiting','interrupted');
