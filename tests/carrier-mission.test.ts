import {describe, expect, it} from 'vitest';
import {carrierLaunch, carrierRelay, carrierSpawn} from '../src/carrier-mission';
import {neutralFrame} from '../src/contracts';
import {Simulation} from '../src/simulation';

describe('Orbital Relay', () => {
  it('requires launch, defeating the guards, an uninterrupted relay capture and extraction', () => {
    const sim = new Simulation('mission-fixture', 'combat', 2, true);
    const stepAt = (position: typeof carrierSpawn, ticks = 1) => {
      sim.position = {...position};
      for (let tick = 0; tick < ticks; tick++) sim.step(neutralFrame());
    };
    expect(sim.bounds.width).toBe(72);
    expect(sim.position).toEqual(carrierSpawn);
    expect(sim.mission?.phase).toBe('launch');
    stepAt(carrierRelay);
    expect(sim.mission?.phase).toBe('launch');
    stepAt(carrierLaunch);
    expect(sim.mission?.phase).toBe('relay');
    stepAt(carrierRelay);
    expect(sim.mission?.progress).toBe(0);
    for (const turret of sim.turrets) {
      if (sim.mission?.guards.has(turret.id)) turret.health = 0;
      else turret.armed = false;
    }
    stepAt(carrierRelay, 119);
    expect(sim.mission?.phase).toBe('relay');
    stepAt(carrierLaunch);
    expect(sim.mission?.progress).toBe(0);
    stepAt(carrierRelay, 120);
    expect(sim.mission?.phase).toBe('extract');
    expect(sim.outcome).toBe('playing');
    stepAt(carrierSpawn);
    expect(sim.outcome).toBe('won');
    expect(new Simulation('retry-fixture', 'combat', 2, true).mission?.phase).toBe('launch');
  });

  it('keeps defeat and legacy arena rules valid', () => {
    const mission = new Simulation('defeat-fixture', 'combat', 2, true);
    mission.health = 0;
    mission.step(neutralFrame());
    expect(mission.outcome).toBe('lost');
    const arena = new Simulation('arena-fixture', 'combat');
    expect(arena.bounds.width).toBe(54);
    expect(arena.mission).toBeNull();
    for (const turret of arena.turrets) turret.health = 0;
    arena.step(neutralFrame());
    expect(arena.outcome).toBe('won');
  });
});
