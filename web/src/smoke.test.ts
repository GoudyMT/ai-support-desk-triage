import { describe, expect, it } from 'vitest';

describe('toolchain smoke', () => {
  it('adds two numbers', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs on a Node with structuredClone', () => {
    expect(typeof structuredClone).toBe('function');
  });
});
