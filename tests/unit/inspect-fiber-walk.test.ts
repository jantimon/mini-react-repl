import { describe, it, expect } from 'vitest';
import {
  walkFibers,
  getComponentName,
  type FiberLike,
} from '../../src/inspect/picker/fiber-walk.ts';

function fiber(opts: Partial<FiberLike>): FiberLike {
  return { ...opts };
}

describe('walkFibers', () => {
  it('prefers _debugOwner over .return at every step', () => {
    // a → owner → owner-of-owner
    const top = fiber({ type: 'top' });
    const mid = fiber({ type: 'mid', _debugOwner: top });
    const bot = fiber({ type: 'bot', _debugOwner: mid });
    const seen = [...walkFibers(bot)].map((f) => f.type);
    expect(seen).toEqual(['bot', 'mid', 'top']);
  });

  it('falls back to .return when there is no _debugOwner', () => {
    const root = fiber({ type: 'root' });
    const child = fiber({ type: 'child', return: root });
    const seen = [...walkFibers(child)].map((f) => f.type);
    expect(seen).toEqual(['child', 'root']);
  });

  it('caps at maxHops to defend against cyclic data', () => {
    const a: FiberLike = {};
    const b: FiberLike = { _debugOwner: a };
    a._debugOwner = b;
    const seen = [...walkFibers(a, 5)];
    expect(seen).toHaveLength(5);
  });
});

function NamedDisplay() {}
(NamedDisplay as unknown as { displayName: string }).displayName = 'Renamed';

function Counter() {}

function ForwardRefInner() {}
(ForwardRefInner as unknown as { displayName: string }).displayName = 'Wrapped';

function MemoInner() {}

describe('getComponentName', () => {
  it('prefers displayName over name on functions', () => {
    expect(getComponentName(fiber({ type: NamedDisplay }))).toBe('Renamed');
  });

  it('falls back to function .name', () => {
    expect(getComponentName(fiber({ type: Counter }))).toBe('Counter');
  });

  it('returns null for host-string fibers', () => {
    expect(getComponentName(fiber({ type: 'div' }))).toBeNull();
    expect(getComponentName(fiber({ type: 'h1' }))).toBeNull();
  });

  it('unwraps forwardRef-style wrappers via .render', () => {
    expect(getComponentName(fiber({ type: { render: ForwardRefInner } }))).toBe('Wrapped');
  });

  it('unwraps memo-style wrappers via .type', () => {
    expect(getComponentName(fiber({ type: { type: MemoInner } }))).toBe('MemoInner');
  });

  it('reads displayName off the wrapper itself when no inner ref', () => {
    expect(getComponentName(fiber({ type: { displayName: 'Outer' } }))).toBe('Outer');
  });

  it('returns null when nothing identifiable is present', () => {
    expect(getComponentName(fiber({}))).toBeNull();
    expect(getComponentName(fiber({ type: null }))).toBeNull();
  });
});
