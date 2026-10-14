/**
 * Explicit finite-state machine for the game's top-level flow.
 * Gameplay physics only advances in PLAYING.
 */
export const State = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
});

const TRANSITIONS = Object.freeze({
  [State.INITIALIZING]: [State.READY],
  [State.READY]: [State.PLAYING],
  [State.PLAYING]: [State.PAUSED, State.GAME_OVER],
  [State.PAUSED]: [State.PLAYING, State.READY],
  [State.GAME_OVER]: [State.PLAYING, State.READY],
});

export class StateMachine {
  constructor(initial = State.INITIALIZING) {
    this.current = initial;
    this.listeners = [];
  }

  is(state) {
    return this.current === state;
  }

  can(to) {
    return TRANSITIONS[this.current].includes(to);
  }

  /** @returns {boolean} whether the transition happened */
  transition(to) {
    if (!this.can(to)) return false;
    const from = this.current;
    this.current = to;
    for (const fn of this.listeners) fn(to, from);
    return true;
  }

  /** @param {(to: string, from: string) => void} fn */
  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Physics/gameplay simulation is permitted only while PLAYING. */
  get simulating() {
    return this.current === State.PLAYING;
  }
}
