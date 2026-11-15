import type {TargetId, Vec2} from './contracts';
import {length, type Barrier} from './cover';

type MissionPhase = 'launch' | 'relay' | 'extract' | 'complete';
export const carrierLaunch = {x:0, y:16};
export const carrierRelay = {x:0, y:-21};
export const carrierSpawn = {x:0, y:30};
export const carrierBarriers: readonly Barrier[] = [
  {id:'B1', minX:-13, maxX:-4, minY:6, maxY:8, height:2.4},
  {id:'B2', minX:-16, maxX:-9, minY:-6, maxY:-4, height:2.1},
  {id:'B3', minX:-8, maxX:-3, minY:-14, maxY:-12, height:2.4},
  {id:'B4', minX:9, maxX:18, minY:-1, maxY:1, height:2.1},
];

const captureTicks = 120;
export class CarrierMission {
  phase: MissionPhase = 'launch';
  progress = 0;
  readonly guards: ReadonlySet<TargetId> = new Set(['T1', 'T3']);

  get waypoint(): Vec2 | null {
    switch (this.phase) {
      case 'launch': return carrierLaunch;
      case 'relay': return carrierRelay;
      case 'extract': return carrierSpawn;
      case 'complete': return null;
    }
  }

  objective(guardsRemaining: number): string {
    switch (this.phase) {
      case 'launch': return 'Launch · reach the deck beacon';
      case 'relay': return guardsRemaining
        ? 'Relay · disable guards T1 and T3'
        : this.progress ? 'Relay · securing ' + Math.floor(this.progress / captureTicks * 100) + '%'
          : 'Relay · enter the beacon and stay for two seconds';
      case 'extract': return 'Extract · return to the carrier bay';
      case 'complete': return 'Relay recovered · extraction complete';
    }
  }

  advance(position: Vec2, guardsRemaining: number) {
    if (this.phase === 'launch' && length(position, carrierLaunch) <= 4) {
      this.phase = 'relay';
    } else if (this.phase === 'relay') {
      this.progress = guardsRemaining === 0 && length(position, carrierRelay) <= 3.5
        ? this.progress + 1 : 0;
      if (this.progress >= captureTicks) this.phase = 'extract';
    } else if (this.phase === 'extract' && length(position, carrierSpawn) <= 4) {
      this.phase = 'complete';
    }
  }
}
