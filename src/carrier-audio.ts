import type {MissionPhase} from './carrier-mission';

const signals = {
  relay: [440, 660],
  extract: [660, 660, 880],
  complete: [440, 554, 660, 880],
} as const;

export class CarrierAudio {
  private context: AudioContext | undefined;
  private output: GainNode | undefined;
  enabled = false;

  async toggle(): Promise<boolean> {
    if (this.enabled) {
      this.enabled = false;
      if (this.output) this.output.gain.value = 0;
      return true;
    }
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = 0;
        this.output.connect(this.context.destination);
      }
      await this.context.resume();
      this.enabled = this.context.state === 'running';
      this.output!.gain.value = this.enabled ? .09 : 0;
      return this.enabled;
    } catch {
      return false;
    }
  }

  play(phase: MissionPhase) {
    const context = this.context, output = this.output;
    if (!this.enabled || !context || !output || context.state !== 'running' || phase === 'launch') return;
    signals[phase].forEach((frequency, i) => {
      const start = context.currentTime + i * .115;
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(.65, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.001, start + .135);
      oscillator.connect(envelope);
      envelope.connect(output);
      oscillator.start(start);
      oscillator.stop(start + .14);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    });
  }
}
