/**
 * Main-thread orchestration of the transform worker.
 *
 * Owns:
 *   - the worker lifecycle (lazy init, ready promise)
 *   - the per-path debounce
 *   - the in-flight request tracker
 *
 * Does NOT own:
 *   - blob URLs (the iframe creates and revokes them inside its own context;
 *     parent-created blob URLs don't load reliably under srcdoc)
 *   - the file table (consumer's `files` prop is the source of truth)
 *   - the iframe (handled by `<ReplPreview/>`)
 *
 * @internal
 */

import { initLexer, rewriteImports, ResolveError, VIRTUAL_KEY_PREFIX } from './import-rewriter.ts';
import { defaultLoader } from './default-loader.ts';
import type { ModulePayload } from '../runtime/protocol.ts';
import type { ReplLoader, ReplTransform } from '../types.ts';

const DEFAULT_SWC_WASM_URL = 'https://cdn.jsdelivr.net/npm/@swc/wasm-web@1.15.30/wasm_bg.wasm';

export type { ModulePayload };

export type TransformError = {
  path: string;
  message: string;
  loc?: { line: number; column: number };
  kind: 'transform' | 'resolve';
  /** Specifier that failed to resolve (only when kind === 'resolve'). */
  specifier?: string;
};

export type TransformClientOptions = {
  /** URL of swc-wasm. Pass a self-hosted path for offline / strict CSP. */
  swcWasmUrl?: string;
  /** Idle ms before transforming after the latest `setFile` call. */
  debounceMs?: number;
  /** Called when a module is ready for the iframe. */
  onModule: (mod: ModulePayload) => void;
  /** Called when a CSS file's content changes. */
  onCssUpsert: (path: string, css: string) => void;
  /** Called when a CSS file is removed. */
  onCssRemove: (path: string) => void;
  /** Called when a transform or resolve fails. */
  onError: (err: TransformError) => void;
  /**
   * Per-file pre-processor. Defaults to {@link defaultLoader} (which
   * implements `.css` → `<style>`, `.tsx`/`.ts`/`.jsx`/`.js` → swc,
   * everything else → ignored).
   *
   * A custom loader fully replaces the default; delegate to `defaultLoader`
   * for files you don't want to handle.
   */
  loader?: ReplLoader;
  /**
   * Inline virtual modules: `Record<alias, source>`. Each entry is compiled
   * with swc (TSX) and emitted as a `ModulePayload` with a synthetic key
   * (`VIRTUAL_KEY_PREFIX + alias`). User code that imports the alias gets
   * the literal specifier substituted for the virtual's blob URL by the
   * iframe runtime — same mechanism as relative imports.
   *
   * Snapshotted at construction time. Incremental edits (`syncFiles`) never
   * touch virtuals.
   */
  virtualModules?: Record<string, string>;
};

/** A resettable, debounced transform driver. */
export class TransformClient {
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    { path: string; resolve: (code: string) => void; reject: (err: unknown) => void }
  >();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private latestSource = new Map<string, string>();
  private files: Record<string, string> = {};
  private disposed = false;
  /**
   * Paths currently injected as CSS in the iframe. We track this so removals
   * can pick the right teardown branch — built-in `.css` files and loader-
   * produced CSS look the same from `handleRemoval`'s perspective.
   */
  private cssPaths = new Set<string>();
  /**
   * Virtual modules: alias → source. Snapshotted at construction. The alias
   * set is the rewriter's signal that a bare specifier should be treated as
   * a dep (substitution path) rather than passed through to the import map.
   */
  private readonly virtualSources: Record<string, string>;
  private readonly virtualAliases: ReadonlySet<string>;

  constructor(private readonly opts: TransformClientOptions) {
    this.virtualSources = opts.virtualModules ?? {};
    this.virtualAliases = new Set(Object.keys(this.virtualSources));
  }

  /**
   * Replace the files snapshot without scheduling any transforms.
   * Used for cold boot where {@link transformAll} drives the work.
   */
  setFiles(next: Record<string, string>): void {
    if (this.disposed) return;
    this.files = next;
  }

