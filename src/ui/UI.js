import { SKINS, CHALLENGES } from '../systems/ProgressionSystem.js';
import { formatInt } from './HUD.js';

const CAUSE_TEXT = {
  obstacle: 'Wiped out',
  fell: 'Lost to the void',
};

/** Set "<number><small>unit</small>" without innerHTML. */
function setValueWithUnit(el, number, unit) {
  el.textContent = number;
  const small = el.ownerDocument.createElement('small');
  small.textContent = unit;
  el.appendChild(small);
}

/**
 * DOM overlays (menus, pause, game over, HUD buttons).
 * Updated only on state transitions — never per frame.
 */
export class UI {
  /**
   * @param {Document} doc
   * @param {Record<string, Function>} on handlers: play, resume, restart, menu, pause, mute, skin, setting
   */
  constructor(doc, on) {
    this.doc = doc;
    this.on = on;
    const $ = (id) => doc.getElementById(id);
    this.el = {
      screens: {
        loading: $('screen-loading'),
        menu: $('screen-menu'),
        pause: $('screen-pause'),
        over: $('screen-over'),
      },
      hudControls: $('hud-controls'),
      jump: $('btn-jump'),
      mute: $('btn-mute'),
      menuBest: $('menu-best'),
      menuBestDist: $('menu-best-dist'),
      menuRuns: $('menu-runs'),
      challenges: $('menu-challenges'),
      skins: $('menu-skins'),
      skinProgress: $('skin-progress'),
      setSound: $('set-sound'),
      setEffects: $('set-effects'),
      setGhost: $('set-ghost'),
      overCause: $('over-cause'),
      overRecord: $('over-record'),
      overScore: $('over-score'),
      overDistance: $('over-distance'),
      overOrbs: $('over-orbs'),
      overPrecision: $('over-precision'),
      overStreak: $('over-streak'),
      overGates: $('over-gates'),
      overBest: $('over-best'),
      overExtra: $('over-extra'),
      restart: $('btn-restart'),
      play: $('btn-play'),
      resume: $('btn-resume'),
    };
    this.current = 'loading';
    this.bind();
  }

  bind() {
    const click = (id, fn) => {
      const el = this.doc.getElementById(id);
      if (el) el.addEventListener('click', (e) => {
        e.preventDefault();
        fn();
      });
    };
    click('btn-play', () => this.on.play());
    click('btn-resume', () => this.on.resume());
    click('btn-pause-restart', () => this.on.restart());
    click('btn-pause-menu', () => this.on.menu());
    click('btn-restart', () => this.on.restart());
    click('btn-over-menu', () => this.on.menu());
    click('btn-pause', () => this.on.pause());
    click('btn-mute', () => this.on.mute());
    this.el.setSound.addEventListener('change', () => this.on.setting('muted', !this.el.setSound.checked));
    this.el.setEffects.addEventListener('change', () => this.on.setting('reducedEffects', this.el.setEffects.checked));
    this.el.setGhost.addEventListener('change', () => this.on.setting('ghost', this.el.setGhost.checked));
    this.el.skins.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-skin]');
      if (btn && !btn.disabled) this.on.skin(btn.dataset.skin);
    });
  }

  /** Show one overlay screen (or none during gameplay). */
  show(name) {
    for (const [key, el] of Object.entries(this.el.screens)) el.classList.toggle('visible', key === name);
    this.current = name;
    const playing = name === null;
    this.el.hudControls.hidden = !playing;
    this.el.jump.hidden = !(playing && this.touch);
    // Never auto-focus buttons: a key held through a crash would otherwise
    // auto-repeat onto "Run again". Enter/Space are handled by the game's
    // non-repeating 'confirm' action; Tab still reaches every button.
    const active = this.doc.activeElement;
    if (active && active !== this.doc.body && active.blur) active.blur();
  }

  setTouchMode(on) {
    if (this.touch === on) return;
    this.touch = on;
    this.doc.body.classList.toggle('touch', on);
    this.el.jump.hidden = !(on && this.current === null);
  }

  setMuted(muted) {
    this.el.mute.setAttribute('aria-pressed', String(muted));
    this.el.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.el.setSound.checked = !muted;
  }

  /** @param {import('../systems/ProgressionSystem.js').ProgressionSystem} prog */
  renderMenu(prog) {
    const d = prog.data;
    this.el.menuBest.textContent = formatInt(d.bestScore);
    setValueWithUnit(this.el.menuBestDist, formatInt(d.bestDistance), 'm');
    this.el.menuRuns.textContent = `Run #${formatInt(d.totalRuns + 1)}`;

    const active = prog.activeChallenges();
    const ul = this.el.challenges;
    ul.textContent = '';
    if (!active.length) {
      const li = this.doc.createElement('li');
      li.className = 'done';
      li.textContent = 'All missions complete. Chase your best.';
      ul.appendChild(li);
    }
    for (const c of active) {
      const li = this.doc.createElement('li');
      li.textContent = c.label;
      ul.appendChild(li);
    }

    const done = prog.completedCount;
    this.el.skinProgress.textContent = `${done}/${CHALLENGES.length}`;
    const box = this.el.skins;
    box.textContent = '';
    for (const s of SKINS) {
      const unlocked = prog.isSkinUnlocked(s.id);
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'skin';
      b.dataset.skin = s.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(prog.skin.id === s.id));
      b.setAttribute('aria-label', unlocked ? s.name : `${s.name} (complete ${s.need} challenges to unlock)`);
      b.title = unlocked ? s.name : `Complete ${s.need} challenges`;
      b.disabled = !unlocked;
      const ball = this.doc.createElement('span');
      ball.className = 'ball';
      ball.style.background =
        s.glow === 'prism'
          ? 'conic-gradient(#ff2e88, #ffc23d, #7dff5a, #22e4ff, #a77bff, #ff2e88)'
          : `linear-gradient(135deg, ${s.core} 0%, ${s.glow} 70%)`;
      ball.style.boxShadow = s.glow === 'prism' ? '0 0 12px #fff6' : `0 0 14px ${s.glow}88`;
      b.appendChild(ball);
      if (!unlocked) {
        const need = this.doc.createElement('span');
        need.className = 'need';
        need.textContent = String(s.need);
        b.appendChild(need);
      }
      box.appendChild(b);
    }

    const st = prog.settings;
    this.el.setSound.checked = !st.muted;
    this.el.setEffects.checked = st.reducedEffects;
    this.el.setGhost.checked = st.ghost;
    this.setMuted(st.muted);
  }

  /**
   * @param {ReturnType<import('../systems/ScoreSystem.js').ScoreSystem['summary']>} s
   * @param {{newBest:boolean,newBestDistance:boolean}} result
   */
  renderGameOver(s, result, best, cause, extras) {
    this.el.overCause.textContent = CAUSE_TEXT[cause] || 'Run over';
    this.el.overRecord.hidden = !result.newBest;
    this.el.overRecord.textContent = result.newBest ? 'New record' : '';
    this.el.overScore.textContent = formatInt(s.score);
    setValueWithUnit(this.el.overDistance, formatInt(s.distance), 'm');
    this.el.overOrbs.textContent = formatInt(s.orbs);
    this.el.overPrecision.textContent = s.gatesTotal ? `${s.precision}%` : '–';
    this.el.overStreak.textContent = formatInt(s.bestStreak);
    this.el.overGates.textContent = `${s.gatesPassed}/${s.gatesTotal}`;
    this.el.overBest.textContent = formatInt(best);
    this.el.overExtra.textContent = extras;
  }
}
