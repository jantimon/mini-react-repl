/**
 * Main-thread orchestration of the transform worker.
 *
 * Split in two:
 *
 *   - {@link TransformClient} owns the worker lifecycle (lazy init, ready
 *     promise) and virtual-module config. It can be prewarmed before any
 *     iframe exists; it has no per-iframe state.
 *   - {@link TransformSession} owns the files snapshot, the debounce timers,
 *     and the output sink for one iframe's lifetime. `attachSession` returns
 *     a non-null `TransformSession`, so every emission point has a real sink
 *     — no defensive null-checks, no silently swallowed errors.
 *
 * Blob URLs for module bodies are not owned here. The iframe creates
 * and revokes them inside its own context — parent-created blob URLs
 * don't load reliably across the iframe's opaque sandbox origin. The
 * `blob:` URL for the iframe document itself is owned by
 * `<ReplPreview/>` (one URL per iframe attach, revoked on detach).
 *
 * @internal
 */

import {
  initLexer,
  rewriteImports,
  ResolveError,
  VIRTUAL_KEY_PREFIX,
  type BareSpecifierResolution,
} from './import-rewriter.ts';
// Rewritten to `#create-worker` at build time (see tsup.config.ts) so server
// bundles resolve the Node stub via the package.json `imports` condition.
import { createTransformWorker } from './create-worker.ts';
import { PackageManifest, PACKAGE_JSON_PATH } from './package-manifest.ts';
import { defaultLoader } from './default-loader.ts';
import { resolveRelative } from './path-utils.ts';
import type { WorkerMessage } from './worker.ts';
import type { ModulePayload } from '../runtime/protocol.ts';
import type { Files, ReplLoader, ReplTransform } from '../types.ts';

const DEFAULT_SWC_WASM_URL = 'https://cdn.jsdelivr.net/npm/@swc/wasm-web@1.15.30/wasm_bg.wasm';
const DEFAULT_DEBOUNCE_MS = 150;

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
  /** Idle ms before transforming after the latest edit. */
  debounceMs?: number;
  /**
   * Per-file pre-processor. Defaults to {@link defaultLoader} (`.css` →
   * `<style>`, `.tsx`/`.ts`/`.jsx`/`.js` → swc, everything else → ignored).
   * A custom loader fully replaces the default — delegate to `defaultLoader`
   * for files you don't want to handle.
   */
  loader?: ReplLoader;
  /**
   * Inline virtual modules: `Record<alias, source>`. Each entry is compiled
   * with swc (TSX) and emitted as a `ModulePayload` with a synthetic key
   * (`VIRTUAL_KEY_PREFIX + alias`). User code that imports the alias gets
   * the literal specifier substituted for the virtual's blob URL by the
   * iframe runtime — same mechanism as relative imports.
   */
  virtualModules?: Record<string, string>;
  /**
   * Hook for errors raised before a session is attached (worker init /
   * prewarm). Defaults to throwing — pass an explicit handler if you want
   * fire-and-forget prewarming (e.g. `() => {}` to drop, or a logger).
   * Session-time errors are routed through {@link SessionHandlers.onError}.
   */
  onWorkerError?: (err: Error) => void;
};

/**
 * Per-iframe output sink. Attached via {@link TransformClient.attachSession}
 * for the lifetime of a single iframe boot; detached when the iframe
 * unmounts. The client itself outlives any individual session — the worker
 * + wasm are reusable across attaches.
 */
export type SessionHandlers = {
  /** Called when a module is ready for the iframe. */
  onModule: (mod: ModulePayload) => void;
  /** Called when a CSS file's content changes. */
  onCssUpsert: (path: string, css: string) => void;
  /** Called when a CSS file is removed. */
  onCssRemove: (path: string) => void;
  /** Called when a transform or resolve fails. */
  onError: (err: TransformError) => void;
};

/** Owns the worker; emits to whatever session is currently attached. */
export class TransformClient {
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    { path: string; resolve: (code: string) => void; reject: (err: unknown) => void }
  >();
  private disposed = false;
  private currentSession: TransformSession | null = null;
  /** Virtual modules: alias → source. Snapshotted at construction. */
  readonly virtualSources: Record<string, string>;
  readonly virtualAliases: ReadonlySet<string>;

  constructor(readonly opts: TransformClientOptions) {
    this.virtualSources = opts.virtualModules ?? {};
    this.virtualAliases = new Set(Object.keys(this.virtualSources));
  }