  /**
   * Synchronize with a new files snapshot.
   *
   * Diffs against the previous snapshot:
   *   - new file or changed source → schedule debounced transform
   *   - removed file → emit removal (CSS) or drop pending (JS)
   *
   * CSS files bypass the worker and go straight to the iframe via
   * `onCssUpsert` / `onCssRemove`.
   */
  syncFiles(next: Record<string, string>): void {
    if (this.disposed) return;
    const prev = this.files;
    this.files = next;

    let moduleRemoved = false;
    for (const path of Object.keys(prev)) {
      if (!(path in next)) {
        // Anything that wasn't injected as CSS could have been a module;
        // assume dependents need re-resolution.
        if (!this.cssPaths.has(path)) moduleRemoved = true;
        this.handleRemoval(path);
      }
    }

    // Every file flows through the loader (default or custom) — the loader
    // decides what to actually do (compile, inject as CSS, or skip).
    for (const path of Object.keys(next)) {
      const newSource = next[path]!;
      if (prev[path] === newSource) continue;
      this.scheduleTransform(path, newSource);
    }

    // When a module is removed, dependents may have stale imports pointing
    // at it. Re-transform every other file so rewriteImports sees the new
    // state and surfaces ResolveError for any reference to the removed path.
    if (moduleRemoved) {
      for (const path of Object.keys(next)) {
        this.scheduleTransform(path, next[path]!);
      }
    }
  }

