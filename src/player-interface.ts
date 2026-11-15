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
    <p>Resume the arena, then select <strong>Start voice</strong> to connect your microphone to ElevenLabs. The <strong>Voice</strong> tab shows what the agent heard and how the game responded. Use <strong>Start voice</strong> again after pausing and resuming.</p>
    <dl>
      <dt>“Recall drones” or “Recall the drones”</dt><dd>Return both drones immediately during active play. You can also press R.</dd>
      <dt>“Scout ahead” or “What are my drones doing?”</dt><dd>Hear a read-only report of nearby threats and drone assignments in the Voice tab.</dd>
      <dt>“Recall U1”</dt><dd>Approve in Orders to return one drone to escort and clear its waiting orders. You can also say “Recall U2”.</dd>
      <dt>“U2, defend me”</dt><dd>Propose the nearest active armed turret for U2.</dd>
      <dt>“Send U2 to T3”</dt><dd>Choose a specific drone and target.</dd>
      <dt>“Send U1 to T1 and U2 to T3”</dt><dd>Approve both assignments together.</dd>
      <dt>“Take the far turret”</dt><dd>Ask the drone workers to suggest an assignment for a distant turret.</dd>
      <dt>“Take the near turret”</dt><dd>Ask the drone workers for a nearby turret assignment.</dd>
      <dt>“Send U2 to T3 when feasible”</dt><dd>Confirm in Orders to queue the assignment until it becomes possible.</dd>
      <dt>“What orders are waiting?”</dt><dd>Read the queue and order IDs. You can also see them in Orders.</dd>
      <dt>“Promote order-1” or “Cancel order-1”</dt><dd>Reprioritise or remove a waiting order. Use the ID shown in Orders.</dd>
    </dl>
    <p>Use the configured supervisor in <strong>Play</strong> for Scout, assignments, single-drone Recall and queue commands. Confirm or dismiss changes in <strong>Orders</strong>. If a drone is busy, Orders may offer <strong>Confirm override</strong> or <strong>Queue when feasible</strong>.</p>
  </details>
  <details class="keyboard-guide">
    <summary>Keyboard and hand controls</summary>
    <p><strong>Keyboard play.</strong> WASD moves, arrow keys aim, J fires the mech and H fires assigned drones. Aim at a turret and hold K to deploy or redirect. V uses the configured Recall gesture.</p>
    <p><strong>Hand tracking.</strong> Move with the left palm and aim with the right palm. The defaults are right Closed Fist for mech fire, left Closed Fist for drone fire, left Pointing Up for deploy or redirect, and left Victory for Recall. Hold a command until it takes effect. Settings shows your current bindings.</p>
    <p><strong>Shortcuts.</strong> R recalls both drones during active play. Shift uses short dash and Q uses long dash. Space pauses or resumes. Esc pauses in the arena and cancels in the control test. C checks both hands while paused.</p>
    <p><strong>Combat only.</strong> F toggles Fire at Will. G toggles agent autonomy. Y and N accept or dismiss the separate agent proposal shown on the HUD. For spoken orders, use the buttons in Orders.</p>
  </details>`;
