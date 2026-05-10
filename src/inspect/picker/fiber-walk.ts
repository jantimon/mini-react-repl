/**
 * React 19 fiber walking. The picker needs three things from a host
 * element's fiber chain:
 *   1. find a host element that *has* a fiber (clicks through SVG, text
 *      nodes, etc. land on non-host targets)
 *   2. yield every fiber up the owner / return chain so we can pull every
 *      `_debugStack` Error along the way
 *   3. read the component name off whichever fiber a frame came from
 *
 * Everything in here treats fibers as opaque structurally-typed objects.
 * No imports from React internals — those don't ship to the iframe.
 *
 * @internal
 */

/** Minimal shape we read off a React fiber. */
export type FiberLike = {
  type?: unknown;
  return?: FiberLike | null;
  _debugOwner?: FiberLike | null;
  _debugStack?: { stack?: string } | null;
};

/**
 * Walk DOM ancestors until we find an element that has a `__reactFiber$…`
 * key. Returns `null` if no ancestor is fiber-bearing (e.g. user clicked
 * the iframe body margin).
 */
export function findHostElementWithFiber(start: Node | null): Element | null {
  let cur: Node | null = start;
  while (cur) {
    if (cur instanceof Element && getFiberFromElement(cur)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** Read the `__reactFiber$…` key off an element, if any. */
export function getFiberFromElement(el: Element): FiberLike | null {
  for (const key in el) {
    if (key.startsWith('__reactFiber$')) {
      return (el as unknown as Record<string, FiberLike | undefined>)[key] ?? null;
    }
  }
  return null;
}

/**
 * Yield each fiber in the chain, starting at `start` and following
 * `_debugOwner` first (the JSX call-site author) and then `.return` (the
 * React parent). Bounded at `maxHops` to avoid pathological cycles.
 */
export function* walkFibers(start: FiberLike, maxHops = 32): Generator<FiberLike> {
  let f: FiberLike | null = start;
  let hops = 0;
  while (f && hops < maxHops) {
    yield f;
    f = f._debugOwner ?? f.return ?? null;
    hops++;
  }
}

/**
 * Best-effort component name for a fiber. `null` for host fibers (`'div'`,
 * `'h1'`) and for anonymous functions where neither `displayName` nor
 * `name` is set.
 */
export function getComponentName(fiber: FiberLike): string | null {
  const t = fiber.type;
  if (typeof t === 'function') {
    const fn = t as { displayName?: string; name?: string };
    return fn.displayName ?? fn.name ?? null;
  }
  if (typeof t === 'object' && t !== null) {
    // `forwardRef`, `memo`, etc. wrap the component — try the inner ref.
    const wrapper = t as { displayName?: string; render?: unknown; type?: unknown };
    const inner = wrapper.render ?? wrapper.type;
    if (typeof inner === 'function') {
      const fn = inner as { displayName?: string; name?: string };
      return fn.displayName ?? fn.name ?? null;
    }
    if (typeof wrapper.displayName === 'string') return wrapper.displayName;
  }
  return null;
}