  /**
   * Eagerly download swc-wasm + worker JS. Lets callers overlap the worker
   * boot with other work — `<ReplPreview/>` calls it as soon as the iframe
   * mounts so wasm downloads in parallel with vendor / runtime fetching.
   *
   * Errors route to {@link TransformClientOptions.onWorkerError} when set,
   * or reject the returned promise when not. **Do not fire-and-forget
   * without one of these — an unhandled rejection will surface in dev and
   * be silently lost in production.**
   *
   * @example With onWorkerError (recommended for fire-and-forget):
   * ```ts
   * const client = new TransformClient({
   *   onWorkerError: (err) => reportToSentry(err),
   * });
   * void client.prewarm(); // safe — errors flow through onWorkerError
   * ```
   *
   * @example Without onWorkerError:
   * ```ts
   * await client.prewarm().catch((err) => reportToSentry(err));
   * ```
   */
  prewarm(): Promise<void> {
    return this.ensureWorker().catch((err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      if (this.opts.onWorkerError) {
        this.opts.onWorkerError(e);
        return;
      }
      throw e;
    });
  }

  /**
   * Attach a session for one iframe lifetime. Returns a non-null
   * {@link TransformSession} the caller drives with `setFiles()` and tears
   * down with `detach()`. Detach is keyed to the returned instance, so it's
   * safe to call from cleanup even if a newer session has already attached.
   *
   * If a previous session is still attached, it is detached first. This
   * preserves the invariant that at most one session is live and prevents
   * orphaned timers from continuing to fire emissions to a dangling sink.
   */
  attachSession(handlers: SessionHandlers, resolution?: BareSpecifierResolution): TransformSession {
    this.currentSession?.detach();
    const session = new TransformSession(this, handlers, resolution);
    this.currentSession = session;
    return session;
  }

  /** Stop processing and terminate the worker. */
  dispose(): void {
    this.disposed = true;
    this.currentSession?.detach();
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = null;
  }

  // --- internals shared with TransformSession ---

  /** @internal */
  isDisposed(): boolean {
    return this.disposed;
  }

  /** @internal */
  releaseSession(session: TransformSession): void {
    if (this.currentSession === session) this.currentSession = null;
  }

  /** @internal */
  runTransform(path: string, source: string, tsx?: boolean): Promise<string> {
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
        tsx,
      });
    });
  }

  /** @internal */
  ensureWorker(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    this.workerReady = new Promise<void>((resolve, reject) => {
      const worker = createTransformWorker();
      const wasmUrl = this.opts.swcWasmUrl ?? DEFAULT_SWC_WASM_URL;
      this.worker = worker;

      let initSent = false;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        switch (msg.kind) {
          case 'worker-loaded':
            if (!initSent) {
              initSent = true;
              const id = ++this.requestId;
              worker.postMessage({ kind: 'init', id, wasmUrl });
            }
            return;
          case 'init-ok':
            return resolve();
          case 'init-err':
            return reject(new Error(`swc-wasm init failed: ${msg.message}`));
          case 'transform-ok':
          case 'transform-err':
            this.handleTransformResponse(msg);
            return;
          default:
            ((kind: never) => kind)(msg);
        }
      };
      worker.onerror = (err) => {
        reject(new Error(`worker error: ${err.message ?? 'unknown'}`));
      };
    });
    return this.workerReady;
  }

  private handleTransformResponse(
    msg: Extract<WorkerMessage, { kind: 'transform-ok' | 'transform-err' }>,
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
        loc: msg.loc,
      };
      pending.reject(err);
    }
  }
}

/** Per-iframe driver. Detach-then-throw is the contract: detach() makes all subsequent calls no-ops. */
export class TransformSession {
  private files: Files = {};
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private latestSource = new Map<string, string>();
  /** Paths currently injected as CSS so removals can pick the right teardown. */
  private cssPaths = new Set<string>();
  private detached = false;
  private bootStarted = false;
  /** Caches the parse of the REPL's `package.json` across the session's rewrites. */
  private readonly manifest = new PackageManifest();

  constructor(
    private readonly client: TransformClient,
    private readonly handlers: SessionHandlers,
    // Bare-specifier resolution travels with the session, not the client: the
    // vendor keys derive from the resolved import map, which only lands by the
    // time an iframe attaches — whereas the client is constructed (and
    // prewarmed) earlier, before the import map may have resolved.
    private readonly resolution?: BareSpecifierResolution,
  ) {}

