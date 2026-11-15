import './order-queue.css';

type Assignment = { unit: 'U1' | 'U2'; target: string };

export interface OrderQueueRow {
  id: string;
  priority: number;
  status: 'waiting' | 'executed' | 'cancelled';
  assignments: readonly Assignment[];
  reason: string;
}

export interface OrderQueuePending {
  id: string;
  title: string;
  assignments?: readonly { unit: string; target: string }[];
  reason: string;
  currentTask?: string;
  confirmLabel?: string;
  canConfirm?: boolean;
  deferLabel?: string;
}

export interface OrderQueueHandlers {
  promote(id: string): void;
  cancel(id: string): void;
  confirm(): void;
  dismiss(): void;
  defer?(): void;
}

type QueueAction = 'promote' | 'cancel';
type Confirmation = { id: string; action: QueueAction };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function describeAssignments(assignments: readonly { unit: string; target: string }[]) {
  return assignments.map(({ unit, target }) => `${unit} → ${target}`).join(' · ');
}

/** Shows the game-owned queue and emits only explicit pilot choices. */
export function installOrderQueueHud(container: HTMLElement, handlers: OrderQueueHandlers) {
  const panel = element('details');
  panel.className = 'order-queue';
  panel.id = 'order-queue';
  panel.open = true;
  const summary = element('summary');
  const heading = element('strong', 'Order queue');
  const count = element('span');
  count.className = 'order-queue-count';
  count.setAttribute('role', 'status');
  summary.append(heading, count);

  const body = element('div');
  body.className = 'order-queue-body';
  const pendingCard = element('section');
  pendingCard.className = 'order-queue-pending';
  pendingCard.setAttribute('aria-label', 'Pilot confirmation');
  pendingCard.hidden = true;
  const rowsList = element('ol');
  rowsList.className = 'order-queue-rows';
  rowsList.setAttribute('aria-label', 'Queued orders');
  const empty = element('p', 'No orders this round.');
  empty.className = 'order-queue-detail';
  body.append(pendingCard, rowsList, empty);
  panel.append(summary, body);
  container.append(panel);

  let rows: readonly OrderQueueRow[] = [];
  let confirmation: Confirmation | undefined;
  let rowsKey = '';
  let pendingKey = '';
  let previousPendingId: string | undefined;

  function actionButton(label: string, handle: () => void, description?: string) {
    const button = element('button', label);
    button.type = 'button';
    if (description) button.setAttribute('aria-label', description);
    button.addEventListener('click', handle);
    return button;
  }

  function beginConfirmation(id: string, action: QueueAction) {
    confirmation = { id, action };
    renderRows()?.focus();
  }

  function renderRows(): HTMLButtonElement | undefined {
    let confirmButton: HTMLButtonElement | undefined;
    rowsList.replaceChildren(...rows.map(row => {
      const entry = element('li');
      entry.dataset.status = row.status;
      entry.dataset.orderId = row.id;
      const meta = element('div');
      meta.className = 'order-queue-meta';
      const status = row.status[0].toUpperCase() + row.status.slice(1);
      meta.append(element('strong', row.id), element('span', row.status === 'waiting' ? `Priority ${row.priority} · ${status}` : status));
      const targets = element('p', describeAssignments(row.assignments));
      targets.className = 'order-queue-targets';
      const reason = element('p', row.reason);
      reason.className = 'order-queue-detail';
      entry.append(meta, targets, reason);

      if (row.status !== 'waiting') return entry;
      const actions = element('div');
      actions.className = 'order-queue-actions';
      const pending = confirmation?.id === row.id ? confirmation : undefined;
      if (pending) {
        const verb = pending.action === 'promote' ? 'Promote' : 'Cancel';
        const prompt = element('p', `${verb} ${row.id}?`);
        prompt.className = 'order-queue-detail';
        actions.append(prompt);
        confirmButton = actionButton(`Confirm ${verb.toLowerCase()}`, () => {
          if (confirmation !== pending) return;
          confirmation = undefined;
          renderRows();
          handlers[pending.action](row.id);
          summary.focus();
        });
        actions.append(confirmButton, actionButton('Back', () => {
          confirmation = undefined;
          renderRows();
          summary.focus();
        }));
      } else {
        actions.append(
          actionButton('Promote', () => beginConfirmation(row.id, 'promote'), `Promote ${row.id}`),
          actionButton('Cancel', () => beginConfirmation(row.id, 'cancel'), `Cancel ${row.id}`),
        );
      }
      entry.append(actions);
      return entry;
    }));
    empty.hidden = rows.length > 0;
    return confirmButton;
  }

  function render(nextRows: readonly OrderQueueRow[], pending?: OrderQueuePending | null) {
    const nextRowsKey = JSON.stringify(nextRows);
    if (nextRowsKey !== rowsKey) {
      rows = nextRows;
      rowsKey = nextRowsKey;
      if (!rows.some(row => row.id === confirmation?.id && row.status === 'waiting')) confirmation = undefined;
      const nextCount = `${rows.filter(row => row.status === 'waiting').length} waiting`;
      if (count.textContent !== nextCount) count.textContent = nextCount;
      renderRows();
    }

    const nextPendingKey = JSON.stringify(pending ?? null);
    if (nextPendingKey === pendingKey) return;
    pendingKey = nextPendingKey;
    pendingCard.hidden = !pending;
    pendingCard.replaceChildren();
    if (!pending) {
      previousPendingId = undefined;
      return;
    }

    if (pending.id !== previousPendingId) panel.open = true;
    previousPendingId = pending.id;
    const title = element('strong', pending.title);
    title.className = 'order-queue-approval-title';
    pendingCard.append(title);
    if (pending.assignments?.length) pendingCard.append(element('p', describeAssignments(pending.assignments)));
    if (pending.currentTask) pendingCard.append(element('p', pending.currentTask));
    pendingCard.append(element('p', pending.reason));
    const actions = element('div');
    actions.className = 'order-queue-actions';
    if (pending.canConfirm !== false) actions.append(actionButton(pending.confirmLabel ?? 'Confirm', handlers.confirm));
    if (pending.deferLabel && handlers.defer) actions.append(actionButton(pending.deferLabel, handlers.defer));
    actions.append(actionButton('Dismiss', handlers.dismiss));
    pendingCard.append(actions);
  }

  render([]);
  return { render };
}
