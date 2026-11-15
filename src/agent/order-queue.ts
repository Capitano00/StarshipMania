import {targetIds, type TargetId} from '../contracts';

export type OrderAssignment = {unit: 'U1' | 'U2'; target: TargetId};
export type OrderRow = {
  id: string;
  priority: number;
  status: 'waiting' | 'executed' | 'cancelled';
  assignments: OrderAssignment[];
  reason: string;
};

const capacity = 12;

export class OrderQueue {
  private runId = '';
  private sequence = 0;
  private entries: OrderRow[] = [];
  private dispatching = false;

  add(runId: string, assignments: readonly OrderAssignment[], reason: string): OrderRow | null {
    if (!runId || runId !== this.runId || assignments.length < 1 || assignments.length > 2 ||
        assignments.some(({unit, target}) => !['U1', 'U2'].includes(unit) || !targetIds.includes(target)) ||
        new Set(assignments.map(({unit}) => unit)).size !== assignments.length) return null;

    if (this.entries.length === capacity) {
      // Terminal rows may leave the visible history. Pending pilot orders are never silently evicted.
      const terminal = this.entries.findIndex(entry => entry.status !== 'waiting');
      if (terminal < 0) return null;
      this.entries.splice(terminal, 1);
    }

    const entry: OrderRow = {
      id: `order-${++this.sequence}`,
      priority: this.entries.length + 1,
      status: 'waiting',
      assignments: assignments.map(assignment => ({...assignment})),
      reason: reason.trim().slice(0, 160),
    };
    this.entries.push(entry);
    this.updatePriorities();
    return structuredClone(entry);
  }

  promote(id: string): boolean {
    const index = this.entries.findIndex(entry => entry.id === id && entry.status === 'waiting');
    if (index < 0) return false;
    const [entry] = this.entries.splice(index, 1);
    this.entries.unshift(entry);
    this.updatePriorities();
    return true;
  }

  cancel(id: string): boolean {
    const entry = this.entries.find(entry => entry.id === id && entry.status === 'waiting');
    if (!entry) return false;
    entry.status = 'cancelled';
    return true;
  }

  discardImpossible(isImpossible: (order: OrderRow) => boolean): number {
    let cancelled = 0;
    for (const entry of this.entries) {
      if (entry.status === 'waiting' && isImpossible(structuredClone(entry))) {
        entry.status = 'cancelled';
        cancelled++;
      }
    }
    return cancelled;
  }

  reset(runId: string): void {
    this.runId = runId;
    this.entries = [];
  }

  rows(): OrderRow[] {
    return structuredClone(this.entries);
  }

  dispatch(canDispatch: (order: OrderRow) => boolean, execute: (order: OrderRow) => boolean): OrderRow | null {
    if (this.dispatching) return null;
    this.dispatching = true;
    try {
      const entry = this.entries.find(row => row.status === 'waiting' && canDispatch(structuredClone(row)));
      if (!entry || !execute(structuredClone(entry))) return null;
      entry.status = 'executed';
      return structuredClone(entry);
    } finally {
      this.dispatching = false;
    }
  }

  private updatePriorities(): void {
    this.entries.forEach((entry, index) => { entry.priority = index + 1; });
  }
}