  /**
   * The bare-specifier resolution for the *current* file snapshot. The base
   * (vendor keys + resolver) is fixed at attach time, but `declaredVersions`
   * is re-read from `package.json` each rewrite — its content, and so the URLs
   * the resolver bakes, can change between batches. The manifest caches the
   * parse, so this stays cheap when nothing relevant changed.
   */
  private resolutionFor(): BareSpecifierResolution | undefined {
    const resolution = this.resolution;
    if (!resolution) return undefined;
    if (!resolution.cdn) return resolution;
    return {
      ...resolution,
      declaredVersions: this.manifest.dependencies(this.files[PACKAGE_JSON_PATH]),
    };
  }

  /**
   * Apply a new file snapshot.
   *
   * - **First call (cold boot)**: compiles every file, emits in topological
   *   order, awaits the worker round-trips so the consumer can batch them
   *   into a single `boot` postMessage. Resolves when emission is complete.
   * - **Subsequent calls**: diffs against the previous snapshot. Changed and
   *   new files schedule debounced transforms; removals fire immediately
   *   (CSS removals via `onCssRemove`; modules drop pending work and queue
   *   a re-resolve pass for dependents). Resolves immediately — the
   *   schedule, not the work, is what the consumer awaits here.
   */
  async setFiles(next: Files): Promise<void> {
    if (this.detached || this.client.isDisposed()) return;
    if (!this.bootStarted) {
      this.bootStarted = true;
      this.files = next;
      await this.coldBoot();
      return;
    }
    this.syncDiff(next);
  }