  /**
   * Transform every code file from scratch.
   *
   * Files are emitted in dependency order (topological sort) so the iframe
   * can build blob URLs with already-resolved deps for each module.
   */
  async transformAll(): Promise<void> {
    if (this.disposed) return;
    await this.ensureWorker();
    await initLexer();
    const loader = this.opts.loader ?? defaultLoader;

    // 1a. compile virtual modules. They bypass the user-supplied loader
    //     (always TSX, always swc) and live under synthetic keys so they
    //     never collide with user files.
    const mods: { path: string; code: string }[] = [];
    await Promise.all(
      Object.entries(this.virtualSources).map(async ([alias, source]) => {
        const virtualKey = VIRTUAL_KEY_PREFIX + alias;
        try {
          const code = await this.runTransform(virtualKey, source, true);
          mods.push({ path: virtualKey, code });
        } catch (err) {
          this.reportError(err, virtualKey);
        }
      }),
    );

    // 1b. run the loader on every user file in parallel. CSS is upserted
    //     right away; modules collect for the dep-graph + topo-emit pass.
    await Promise.all(
      Object.entries(this.files).map(async ([path, source]) => {
        try {
          const result = await loader({ path, source, transform: this.boundTransform(path) });
          if (!result) return;
          if (result.kind === 'css') {
            this.upsertCss(path, result.source);
            return;
          }
          mods.push({ path, code: result.code });
        } catch (err) {
          this.reportError(err, path);
        }
      }),
    );
    const byPath = new Map(mods.map((m) => [m.path, m]));

    // 2. discover dep graph from each module body. Bare specifiers that
    //    match a virtual alias produce a topo edge so virtuals are emitted
    //    before any consumer — without this, `buildBlobUrl()` in the iframe
    //    runtime can't substitute the alias for the virtual's blob URL.
    const lexer = await import('es-module-lexer');
    const depGraph = new Map<string, string[]>();
    for (const m of mods) {
      try {
        const [specs] = lexer.parse(m.code);
        const deps: string[] = [];
        for (const s of specs) {
          const raw = s.n ?? (s.s >= 0 ? m.code.slice(s.s, s.e) : '');
          const name = raw.replace(/^['"]|['"]$/g, '');
          if (name.startsWith('./') || name.startsWith('/')) {
            const tgt = resolveLogical(name, this.files);
            if (tgt) deps.push(tgt);
          } else if (this.virtualAliases.has(name)) {
            deps.push(VIRTUAL_KEY_PREFIX + name);
          }
        }
        depGraph.set(m.path, deps);
      } catch {
        depGraph.set(m.path, []);
      }
    }

    // 3. topological sort.
    const order = topoSort(depGraph);

    // 4. emit in topo order.
    for (const path of order) {
      const m = byPath.get(path);
      if (!m) continue;
      try {
        const rewritten = rewriteImports(path, m.code, this.files, this.virtualAliases);
        this.opts.onModule({
          path,
          code: rewritten.code,
          deps: rewritten.deps,
        });
      } catch (err) {
        this.reportError(err, path);
      }
    }
  }

  private scheduleTransform(path: string, source: string): void {
    this.latestSource.set(path, source);
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);
    const debounce = this.opts.debounceMs ?? 150;
    const timer = setTimeout(() => {
      this.timers.delete(path);
      void this.processOne(path);
    }, debounce);
    this.timers.set(path, timer);
  }

  private async processOne(path: string): Promise<void> {
    if (this.disposed) return;
    const source = this.latestSource.get(path);
    if (source === undefined) return;
    try {
      await this.ensureWorker();
      const loader = this.opts.loader ?? defaultLoader;
      const result = await loader({ path, source, transform: this.boundTransform(path) });
      if (!result) return;
      if (result.kind === 'css') {
        this.upsertCss(path, result.source);
        return;
      }
      await initLexer();
      const rewritten = rewriteImports(path, result.code, this.files, this.virtualAliases);
      this.opts.onModule({
        path,
        code: rewritten.code,
        deps: rewritten.deps,
      });
    } catch (err) {
      this.reportError(err, path);
    }
  }

  /** A {@link ReplTransform} bound to one file's path (for source map filename). */
  private boundTransform(path: string): ReplTransform {
    return (src, opts) => this.runTransform(path, src, opts?.tsx);
  }

  private upsertCss(path: string, css: string): void {
    this.cssPaths.add(path);
    this.opts.onCssUpsert(path, css);
  }

  private removeCss(path: string): void {
    this.cssPaths.delete(path);
    this.opts.onCssRemove(path);
  }

  private reportError(err: unknown, path: string): void {
    if (err instanceof ResolveError) {
      this.opts.onError({
        kind: 'resolve',
        path: err.path,
        message: err.message,
        specifier: err.specifier,
      });
      return;
    }
    if (isTransformError(err)) {
      this.opts.onError({
        kind: 'transform',
        path: err.path,
        message: err.message,
        ...(err.loc ? { loc: err.loc } : {}),
      });
      return;
    }
    this.opts.onError({
      kind: 'transform',
      path,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  private handleRemoval(path: string): void {
    if (this.cssPaths.has(path)) {
      this.removeCss(path);
      return;
    }
    this.latestSource.delete(path);
    const t = this.timers.get(path);
    if (t) {
      clearTimeout(t);
      this.timers.delete(path);
    }
  }

  private async ensureWorker(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    this.workerReady = new Promise<void>((resolve, reject) => {
      const worker = new Worker(this.workerUrl(), { type: 'module' });
      const wasmUrl = this.opts.swcWasmUrl ?? DEFAULT_SWC_WASM_URL;
      this.worker = worker;

      let initSent = false;
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.kind === 'worker-loaded') {
          if (!initSent) {
            initSent = true;
            const id = ++this.requestId;
            worker.postMessage({ kind: 'init', id, wasmUrl });
          }
          return;
        }
        if (msg.kind === 'init-ok') return resolve();
        if (msg.kind === 'init-err')
          return reject(new Error(`swc-wasm init failed: ${msg.message}`));
        if (msg.kind === 'transform-ok' || msg.kind === 'transform-err') {
          this.handleTransformResponse(msg);
        }
      };
      worker.onerror = (err) => {
        reject(new Error(`worker error: ${err.message ?? 'unknown'}`));
      };
    });
    return this.workerReady;
  }

  /**
   * Resolve the URL of the bundled worker. After tsup, this lives at
   * `dist/worker.js` next to `dist/index.js`. Modern bundlers (Vite,
   * Rollup 4+, Webpack 5+, esbuild, Parcel 2+) recognize this exact
   * `new Worker(new URL('./worker.js', import.meta.url))` pattern and
   * emit / fingerprint the worker correctly.
   */
  private workerUrl(): URL {
    return new URL('./worker.js', import.meta.url);
  }

  private runTransform(path: string, source: string, tsx?: boolean): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('worker not started'));
        return;
      }
      const id = ++this.requestId;
      this.pending.set(id, { path, resolve, reject });
      this.worker.postMessage({
        kind: 'transform',
        id,
        path,
        source,
        ...(tsx !== undefined ? { tsx } : {}),
      });
    });
  }

  private handleTransformResponse(
    msg:
      | { kind: 'transform-ok'; id: number; path: string; code: string }
      | {
          kind: 'transform-err';
          id: number;
          path: string;
          message: string;
          loc?: { line: number; column: number };
        },
  ): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.kind === 'transform-ok') {
      pending.resolve(msg.code);
    } else {
      const err: TransformError & { __isTransformError: true } = {
        __isTransformError: true,
        kind: 'transform',
        path: msg.path,
        message: msg.message,
        ...(msg.loc ? { loc: msg.loc } : {}),
      };
      pending.reject(err);
    }
  }

  /** Stop processing and terminate the worker. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = null;
  }
}

function topoSort(graph: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const order: string[] = [];

  function visit(node: string): void {
    if (visited.has(node)) return;
    if (onStack.has(node)) return;
    onStack.add(node);
    const deps = graph.get(node) ?? [];
    for (const d of deps) visit(d);
    onStack.delete(node);
    visited.add(node);
    order.push(node);
  }

  for (const node of graph.keys()) visit(node);
  return order;
}

function resolveLogical(name: string, files: Record<string, string>): string | null {
  // Mirror `resolveRelative` from path-utils to avoid a circular import.
  const stripped = name.replace(/^\.\//, '').replace(/^\//, '');
  if (files[stripped] !== undefined) return stripped;
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if (files[stripped + ext] !== undefined) return stripped + ext;
  }
  return null;
}

function isTransformError(err: unknown): err is TransformError & { __isTransformError: true } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { __isTransformError?: boolean }).__isTransformError === true
  );
}
