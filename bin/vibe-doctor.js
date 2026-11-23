#!/usr/bin/env node
import { runCli } from '../dist/index.js';

runCli(process.argv).catch((err) => {
  console.error('[vibe-doctor] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
