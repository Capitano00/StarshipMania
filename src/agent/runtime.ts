/**
 * Where a supervisor runtime finds the live tools.
 *
 * main.ts calls installSupervisorRuntime() once at startup. Supervisor code in the same page
 * then calls getSupervisorTools(). With `?supervisor` (or `?qa`) in the URL the registry is
 * also exposed as `window.starshipSupervisor` for scripts outside the bundle (e.g. a voice
 * widget's client tools). There is no network transport here: a model running on a server
 * needs its own bridge that relays tool calls into the page.
 */
import {createSupervisorTools, toAnthropicTools, toClientToolHandlers, toOpenAITools, type SupervisorContext, type ToolRegistry} from './tools';

export interface SupervisorRuntime extends ToolRegistry {
  readonly adapters: {anthropic: () => ReturnType<typeof toAnthropicTools>; openai: () => ReturnType<typeof toOpenAITools>; clientTools: () => ReturnType<typeof toClientToolHandlers>};
}

let current: SupervisorRuntime | null = null;

export function installSupervisorRuntime(ctx: SupervisorContext, options: {exposeGlobal?: boolean} = {}): SupervisorRuntime {
  const registry = createSupervisorTools(ctx);
  current = {...registry, adapters: {anthropic: () => toAnthropicTools(registry), openai: () => toOpenAITools(registry), clientTools: () => toClientToolHandlers(registry)}};
  if (options.exposeGlobal) Object.assign(globalThis, {starshipSupervisor: current});
  return current;
}

/** The live registry, or null before the game has started. */
export function getSupervisorTools(): SupervisorRuntime | null { return current; }
