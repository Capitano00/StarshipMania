/**
 * Connects AgentController state to a HUD that accepts the `hudFeed` event format from
 * feature/ui (src/hud/feed.ts). Defined structurally here so this branch does not depend on
 * feature/ui. After both branches merge:
 *
 *   import {hudFeed} from './hud/feed';
 *   const bridge = connectHud(agentController, hudFeed);   // once
 *   bridge.update(sim);                                     // every frame (cheap when unchanged)
 */
import type {Simulation} from '../simulation';
import type {AgentController, Proposal} from './controller';
import type {TaskStatus} from './tasks';

type Phase = 'idle' | 'planning' | 'proposing' | 'executing' | 'completed' | 'failed' | 'recalled';
type HudEvent =
  | {type: 'agent.link'; state: 'live' | 'offline'}
  | {type: 'agent.phase'; droneId: string; phase: Phase; action?: string; reason?: string; targetId?: string}
  | {type: 'agent.suggestion'; suggestion: {id: string; droneId: string; action: string; reason: string; status: 'pending' | 'accepted' | 'dismissed' | 'recalled' | 'expired'} | null};
export interface HudSink {
  publish(event: HudEvent): void;
  onDecision(handlers: {accept: (id: string) => void; dismiss: (id: string) => void}): () => void;
}

const phaseOf: Record<TaskStatus, Phase> = {proposed: 'proposing', accepted: 'executing', executing: 'executing', completed: 'completed', failed: 'failed', recalled: 'recalled', superseded: 'idle', dismissed: 'idle'};
export const describeAction = (p: Pick<Proposal, 'resolved'>) => p.resolved.kind === 'squad'
  ? p.resolved.assignments.map(a => `${a.unit} → ${a.target}`).join(', ')
  : p.resolved.kind === 'intercept' ? `${p.resolved.unit} intercept ${p.resolved.target}` : `${p.resolved.unit} return to escort`;

export function connectHud(controller: AgentController, sink: HudSink) {
  let sim: Simulation | null = null, signature = '';
  sink.publish({type: 'agent.link', state: 'live'});
  const off = sink.onDecision({
    accept: id => { if (sim) controller.approve(id, sim); },
    dismiss: id => { if (sim) controller.dismiss(id, sim.tick); },
  });
  return {
    update(current: Simulation) {
      sim = current;
      const pending = controller.pending().at(-1) ?? null;
      const latest = new Map<string, ReturnType<AgentController['tasks']['list']>[number]>();
      for (const t of controller.tasks.list()) latest.set(t.unit, t);
      const sig = JSON.stringify([pending?.id, [...latest.values()].map(t => [t.id, t.status, t.detail])]);
      if (sig === signature) return;
      signature = sig;
      sink.publish({type: 'agent.suggestion', suggestion: pending ? {id: pending.id, droneId: pending.resolved.kind === 'squad' ? 'U1+U2' : pending.resolved.unit, action: describeAction(pending), reason: pending.reason ?? 'No reason given', status: 'pending'} : null});
      for (const [unit, t] of latest) sink.publish({type: 'agent.phase', droneId: unit, phase: phaseOf[t.status], action: t.kind === 'intercept' ? `Intercept ${t.target}` : 'Return to escort', reason: t.reason ?? undefined, targetId: t.target ?? undefined});
    },
    disconnect() { off(); sink.publish({type: 'agent.link', state: 'offline'}); },
  };
}
