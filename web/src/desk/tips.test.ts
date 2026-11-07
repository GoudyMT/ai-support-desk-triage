import { describe, expect, it } from 'vitest';
import { nextTip } from './tips';

describe('nextTip', () => {
  it('opens the tip asked for, and opening another closes the first, so a viewer never sees two boxes', () => {
    expect(nextTip(undefined, { kind: 'show', id: 'order' })).toBe('order');
    expect(nextTip('order', { kind: 'show', id: 'sure' })).toBe('sure');
  });

  it('closes a tip that is left, but not another tip that opened first (a blur arrives after the next hover)', () => {
    expect(nextTip('order', { kind: 'hide', id: 'order' })).toBeUndefined();
    expect(nextTip('sure', { kind: 'hide', id: 'order' })).toBe('sure');
    expect(nextTip(undefined, { kind: 'hide', id: 'order' })).toBeUndefined();
  });

  it('a tap opens a closed tip and a second tap on an open one closes it', () => {
    expect(nextTip(undefined, { kind: 'tap', id: 'order', wasOpen: false })).toBe('order');
    expect(nextTip('order', { kind: 'tap', id: 'order', wasOpen: true })).toBeUndefined();
  });

  it('Escape closes whichever tip is open, and does nothing when none is', () => {
    expect(nextTip('sure', { kind: 'escape' })).toBeUndefined();
    expect(nextTip(undefined, { kind: 'escape' })).toBeUndefined();
  });
});
