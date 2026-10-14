import { TRACK } from '../config.js';
import { Player } from '../entities/Player.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { Track } from '../world/Track.js';
import { SegmentGenerator } from '../world/SegmentGenerator.js';
import { ScoreSystem } from '../systems/ScoreSystem.js';
import { GhostRecorder } from '../systems/GhostSystem.js';

/**
 * One run of the game as a pure, DOM-free model. The Game drives it with
 * fixed steps and drains `notices` to trigger audio/visual feedback.
 */
export class Simulation {
  constructor() {
    this.track = new Track();
    this.player = new Player();
    this.physics = new PhysicsWorld(this.track);
    this.generator = new SegmentGenerator(this.track);
    this.score = new ScoreSystem();
    this.ghost = new GhostRecorder();
    this.notices = [];
    this.liveStats = { orbs: 0, distance: 0, perfectGates: 0, time: 0, multiplier: 1, cleanGates: 0, score: 0 };
    this.reset(1);
  }

  /**
   * Start a clean run. Persistent records live elsewhere and are untouched.
   * @param {number} seed course seed used after the fixed opening
   * @param {Array<{id:string, check:Function}>} challenges optional goals for this run
   */
  reset(seed, challenges = []) {
    this.seed = seed;
    this.player.reset();
    this.generator.reset(seed);
    this.generator.ensureAhead(0);
    this.score.reset();
    this.ghost.reset();
    this.notices.length = 0;
    this.time = 0;
    this.over = false;
    this.crashCause = '';
    this.crashObstacle = null;
    this.pendingChallenges = challenges.slice();
    this.completedChallenges = [];
  }

  stats() {
    const s = this.liveStats;
    const sc = this.score;
    s.orbs = sc.orbs;
    s.distance = sc.distance;
    s.perfectGates = sc.perfectGates;
    s.time = this.time;
    s.multiplier = sc.bestMultiplier;
    s.cleanGates = sc.bestCleanGates;
    s.score = sc.total;
    return s;
  }

  /**
   * Advance one fixed step.
   * @param {number} dt
   * @param {{ steer: number, jump: boolean }} intent
   */
  step(dt, intent) {
    if (this.over) return null;
    const p = this.player;
    const ev = this.physics.step(p, intent, dt);
    this.time += dt;
    this.score.setDistance(p.z);

    for (const orb of ev.orbs) {
      const points = this.score.collectOrb();
      this.notices.push({ kind: 'orb', points, x: orb.x, y: orb.y + this.track.heightAt(orb.z), z: orb.z });
    }
    for (const g of ev.gates) {
      const { tier, points } = this.score.resolveGate(g.result === 'pass', g.accuracy);
      g.result = tier;
      g.flash = 1;
      this.notices.push({ kind: 'gate', tier, points, x: g.x, y: 1.6 + this.track.heightAt(g.z), z: g.z, multiplier: this.score.multiplier });
    }
    if (ev.jumped) this.notices.push({ kind: 'jump' });
    if (ev.launched) this.notices.push({ kind: 'launch' });
    if (ev.landed) this.notices.push({ kind: 'land', speed: ev.landingSpeed });
    if (ev.railHit) this.notices.push({ kind: 'rail' });

    if (this.pendingChallenges.length) this.checkChallenges();

    this.ghost.record(p.z, p.x, p.y);
    this.generator.ensureAhead(p.z);
    this.track.recycle(p.z - TRACK.KEEP_BEHIND);

    if (ev.crashed) {
      this.over = true;
      this.crashCause = ev.crashCause;
      this.crashObstacle = ev.crashObstacle;
      if (ev.crashObstacle) ev.crashObstacle.hitFlash = 1;
      this.notices.push({ kind: 'crash', cause: ev.crashCause });
    }
    return ev;
  }

  checkChallenges() {
    const s = this.stats();
    for (let i = this.pendingChallenges.length - 1; i >= 0; i--) {
      const c = this.pendingChallenges[i];
      if (c.check(s)) {
        this.pendingChallenges.splice(i, 1);
        this.completedChallenges.push(c);
        const points = this.score.addChallengeBonus();
        this.notices.push({ kind: 'challenge', challenge: c, points });
      }
    }
  }
}
