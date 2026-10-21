import { test } from 'vitest';
import { runVertexAcceptance } from './vertex-acceptance.mjs';

// Ten sequential requests have their own 60s client deadlines (no retries).
test.skipIf(process.env['OPENAI_VERTEX_LIVE'] !== '1')(
  'Vertex acceptance in an authorized environment',
  { timeout: 660_000 },
  runVertexAcceptance,
);
