param(
    [Parameter(Mandatory)][ValidatePattern('^agent_[a-z0-9]+$')][string]$AgentId,
    [ValidateRange(1024, 65535)][int]$Port = 4180
)

$key = Read-Host 'ElevenLabs API key (input hidden)' -AsSecureString
if ($key.Length -eq 0) { throw 'Enter an ElevenLabs API key.' }
$previousKey = $env:ELEVENLABS_API_KEY
$previousAgent = $env:ELEVENLABS_AGENT_ID
Push-Location -LiteralPath (Join-Path $PSScriptRoot '..')
try {
    $env:ELEVENLABS_API_KEY = [pscredential]::new('ElevenLabs', $key).GetNetworkCredential().Password
    $env:ELEVENLABS_AGENT_ID = $AgentId
    npm.cmd run preview -- --port $Port
} finally {
    $env:ELEVENLABS_API_KEY = $previousKey
    $env:ELEVENLABS_AGENT_ID = $previousAgent
    $key.Dispose()
    Pop-Location
}
