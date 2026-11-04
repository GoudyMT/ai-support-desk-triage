// Learn The Process, worked out without the DOM: how long a step stays, how the engine is walked to
// the state a step talks about, the bar's labels and where the context block goes.
import type { CenterStage, Hold, Run, RunState } from '../run/engine';
import { narrate } from '../run/narrate';

export interface LearnStep {
  title: string;
  text: string;
  // Selectors of the parts of the page the hole covers together.
  lit: string[];
  // Where the engine holds the live ticket while this step is up.
  hold: Hold;
  // True once the engine is in the state the words talk about.
  ready(state: RunState): boolean;
  // The stage whose sentence about the live ticket shows under the text.
  ticketStage?: CenterStage;
  // The list tab to show on a phone.
  tab?: 'in' | 'out';
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Average silent reading rate of adult English readers, non-fiction (Brysbaert 2019).
export const WORDS_PER_MINUTE = 238;
const MS_PER_MINUTE = 60_000;
// Enough events to run past a few unflagged tickets to the first one a person must see.
const REACH_LIMIT = 600;
const GAP_PX = 16;

export function stepMs(step: LearnStep, line: string | null): number {
  const words = [step.title, step.text, line].filter((part) => part !== null).join(' ').split(' ').length;
  return (words / WORDS_PER_MINUTE) * MS_PER_MINUTE;
}

// Sets the hold and moves the run on until the live ticket is where the step's words say. A playing
// run is advanced and a paused one stepped, so Learn's Pause does not stop a walk to another step.
export function reachStep(run: Run, step: LearnStep, limit = REACH_LIMIT): boolean {
  run.hold(step.hold);
  for (let n = 0; n < limit && !step.ready(run.state()); n += 1) {
    if (run.state().playing) run.advance();
    else run.step();
  }
  return step.ready(run.state());
}

export function ticketLine(state: RunState, stage: CenterStage): string | null {
  return state.current === undefined ? null : narrate(state.current.trail, stage).plain;
}

export function barFills(at: number, share: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i < at ? 1 : i > at ? 0 : Math.min(share, 1)));
}

export function learnBarView(
  at: number,
  count: number,
  paused: boolean,
): { backDisabled: boolean; mainLabel: string; nextLabel: string; count: string } {
  return {
    backDisabled: at === 0,
    mainLabel: paused ? 'Resume' : 'Pause',
    nextLabel: at === count - 1 ? 'See The Process' : 'Next',
    count: `Step ${at + 1} of ${count}`,
  };
}

export function unionBox(boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

// The block goes to the right of the hole, else the left, below, above: the first place where all of it
// is on the screen (above the bar) and off everything in `keepClear`. With no such place it sits on the bottom edge of the room, which
// keeps it clear of the bar and covers the hole only as a last resort.
export function placeBlock(
  hole: Box,
  block: { width: number; height: number },
  view: { width: number; height: number },
  keepClear: Box[] = [],
): { left: number; top: number } {
  const maxLeft = view.width - block.width;
  const maxTop = view.height - block.height;
  const tries = [
    { left: hole.left + hole.width + GAP_PX, top: clamp(hole.top, 0, maxTop) },
    { left: hole.left - GAP_PX - block.width, top: clamp(hole.top, 0, maxTop) },
    { left: clamp(hole.left, 0, maxLeft), top: hole.top + hole.height + GAP_PX },
    { left: clamp(hole.left, 0, maxLeft), top: hole.top - GAP_PX - block.height },
  ];
  const clearOf = (at: { left: number; top: number }, other: Box): boolean =>
    at.left + block.width <= other.left ||
    other.left + other.width <= at.left ||
    at.top + block.height <= other.top ||
    other.top + other.height <= at.top;
  const fits = tries.find(
    (at) => at.left >= 0 && at.top >= 0 && at.left <= maxLeft && at.top <= maxTop && keepClear.every((other) => clearOf(at, other)),
  );
  return fits ?? { left: clamp(hole.left, 0, maxLeft), top: maxTop };
}
