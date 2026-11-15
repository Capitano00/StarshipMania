import type { VoiceEvent } from './voice-recall';

export function installVoiceTranscript(list: HTMLOListElement, result: HTMLElement) {
  const rows: { event: Extract<VoiceEvent, { speaker: string }>; partial: boolean }[] = [];
  let awaitingTool = false;

  function render() {
    const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    list.replaceChildren(...rows.map(({ event, partial }) => {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = event.speaker + (partial ? ' · partial' : '');
      const message = document.createElement('span');
      message.textContent = event.text;
      row.append(label, message);
      return row;
    }));
    if (follow) list.scrollTop = list.scrollHeight;
  }

  function finishWithoutTool() {
    if (!awaitingTool) return;
    awaitingTool = false;
    result.textContent = 'Game · no Recall request received';
  }

  function discardPartial() {
    finishWithoutTool();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].partial) rows.splice(i, 1);
    }
    render();
  }

  function update(event: VoiceEvent) {
    if (event.type === 'awaiting-tool') {
      awaitingTool = true;
      result.textContent = 'Game · awaiting voice tool request';
      return;
    }
    if (event.type === 'result') {
      awaitingTool = false;
      result.textContent = 'Game · ' + event.text;
      return;
    }
    if (event.type === 'interrupted') {
      discardPartial();
      return;
    }
    if (event.type === 'final' && event.speaker === 'Agent') finishWithoutTool();
    const partial = event.type === 'draft' || event.type === 'append';
    let row = rows.find(row => row.event.speaker === event.speaker && row.event.id === event.id);
    if (partial && row && !row.partial) return;
    // Some providers use a different ID when committing a tentative turn.
    if (!row && event.type !== 'correct') row = rows.find(row => row.partial && row.event.speaker === event.speaker);
    if (event.type === 'correct' && !row) return;
    const text = (event.type === 'append' && row?.event.id === event.id ? row.event.text + event.text : event.text).slice(0, 2000);
    if (row) Object.assign(row, { event: { ...event, text }, partial });
    else rows.push({ event: { ...event, text }, partial });
    if (rows.length > 24) rows.shift();
    render();
  }

  return {
    showOrderResult(outcome: string, detail: string) {
      awaitingTool = false;
      result.textContent = 'Game · ' + outcome + ' · ' + detail;
    },
    update,
    discardPartial,
    clear() {
      rows.length = 0;
      awaitingTool = false;
      result.textContent = 'Game · no voice command yet';
      render();
    },
  };
}
