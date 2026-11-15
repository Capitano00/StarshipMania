import {describe, expect, it, vi} from 'vitest';
import {OrderQueue, type OrderAssignment} from '../src/agent/order-queue';

const order = (target: OrderAssignment['target']): OrderAssignment[] => [{unit: 'U1', target}];
const queueFor = (runId = 'run-1') => {
  const queue = new OrderQueue();
  queue.reset(runId);
  return queue;
};

describe('deferred pilot orders', () => {
  it('dispatches the first feasible order by priority exactly once', () => {
    const queue = queueFor();
    const unavailable = queue.add('run-1', order('T6'), 'Await a path')!;
    const earlier = queue.add('run-1', order('T1'), 'Hold for release')!;
    const promoted = queue.add('run-1', order('T2'), 'Priority objective')!;
    expect(queue.promote(promoted.id)).toBe(true);
    expect(queue.rows().map(row => row.id)).toEqual([promoted.id, unavailable.id, earlier.id]);
    const canDispatch = (row: {id: string}) => row.id !== unavailable.id;
    const execute = vi.fn(() => true);
    expect(queue.dispatch(canDispatch, execute)?.id).toBe(promoted.id);
    expect(queue.dispatch(canDispatch, execute)?.id).toBe(earlier.id);
    expect(queue.dispatch(canDispatch, execute)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(queue.rows().map(row => row.status)).toEqual(['executed', 'waiting', 'executed']);
  });

  it('keeps rejected dispatches waiting and retires cancelled or impossible orders', () => {
    const queue = queueFor();
    const lost = queue.add('run-1', order('T1'), '')!;
    const cancelled = queue.add('run-1', order('T2'), '')!;
    const retry = queue.add('run-1', order('T3'), '')!;
    expect(queue.discardImpossible(row => row.id === lost.id)).toBe(1);
    expect(queue.cancel(cancelled.id)).toBe(true);
    expect(queue.cancel(cancelled.id)).toBe(false);
    expect(queue.promote(lost.id)).toBe(false);
    expect(queue.dispatch(() => true, () => false)).toBeNull();
    expect(queue.rows().at(-1)?.status).toBe('waiting');
    expect(queue.dispatch(() => true, () => true)?.id).toBe(retry.id);
  });

  it('bounds pending orders and resets round ownership with stable, non-repeating IDs', () => {
    const queue = queueFor();
    for (let i = 0; i < 12; i++) expect(queue.add('run-1', order('T1'), 'Pending')).not.toBeNull();
    expect(queue.add('run-1', order('T2'), 'Full')).toBeNull();
    expect(queue.cancel(queue.rows()[0].id)).toBe(true);
    const latest = queue.add('run-1', order('T2'), 'Now available')!;
    expect(queue.rows()).toHaveLength(12);
    queue.reset('run-2');
    expect(queue.rows()).toEqual([]);
    expect(queue.add('run-1', order('T1'), 'Stale')).toBeNull();
    expect(queue.add('run-2', order('T1'), 'Current')?.id).not.toBe(latest.id);
  });
});
