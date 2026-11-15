param(
    [Parameter(Mandatory)][ValidatePattern('^agent_[a-z0-9]+$')][string]$AgentId,
    [ValidateRange(1024, 65535)][int]$Port = 4180,
    [ValidateSet('ollama','openai')][string]$DroneWorkerProvider = 'ollama'
)

$previousKey = $env:ELEVENLABS_API_KEY
$previousAgent = $env:ELEVENLABS_AGENT_ID
$previousDroneProvider = $env:DRONE_WORKER_PROVIDER
$previousOpenAiKey = $env:OPENAI_API_KEY
$key = $null
$openAiKey = $null
Push-Location -LiteralPath (Join-Path $PSScriptRoot '..')
try {
    $key = Read-Host 'ElevenLabs API key (input hidden)' -AsSecureString
    if ($key.Length -eq 0) { throw 'Enter an ElevenLabs API key.' }
    if ($DroneWorkerProvider -eq 'openai' -and [string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
        $openAiKey = Read-Host 'OpenAI API key (input hidden)' -AsSecureString
        if ($openAiKey.Length -eq 0) { throw 'Enter an OpenAI API key.' }
        $env:OPENAI_API_KEY = [pscredential]::new('OpenAI', $openAiKey).GetNetworkCredential().Password
    }
    $env:ELEVENLABS_API_KEY = [pscredential]::new('ElevenLabs', $key).GetNetworkCredential().Password
    $env:ELEVENLABS_AGENT_ID = $AgentId
    $env:DRONE_WORKER_PROVIDER = $DroneWorkerProvider.ToLowerInvariant()
    npm.cmd run preview -- --port $Port
} finally {
    $env:ELEVENLABS_API_KEY = $previousKey
    $env:ELEVENLABS_AGENT_ID = $previousAgent
    $env:DRONE_WORKER_PROVIDER = $previousDroneProvider
    $env:OPENAI_API_KEY = $previousOpenAiKey
    if ($key) { $key.Dispose() }
    if ($openAiKey) { $openAiKey.Dispose() }
    Pop-Location
}
