import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameLoop } from '../src/core/GameLoop.js';
import { StateMachine, State } from '../src/core/GameState.js';
import { InputManager } from '../src/core/InputManager.js';
import { PHYSICS } from '../src/config.js';

function makeLoop(onStep) {
  const frames = [];
  const loop = new GameLoop({ fixedUpdate: onStep, frameUpdate: (dt, a) => frames.push([dt, a]), raf: null });
  return { loop, frames };
}

test('large frame deltas are clamped and catch-up steps are capped', () => {
  let steps = 0;
  const { loop } = makeLoop(() => steps++);
  const n = loop.advance(5); // 5 s hitch (e.g. a debugger pause)
  const expected = Math.floor(PHYSICS.MAX_FRAME_DT / PHYSICS.DT + 1e-9);
  assert.ok(n <= PHYSICS.MAX_STEPS_PER_FRAME);
  assert.ok(n === Math.min(expected, PHYSICS.MAX_STEPS_PER_FRAME));
  assert.ok(loop.accumulator < PHYSICS.DT);
});

test('negative/zero deltas do nothing; interpolation alpha stays in [0,1)', () => {
  let steps = 0;
  const { loop, frames } = makeLoop(() => steps++);
  loop.advance(-1);
  loop.advance(0);
  loop.advance(0.5 * PHYSICS.DT);
  assert.equal(steps, 0);
  for (const [, a] of frames) assert.ok(a >= 0 && a < 1);
});

test('resetTiming discards accumulated time (resume after pause)', () => {
  let steps = 0;
  const { loop } = makeLoop(() => steps++);
  loop.advance(PHYSICS.DT * 0.9);
  loop.resetTiming();
  loop.advance(PHYSICS.DT * 0.5);
  assert.equal(steps, 0);
});

test('state machine allows only valid transitions', () => {
  const fsm = new StateMachine();
  assert.equal(fsm.transition(State.PLAYING), false, 'cannot play before READY');
  assert.equal(fsm.transition(State.READY), true);
  assert.equal(fsm.transition(State.GAME_OVER), false);
  assert.equal(fsm.transition(State.PLAYING), true);
  assert.equal(fsm.transition(State.PAUSED), true);
  assert.equal(fsm.transition(State.GAME_OVER), false, 'paused game cannot end');
  assert.equal(fsm.transition(State.PLAYING), true);
  assert.equal(fsm.transition(State.GAME_OVER), true);
  assert.equal(fsm.transition(State.PAUSED), false);
  assert.equal(fsm.transition(State.PLAYING), true, 'restart');
});

test('gameplay does not update while paused, ready or game over', () => {
  const fsm = new StateMachine();
  let simulated = 0;
  const { loop } = makeLoop(() => {
    if (fsm.simulating) simulated++;
  });
  fsm.transition(State.READY);
  loop.advance(0.05);
  assert.equal(simulated, 0);
  fsm.transition(State.PLAYING);
  loop.advance(0.05);
  const afterPlay = simulated;
  assert.ok(afterPlay > 0);
  fsm.transition(State.PAUSED);
  loop.advance(0.05);
  assert.equal(simulated, afterPlay);
  fsm.transition(State.PLAYING);
  fsm.transition(State.GAME_OVER);
  loop.advance(0.05);
  assert.equal(simulated, afterPlay);
});

function key(code, extra = {}) {
  return { code, repeat: false, target: { tagName: 'CANVAS' }, preventDefault() {}, ...extra };
}

test('input: key repeat does not trigger multiple jumps', () => {
  const input = new InputManager();
  input.handleKeyDown(key('Space'));
  input.handleKeyDown(key('Space', { repeat: true }));
  input.handleKeyDown(key('Space', { repeat: true }));
  assert.equal(input.consumeJump(), true);
  assert.equal(input.consumeJump(), false);
});

test('input: simultaneous left+right — the most recent press wins; release restores the other', () => {
  const input = new InputManager();
  input.handleKeyDown(key('ArrowLeft'));
  assert.equal(input.steer, -1);
  input.handleKeyDown(key('ArrowRight'));
  assert.equal(input.steer, 1);
  input.handleKeyUp(key('ArrowRight'));
  assert.equal(input.steer, -1);
  input.handleKeyUp(key('ArrowLeft'));
  assert.equal(input.steer, 0);
});

test('input: blur / hidden clears held keys and emits blur', () => {
  const input = new InputManager();
  const actions = [];
  input.onAction((a) => actions.push(a));
  input.handleKeyDown(key('KeyD'));
  input.handleKeyDown(key('Space'));
  input.handleFocusLoss();
  assert.equal(input.steer, 0);
  assert.equal(input.consumeJump(), false);
  assert.ok(actions.includes('blur'));
});

test('input: modifier shortcuts and form controls are not intercepted', () => {
  const input = new InputManager();
  let prevented = false;
  input.handleKeyDown(key('KeyA', { ctrlKey: true, preventDefault: () => (prevented = true) }));
  assert.equal(prevented, false);
  assert.equal(input.steer, 0);
  input.handleKeyDown(key('Space', { target: { tagName: 'BUTTON' }, preventDefault: () => (prevented = true) }));
  assert.equal(prevented, false);
  assert.equal(input.consumeJump(), false);
});

test('input: touch drag steers analog, release and cancel reset', () => {
  const input = new InputManager({ surface: { clientWidth: 1000 } });
  const ev = (x, y = 500, id = 1, t = 0) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, timeStamp: t, button: 0, preventDefault() {} });
  input.handlePointerDown(ev(500));
  input.handlePointerMove(ev(545));
  assert.ok(input.steer > 0.4 && input.steer < 0.6);
  input.handlePointerMove(ev(800));
  assert.equal(input.steer, 1);
  // Floating anchor: moving back a little reverses quickly.
  input.handlePointerMove(ev(700));
  assert.ok(input.steer < 0);
  input.handlePointerEnd(ev(700));
  assert.equal(input.steer, 0);
  input.handlePointerDown(ev(500, 500, 2));
  input.handlePointerMove(ev(600, 500, 2));
  input.handlePointerEnd({ pointerId: 2 }); // pointercancel
  assert.equal(input.steer, 0);
});

test('input: second finger while steering is a jump', () => {
  const input = new InputManager({ surface: { clientWidth: 1000 } });
  const ev = (id) => ({ pointerId: id, pointerType: 'touch', clientX: 100, clientY: 100, timeStamp: 0, button: 0, preventDefault() {} });
  input.handlePointerDown(ev(1));
  input.handlePointerDown(ev(2));
  assert.equal(input.consumeJump(), true);
});