  /** Detach this session. Subsequent `setFiles` calls become no-ops. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.client.releaseSession(this);
  }

  // --- internals ---

  private async coldBoot(): Promise<void> {
    await this.client.ensureWorker();
    await initLexer();
    if (this.detached) return;
    const loader = this.client.opts.loader ?? defaultLoader;

    // Compile virtuals (always TSX) and user files in parallel. CSS results
    // are upserted right away; modules collect for the dep-graph + topo pass.
    const mods: { path: string; code: string }[] = [];

    await Promise.all([
      ...Object.entries(this.client.virtualSources).map(async ([alias, source]) => {
        const virtualKey = VIRTUAL_KEY_PREFIX + alias;
        try {
          const code = await this.client.runTransform(virtualKey, source, true);
          mods.push({ path: virtualKey, code });
        } catch (err) {
          this.reportError(err, virtualKey);
        }
      }),
      ...Object.entries(this.files).map(async ([path, source]) => {
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
    ]);

    if (this.detached) return;

    // Discover dep graph from each module body. Bare specifiers that match a
    // virtual alias produce a topo edge so virtuals are emitted before any
    // consumer — `buildBlobUrl()` in the runtime can't substitute the alias
    // for the virtual's blob URL otherwise.
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
            const tgt = resolveRelative(name, this.files);
            if (tgt) deps.push(tgt);
          } else if (this.client.virtualAliases.has(name)) {
            deps.push(VIRTUAL_KEY_PREFIX + name);
          }
        }
        depGraph.set(m.path, deps);
      } catch {
        depGraph.set(m.path, []);
      }
    }

    const { order, cycles } = topoSort(depGraph);
    for (const cycle of cycles) {
      // Surface the cycle as a transform error on the entry node so the
      // overlay points at a real file the user can fix.
      this.handlers.onError({
        kind: 'transform',
        path: cycle[0]!,
        message: `Circular import: ${cycle.join(' → ')} → ${cycle[0]!}`,
      });
    }

    const byPath = new Map(mods.map((m) => [m.path, m]));
    for (const path of order) {
      const m = byPath.get(path);
      if (!m) continue;
      try {
        const rewritten = rewriteImports(
          path,
          m.code,
          this.files,
          this.client.virtualAliases,
          this.resolutionFor(),
        );
        this.handlers.onModule({ path, code: rewritten.code, deps: rewritten.deps });
      } catch (err) {
        this.reportError(err, path);
      }
    }
  }

  private syncDiff(next: Files): void {
    const prev = this.files;
    this.files = next;

    // Editing the manifest shifts the version pins the CDN resolver bakes into
    // module URLs (see `resolutionFor`), but the file emits no module of its
    // own (the loader skips it), so changing it alone would re-resolve nothing.
    // When a resolver is active, treat it like a structural change and
    // re-transform every module so the new pins take effect live.
    const pkgJsonChanged =
      Boolean(this.resolution?.cdn) && prev[PACKAGE_JSON_PATH] !== next[PACKAGE_JSON_PATH];

    let moduleRemoved = false;
    for (const path of Object.keys(prev)) {
      if (!(path in next)) {
        // We don't maintain a reverse-dep index, so any module removal
        // forces re-resolution across the rest of the graph.
        if (!this.cssPaths.has(path)) moduleRemoved = true;
        this.handleRemoval(path);
      }
    }

    for (const path of Object.keys(next)) {
      const newSource = next[path]!;
      if (prev[path] === newSource) continue;
      this.scheduleTransform(path, newSource);
    }

    if (moduleRemoved || pkgJsonChanged) {
      for (const path of Object.keys(next)) {
        this.scheduleTransform(path, next[path]!);
      }
    }
  }

  private scheduleTransform(path: string, source: string): void {
    this.latestSource.set(path, source);
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);
    const debounce = this.client.opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      this.timers.delete(path);
      void this.processOne(path);
    }, debounce);
    this.timers.set(path, timer);
  }

  private async processOne(path: string): Promise<void> {
    if (this.detached || this.client.isDisposed()) return;
    const source = this.latestSource.get(path);
    if (source === undefined) return;
    try {
      await this.client.ensureWorker();
      if (this.detached) return;
      const loader = this.client.opts.loader ?? defaultLoader;
      const result = await loader({ path, source, transform: this.boundTransform(path) });
      if (this.detached) return;
      if (!result) return;
      if (result.kind === 'css') {
        this.upsertCss(path, result.source);
        return;
      }
      await initLexer();
      if (this.detached) return;
      const rewritten = rewriteImports(
        path,
        result.code,
        this.files,
        this.client.virtualAliases,
        this.resolutionFor(),
      );
      if (this.detached) return;
      this.handlers.onModule({ path, code: rewritten.code, deps: rewritten.deps });
    } catch (err) {
      this.reportError(err, path);
    }
  }

  private boundTransform(path: string): ReplTransform {
    return (src, opts) => this.client.runTransform(path, src, opts?.tsx);
  }

  private upsertCss(path: string, css: string): void {
    this.cssPaths.add(path);
    this.handlers.onCssUpsert(path, css);
  }

  private removeCss(path: string): void {
    this.cssPaths.delete(path);
    this.handlers.onCssRemove(path);
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

  private reportError(err: unknown, path: string): void {
    if (this.detached) return;
    if (err instanceof ResolveError) {
      this.handlers.onError({
        kind: 'resolve',
        path: err.path,
        message: err.message,
        specifier: err.specifier,
      });
      return;
    }
    if (isTransformError(err)) {
      this.handlers.onError({
        kind: 'transform',
        path: err.path,
        message: err.message,
        loc: err.loc,
      });
      return;
    }
    this.handlers.onError({
      kind: 'transform',
      path,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Topological sort with cycle detection. Returns the dependency-first
 * order plus the cycles encountered (each as the chain of nodes from the
 * cycle entry back to itself, exclusive of the closing repeat). Cycles are
 * deduped by canonical rotation (start at the lex-smallest node), so a
 * graph with multiple back-edges into the same cycle reports it once.
 */
function topoSort(graph: Map<string, string[]>): { order: string[]; cycles: string[][] } {
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const order: string[] = [];
  const seenCycles = new Set<string>();
  const cycles: string[][] = [];

  function visit(node: string): void {
    if (visited.has(node)) return;
    if (onStack.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) {
        const cycle = stack.slice(idx);
        const canonical = canonicalRotation(cycle);
        const key = canonical.join('\n');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(canonical);
        }
      }
      return;
    }
    onStack.add(node);
    stack.push(node);
    const deps = graph.get(node) ?? [];
    for (const d of deps) visit(d);
    stack.pop();
    onStack.delete(node);
    visited.add(node);
    order.push(node);
  }

  for (const node of graph.keys()) visit(node);
  return { order, cycles };
}

function canonicalRotation(cycle: string[]): string[] {
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i]! < cycle[minIdx]!) minIdx = i;
  }
  return minIdx === 0 ? cycle : [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

function isTransformError(err: unknown): err is TransformError & { __isTransformError: true } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { __isTransformError?: boolean }).__isTransformError === true
  );
}
