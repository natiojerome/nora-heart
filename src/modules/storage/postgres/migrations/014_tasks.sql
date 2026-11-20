CREATE TABLE harness.tasks(id text PRIMARY KEY,version integer NOT NULL CHECK(version>0),conversation_id text NOT NULL REFERENCES harness.conversations(id),data jsonb NOT NULL,next_at timestamptz,active boolean NOT NULL);
CREATE INDEX tasks_due ON harness.tasks(next_at) WHERE active;
CREATE TABLE harness.task_runs(sequence bigserial PRIMARY KEY,id text NOT NULL UNIQUE,task_id text NOT NULL REFERENCES harness.tasks(id),data jsonb NOT NULL,due_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN('queued','running','waiting','succeeded','failed','interrupted','skipped','cancelled')),revision integer NOT NULL CHECK(revision>0),scheduled boolean NOT NULL,notify boolean NOT NULL,seen boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX task_runs_occurrence ON harness.task_runs(task_id,due_at) WHERE scheduled;
CREATE INDEX task_runs_history ON harness.task_runs(task_id,sequence DESC);
CREATE INDEX task_runs_open ON harness.task_runs(status) WHERE status IN('queued','running','waiting','interrupted');
