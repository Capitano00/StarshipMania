export type PlayMode = 'combat' | 'training';

const keyboardTrainingSteps = [
  '1 / 5 · Aim at T1 with the arrow keys, then hold K to deploy.',
  '2 / 5 · Hold H until a drone hits T1.',
  '3 / 5 · Release K, aim at T2, then hold K to redirect.',
  '4 / 5 · Press R to recall both drones.',
  '5 / 5 · Wait for both drones to return.',
  'Training complete · deployment, drone fire, redirection and recall confirmed.',
];

export function keyboardTrainingPrompt(step: number, autofire: boolean) {
  return autofire && step === 1 ? '2 / 5 · Wait for your assigned drones to hit T1.' : keyboardTrainingSteps[step];
}

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
      <dt>“Scout ahead”</dt><dd>Hear a read-only report of nearby threats and available drones in the Voice tab.</dd>
      <dt>“Recall U1”</dt><dd>Approve in Orders to return one drone to escort and clear its waiting orders. You can also say “Recall U2”.</dd>
      <dt>“U2, defend me”</dt><dd>Propose the nearest active armed turret for U2.</dd>
      <dt>“Send U2 to T3”</dt><dd>Choose a specific drone and target.</dd>
      <dt>“Send U1 to T1 and U2 to T3”</dt><dd>Approve both assignments together.</dd>
      <dt>“Take the far turret”</dt><dd>Ask the drone workers to suggest an assignment for a distant turret.</dd>
      <dt>“Take the near turret”</dt><dd>Ask the drone workers for a nearby turret assignment.</dd>
      <dt>“Send U2 to T3 when feasible”</dt><dd>Wait for a matching assignment to become possible.</dd>
      <dt>“Promote order-1” or “Cancel order-1”</dt><dd>Reprioritise or remove a waiting order. Use the ID shown in Orders.</dd>
    </dl>
    <p>Approve assignments, single-drone Recall and queue changes in <strong>Orders</strong>. Use the configured supervisor for these commands and Scout.</p>
  </details>`;
