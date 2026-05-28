#!/usr/bin/env node
/**
 * Wipe `dist/` before tsup runs. tsup's own `clean: true` can't be used
 * because the build is split across two configs (see tsup.config.ts) that
 * run in parallel — one config's clean would race the other's writes.
 */

import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
