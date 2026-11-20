-- Context estimates are journal events, independent of the selected provider.
-- Keep all previous event types and all existing rows intact.
ALTER TABLE harness.events DROP CONSTRAINT events_type_check;
ALTER TABLE harness.events ADD CONSTRAINT events_type_check CHECK (type IN (
  'run.started', 'message', 'tool.started', 'tool.finished', 'run.completed',
  'run.failed', 'context.checkpoint', 'context.usage'
));
