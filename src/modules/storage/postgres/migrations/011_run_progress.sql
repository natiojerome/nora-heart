-- Public commentary is journalled separately from the model context.
ALTER TABLE harness.events DROP CONSTRAINT events_type_check;
ALTER TABLE harness.events ADD CONSTRAINT events_type_check CHECK (type IN (
  'run.started', 'run.progress', 'message', 'tool.started', 'tool.finished',
  'run.completed', 'run.failed', 'context.checkpoint', 'context.usage',
  'interaction.requested', 'interaction.resolved'
));
