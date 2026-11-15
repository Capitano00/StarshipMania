# Local ElevenLabs Recall

## Create your own voice agent

The team's supervisor agent settings are in `scripts/voice-agent.json`: the system prompt, the client tools and the client events. The file contains no keys. Each teammate creates their own private copy with their own key:

1. In ElevenLabs, open **Developers → API Keys** and create a restricted key. Set **ElevenAgents** to **Write** and leave everything else on **No Access**. Never paste the key into chat or commit it.
2. From the checkout, run `& ./scripts/create-voice-agent.ps1` and enter the key at the hidden prompt. It prints the new `agent_…` ID.
3. Optional: to enable "take the far/near turret", install Ollama (`winget install Ollama.Ollama`) and run `ollama pull qwen3.5:2b-q4_K_M`.
4. Run `npm ci` and `npm run build`, then start the game with voice using the printed command. The command has this form:
   `& ./scripts/start-voice.ps1 -AgentId agent_YOUR_ID -Port 4186 -DroneWorkerProvider ollama`

The agent registers every tool from the expanded voice-commands branch. Builds that lack a tool simply don't answer that call.

## Run with an existing agent

Use Node 24. From the StarshipMania checkout run `npm ci` and `npm run build`, then start the voice-enabled local preview in PowerShell:

```powershell
& ./scripts/start-voice.ps1 -AgentId agent_YOUR_ID
```

Use the published, authenticated StarshipMania Voice Test agent with `recall_drones` attached and **Wait for response** on. Enter the key at the launcher's hidden prompt. If port 4180 is occupied, pass `-Port 4182`. The launcher keeps the key in the server process environment while preview runs. The browser receives a signed session URL. A regular preview without voice credentials keeps the original microphone and connection policies.

Open the printed loopback address, select Synthetic Rehearsal, and start an active arena. Click **Start voice** and allow the microphone in the browser when prompted. The game streams audio to ElevenLabs while voice is listening. Use synthetic speech for shared evidence and check the agent's retention settings before recording a human rehearsal.

The arena status bar identifies the current **Hands** source and **Voice** state. **Start voice** opens the **Voice** inspector tab. This shows what ElevenLabs heard, the agent reply and the game’s Recall result. Interim text appears when the agent sends it. To enable streamed agent text, include `agent_chat_response_part` in the published agent’s client events. The completed reply still appears when that event is unavailable. Retry clears the local transcript. For physical hands, choose **Controls → Activate webcam** and follow the authorized local asset setup in the README.

| Check | Expected |
| --- | --- |
| Say “Recall drones” once during active play | One accepted Recall with Voice in the round log. Drones return to follow positions and active Fire at Will stops. |
| Say “Do not recall drones” | No accepted Recall. |
| Deny microphone permission or start without credentials | Voice unavailable. **R** and the Recall button remain usable. |
| Press **R** or use the Recall button before a voice reply arrives | The manual Recall takes effect. The earlier spoken turn cannot recall again. |
| Stop voice, pause, change tabs, or restart while a request is pending | The session ends and a late tool call cannot act on the arena. |

Record the commit, browser, expected and observed results, and a clean-start run. The separate synthetic voice bench proved an ElevenLabs callback and a negation case. A physical microphone test in the game is a separate merge check.
