export type PlayMode = 'combat' | 'training';

export const titleScreen = `
  <section id="title-screen" aria-labelledby="title-heading">
    <div class="title-content">
      <h1 id="title-heading">Starship<span>Mania</span></h1>
      <p>Pilot a mech and command two drones.</p>
      <nav aria-label="Main menu" class="title-actions">
        <button id="title-play" class="primary" type="button">Play</button>
        <button id="title-training" type="button">Training</button>
        <button id="title-settings" type="button">Settings</button>
      </nav>
    </div>
  </section>`;

export const prepareIntro = `
  <div class="prepare-intro">
    <button id="return-title" class="menu-back" type="button">← Main menu</button>
    <h1 id="prepare-heading" tabindex="-1">Prepare to play</h1>
    <p id="prepare-objective">Clear six targets and keep your mech operational.</p>
  </div>`;

export const voiceCommandGuide = `
  <details class="voice-guide">
    <summary>Voice commands</summary>
    <p>Resume the game, then select <strong>Start voice</strong> to connect your microphone to ElevenLabs. Voice is optional. The Voice tab shows what the agent heard and how the game responded.</p>
    <dl>
      <dt>“Recall drones”</dt><dd>Return both drones immediately. You can also press R.</dd>
      <dt>“Send U2 to T3”</dt><dd>Choose a specific drone and target.</dd>
      <dt>“Take the far turret”</dt><dd>Ask the drone workers to suggest an assignment. You can also ask for the near turret.</dd>
      <dt>“Send U2 to T3 when feasible”</dt><dd>Wait for a matching assignment to become possible.</dd>
      <dt>“Promote order-1” or “Cancel order-1”</dt><dd>Reprioritise or remove a waiting order. Use the ID shown in Orders.</dd>
    </dl>
    <p>Except for Recall, approve the change in <strong>Orders</strong> before it can take effect. Assignments and queue commands require a configured voice supervisor.</p>
  </details>`;
