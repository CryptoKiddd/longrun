/**
 * Translates raw keyboard/pointer events into game intents.
 * Independent of rendering and of game state: the Game decides what each
 * action means in the current state.
 *
 * Intents:
 *   steer            -1..1 (analog for touch, digital for keys)
 *   consumeJump()    true once per physical jump press (no key-repeat)
 * Actions (edge events via onAction): 'jump' | 'confirm' | 'pause' | 'mute' | 'blur'
 *
 * Simultaneous left+right keys: the most recently pressed direction wins.
 */
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const JUMP = ['Space', 'ArrowUp', 'KeyW'];
const PAUSE = ['Escape', 'KeyP'];
const CONFIRM = ['Enter', 'NumpadEnter', 'Space'];
const MUTE = ['KeyM'];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...JUMP, ...PAUSE, ...CONFIRM, ...MUTE]);

function isInteractiveTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export class InputManager {
  /**
   * @param {{ keyTarget?: EventTarget, surface?: HTMLElement|null, jumpButton?: HTMLElement|null, doc?: Document|null, win?: Window|null }} opts
   */
  constructor({ keyTarget = null, surface = null, jumpButton = null, doc = null, win = null } = {}) {
    this.keyTarget = keyTarget;
    this.surface = surface;
    this.jumpButton = jumpButton;
    this.doc = doc;
    this.win = win;

    this.held = new Set();
    this.lastDir = 0;
    this.jumpPresses = 0;
    this.touchAxis = 0;
    this.steerPointer = null; // { id, anchorX, startY, startT, swiped }
    this.usingTouch = false;
    this.listeners = [];
    this.bound = [];
  }

  onAction(fn) {
    this.listeners.push(fn);
  }

  emit(action) {
    for (const fn of this.listeners) fn(action);
  }

  /** Current steering input in [-1, 1]. Touch steering overrides keys while active. */
  get steer() {
    if (this.steerPointer) return this.touchAxis;
    const l = LEFT.some((c) => this.held.has(c));
    const r = RIGHT.some((c) => this.held.has(c));
    if (l && r) return this.lastDir;
    if (l) return -1;
    if (r) return 1;
    return 0;
  }

  /** @returns {boolean} true if a jump was pressed since the last call */
  consumeJump() {
    const pressed = this.jumpPresses > 0;
    this.jumpPresses = 0;
    return pressed;
  }

  /** Forget queued presses (e.g. the Space that started a run). */
  clearPresses() {
    this.jumpPresses = 0;
  }

  /** Release everything: used on blur, visibility loss, and run transitions. */
  clear() {
    this.held.clear();
    this.lastDir = 0;
    this.jumpPresses = 0;
    this.touchAxis = 0;
    this.steerPointer = null;
  }

  // ---- keyboard -------------------------------------------------------

  handleKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!GAME_KEYS.has(e.code)) return;
    if (isInteractiveTarget(e.target)) return; // let buttons/forms behave natively
    e.preventDefault();
    if (LEFT.includes(e.code)) this.lastDir = -1;
    if (RIGHT.includes(e.code)) this.lastDir = 1;
    this.held.add(e.code);
    if (e.repeat) return;
    if (JUMP.includes(e.code)) {
      this.jumpPresses++;
      this.emit('jump');
    }
    if (CONFIRM.includes(e.code)) this.emit('confirm');
    if (PAUSE.includes(e.code)) this.emit('pause');
    if (MUTE.includes(e.code)) this.emit('mute');
  }

  handleKeyUp(e) {
    if (!this.held.has(e.code)) return;
    this.held.delete(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  }

  // ---- pointer (touch / pen / mouse drag) -----------------------------

  steerRange() {
    const w = this.surface && this.surface.clientWidth ? this.surface.clientWidth : 800;
    return Math.max(36, Math.min(110, w * 0.09));
  }

  handlePointerDown(e) {
    if (e.pointerType === 'touch') this.usingTouch = true;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (this.steerPointer) {
      // Second finger while steering = jump.
      this.jumpPresses++;
      this.emit('jump');
      return;
    }
    this.steerPointer = { id: e.pointerId, anchorX: e.clientX, startY: e.clientY, startT: e.timeStamp, swiped: false };
    this.touchAxis = 0;
    if (this.surface && this.surface.setPointerCapture) {
      try {
        this.surface.setPointerCapture(e.pointerId);
      } catch {
        /* pointer may already be gone */
      }
    }
  }

  handlePointerMove(e) {
    const sp = this.steerPointer;
    if (!sp || e.pointerId !== sp.id) return;
    e.preventDefault();
    const range = this.steerRange();
    let dx = e.clientX - sp.anchorX;
    if (Math.abs(dx) > range) {
      // Floating anchor: follow the finger so reversing direction is instant.
      sp.anchorX = e.clientX - Math.sign(dx) * range;
      dx = Math.sign(dx) * range;
    }
    this.touchAxis = Math.max(-1, Math.min(1, dx / range));
    // Quick upward swipe = jump (fires immediately, no release latency).
    const dy = e.clientY - sp.startY;
    if (!sp.swiped && dy < -range * 0.9 && e.timeStamp - sp.startT < 260) {
      sp.swiped = true;
      this.jumpPresses++;
      this.emit('jump');
    }
  }

  handlePointerEnd(e) {
    const sp = this.steerPointer;
    if (!sp || e.pointerId !== sp.id) return;
    this.steerPointer = null;
    this.touchAxis = 0;
  }

  handleJumpButton(e) {
    if (e.pointerType === 'touch') this.usingTouch = true;
    e.preventDefault();
    e.stopPropagation();
    this.jumpPresses++;
    this.emit('jump');
  }

  handleFocusLoss() {
    this.clear();
    this.emit('blur');
  }

  // ---- lifecycle --------------------------------------------------------

  listen(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    this.bound.push([target, type, fn, opts]);
  }

  attach() {
    const active = { passive: false };
    this.listen(this.keyTarget, 'keydown', (e) => this.handleKeyDown(e));
    this.listen(this.keyTarget, 'keyup', (e) => this.handleKeyUp(e));
    this.listen(this.surface, 'pointerdown', (e) => this.handlePointerDown(e), active);
    this.listen(this.surface, 'pointermove', (e) => this.handlePointerMove(e), active);
    this.listen(this.surface, 'pointerup', (e) => this.handlePointerEnd(e));
    this.listen(this.surface, 'pointercancel', (e) => this.handlePointerEnd(e));
    this.listen(this.surface, 'lostpointercapture', (e) => this.handlePointerEnd(e));
    this.listen(this.surface, 'contextmenu', (e) => e.preventDefault());
    this.listen(this.jumpButton, 'pointerdown', (e) => this.handleJumpButton(e), active);
    this.listen(this.win, 'blur', () => this.handleFocusLoss());
    this.listen(this.doc, 'visibilitychange', () => {
      if (this.doc.hidden) this.handleFocusLoss();
    });
  }

  detach() {
    for (const [target, type, fn, opts] of this.bound) target.removeEventListener(type, fn, opts);
    this.bound = [];
    this.clear();
  }
}
