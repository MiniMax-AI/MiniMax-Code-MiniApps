# Records the workspace of the conversation that just started or received a message, so the
# text editor can put that project first the next time it opens. Side effect only: no stdout.
$null = [Console]::In.ReadToEnd()
$data = $env:PLUGIN_DATA
$workspace = $env:MINIMAX_PROJECT_DIR
if (-not $data -or -not $workspace) { exit 0 }
New-Item -ItemType Directory -Force -Path $data | Out-Null
$tmp = Join-Path $data "active-workspace.$PID"
[IO.File]::WriteAllText($tmp, $workspace)
Move-Item -Force -Path $tmp -Destination (Join-Path $data 'active-workspace')
exit 0
