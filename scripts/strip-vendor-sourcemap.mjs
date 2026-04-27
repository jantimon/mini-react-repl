#!/usr/bin/env node
/**
 * The default vendor bundle is ~4 MB of pre-compiled third-party code
 * already embedded as base64 data URLs. Its source map doubles the unpacked
 * size of the npm tarball without giving consumers anything actionable
 * (no original sources to step into). Drop the .map file and strip the
 * sourceMappingURL comment so browsers don't 404 looking for it.
 */

import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsPath = resolve(root, 'dist/vendor-default/index.js');
const mapPath = `${jsPath}.map`;

await rm(mapPath, { force: true });

const src = await readFile(jsPath, 'utf8');
const stripped = src.replace(/\n\/\/# sourceMappingURL=.*$/gm, '');
await writeFile(jsPath, stripped, 'utf8');
