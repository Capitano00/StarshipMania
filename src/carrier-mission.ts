import type {TargetId, Vec2} from './contracts';
import {length, type Barrier} from './cover';

export type MissionPhase = 'launch' | 'relay' | 'extract' | 'complete';
export const carrierCueColors = {launch:'#75f3d7', relay:'#d0b3ff', extract:'#ffd184', complete:'#ffd184'};
export const carrierRadii = {launch:4, relay:3.5, extract:4, complete:0};
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

  navigation(position: Vec2): string {
    const waypoint = this.waypoint;
    if (!waypoint) return '';
    const x = waypoint.x - position.x, y = waypoint.y - position.y;
    const distance = Math.round(Math.hypot(x, y));
    if (distance <= 2) return 'Beacon here';
    const headings = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const sector = (Math.round(Math.atan2(x, -y) / (Math.PI / 4)) + 8) % 8;
    return `${distance} units ${headings[sector]}`;
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
    if (this.phase === 'launch' && length(position, carrierLaunch) <= carrierRadii.launch) {
      this.phase = 'relay';
    } else if (this.phase === 'relay') {
      this.progress = guardsRemaining === 0 && length(position, carrierRelay) <= carrierRadii.relay
        ? this.progress + 1 : 0;
      if (this.progress >= captureTicks) this.phase = 'extract';
    } else if (this.phase === 'extract' && length(position, carrierSpawn) <= carrierRadii.extract) {
      this.phase = 'complete';
    }
  }
}
