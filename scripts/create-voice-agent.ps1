# Creates a private ElevenLabs voice supervisor agent from scripts/voice-agent.json.
# The key needs "ElevenAgents: Write". It is read at a hidden prompt and never written to disk.
$key = $null
try {
    $key = Read-Host 'ElevenLabs API key with ElevenAgents: Write (input hidden)' -AsSecureString
    if ($key.Length -eq 0) { throw 'Enter an ElevenLabs API key.' }
    $plain = [pscredential]::new('ElevenLabs', $key).GetNetworkCredential().Password
    $config = Join-Path $PSScriptRoot 'voice-agent.json'
    $result = Invoke-RestMethod -Method Post -Uri 'https://api.elevenlabs.io/v1/convai/agents/create' `
        -Headers @{ 'xi-api-key' = $plain } -ContentType 'application/json' -InFile $config
    Write-Host "Agent created: $($result.agent_id)"
    Write-Host "Start the game with voice:"
    Write-Host "  & ./scripts/start-voice.ps1 -AgentId $($result.agent_id) -Port 4186 -DroneWorkerProvider ollama"
} finally {
    $plain = $null
    if ($key) { $key.Dispose() }
}
