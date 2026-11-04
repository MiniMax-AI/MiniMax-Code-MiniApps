# Windows resident collector for the system board.
#
# Launched by the Node side with -File. Emits one JSON line per round on stdout
# and is reaped when the parent exits. Every counter object is built once at
# startup, then each round only reads RawValue / NextValue: Get-Counter
# enumeration costs 1 to 4 seconds per call, a prebuilt counter reads in microseconds.
# Unavailable counters report -1, which the Node side maps to null.

param([int]$IntervalMs = 1000)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function New-Ctr([string]$Category, [string]$Counter, [string]$Instance) {
  try {
    $c = New-Object System.Diagnostics.PerformanceCounter($Category, $Counter)
    if ($Instance) { $c.InstanceName = $Instance }
    $null = $c.NextValue()
    return $c
  } catch {
    return $null
  }
}

# RawValue yields cumulative totals, NextValue yields instantaneous values.
function Get-Raw($c) { if ($null -eq $c) { return -1 } try { return [double]$c.RawValue } catch { return -1 } }
function Get-Nxt($c) { if ($null -eq $c) { return -1 } try { return [double]$c.NextValue() } catch { return -1 } }

function Get-JsonString([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return '' }
  $s = $s.Replace('\', '\\\\').Replace('"', '\\"')
  $s = $s.Replace([string][char]13, '').Replace([string][char]10, '').Replace([string][char]9, ' ')
  return $s
}

# ---------------------------------------------------------------- startup

# Memory: the Memory category is single-instance, so all seven counters build directly
$cAvail    = New-Ctr 'Memory' 'Available Bytes' $null
$cModified = New-Ctr 'Memory' 'Modified Page List Bytes' $null
$cFreeZero = New-Ctr 'Memory' 'Free & Zero Page List Bytes' $null
$cSbCore   = New-Ctr 'Memory' 'Standby Cache Core Bytes' $null
$cSbNorm   = New-Ctr 'Memory' 'Standby Cache Normal Priority Bytes' $null
$cSbRes    = New-Ctr 'Memory' 'Standby Cache Reserve Bytes' $null
$cCache    = New-Ctr 'Memory' 'Cache Bytes' $null

# Load: Windows has no load average, processor queue length is the closest stand-in
$cQueue = New-Ctr 'System' 'Processor Queue Length' $null

# Disk: the _Total instance RawValue is cumulative bytes and operations since boot
$cDiskRead  = New-Ctr 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'
$cDiskWrite = New-Ctr 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'
$cDiskOpR   = New-Ctr 'PhysicalDisk' 'Disk Reads/sec' '_Total'
$cDiskOpW   = New-Ctr 'PhysicalDisk' 'Disk Writes/sec' '_Total'

# Network: instance names are adapter descriptions, so pick the busiest one at
# startup and keep it for the rest of the run.
$netName = $null
$cNetIn = $null
$cNetOut = $null
$cNetPktIn = $null
$cNetPktOut = $null
try {
  $cat = New-Object System.Diagnostics.PerformanceCounterCategory('Network Interface')
  $best = -1
  foreach ($inst in $cat.GetInstanceNames()) {
    $probe = New-Object System.Diagnostics.PerformanceCounter('Network Interface', 'Bytes Total/sec', $inst)
    $v = [double]$probe.RawValue
    if ($v -gt $best) { $best = $v; $netName = $inst }
  }
  if ($netName) {
    $cNetIn     = New-Ctr 'Network Interface' 'Bytes Received/sec' $netName
    $cNetOut    = New-Ctr 'Network Interface' 'Bytes Sent/sec' $netName
    $cNetPktIn  = New-Ctr 'Network Interface' 'Packets Received/sec' $netName
    $cNetPktOut = New-Ctr 'Network Interface' 'Packets Sent/sec' $netName
  }
} catch { $netName = $null }

$totalMem = 0
try { $totalMem = [double](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory } catch { $totalMem = 0 }

# ---------------------------------------------------------------- GPU sampling

# GPU Engine instance names carry pid and LUID and come and go as processes start
# and stop, so counter objects cannot be prebuilt and the whole class must be
# queried. That costs an order of magnitude more than the rest, so refresh every
# 5 rounds and reuse the cached values in between, keeping every tick populated.
$script:gpuCache = @{ device = -1; render = -1; tiler = -1; vramUsed = -1; vramAlloc = -1; temp = -1; power = -1; zone = -1 }

# nvidia-smi lives next to the driver and is not always on PATH
$script:nvSmi = $null
foreach ($cand in @('nvidia-smi', "$env:SystemRoot\System32\nvidia-smi.exe", "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe")) {
  if ($script:nvSmi) { break }
  try {
    $found = Get-Command $cand -ErrorAction SilentlyContinue
    if ($found) { $script:nvSmi = $found.Source }
  } catch { }
}

function Update-Gpu {
  $r = @{ device = 0.0; render = 0.0; tiler = 0.0; vramUsed = 0.0; vramAlloc = 0.0; temp = -1; power = -1; zone = -1 }
  $ok = $false
  try {
    $engines = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
    foreach ($e in $engines) {
      $u = [double]$e.UtilizationPercentage
      if ($u -le 0) { continue }
      $r.device += $u
      # Instance names look like pid_1234_luid_0x00_0x00_phys_0_eng_0_engtype_3D
      if ($e.Name -match '_engtype_(.+)$') {
        switch ($Matches[1]) {
          '3D' { $r.render += $u }
          'Copy' { $r.tiler += $u }
          'VideoDecode' { $r.tiler += $u }
          'VideoEncode' { $r.tiler += $u }
        }
      }
    }
    $ok = $true
  } catch { }

  try {
    $mem = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory
    foreach ($m in $mem) {
      $r.vramUsed  += [double]$m.DedicatedUsage
      $r.vramAlloc += [double]$m.DedicatedUsage + [double]$m.SharedUsage
    }
    $ok = $true
  } catch { }

  # GPU temperature and power come from the NVIDIA driver. Cards that do not
  # report power answer [N/A], which fails the cast and leaves the field at -1.
  if ($script:nvSmi) {
    try {
      $line = & $script:nvSmi --query-gpu=temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null | Select-Object -First 1
      if ($line) {
        $parts = $line -split ','
        try { $r.temp = [double]$parts[0].Trim() } catch { }
        if ($parts.Count -gt 1) { try { $r.power = [double]$parts[1].Trim() } catch { } }
        $ok = $true
      }
    } catch { }
  }

  # ACPI thermal zone. CurrentTemperature is in tenths of a kelvin.
  # Many machines expose no zone at all, which leaves the field at -1.
  try {
    $tz = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
    if ($tz) {
      $max = ($tz | Measure-Object -Property CurrentTemperature -Maximum).Maximum
      if ($max -gt 0) { $r.zone = $max / 10 - 273.15 }
    }
  } catch { }

  if ($ok) {
    $r.device = [Math]::Min(100.0, $r.device)
    $r.render = [Math]::Min(100.0, $r.render)
    $r.tiler  = [Math]::Min(100.0, $r.tiler)
    $script:gpuCache = $r
  }
}

# ---------------------------------------------------------- parent process ids

# Get-Process in Windows PowerShell 5.1 exposes no Parent property, so the parent
# has to come from the CIM process table. That query walks every process object and
# costs far more than the rest of a round, so refresh it every 5 rounds and reuse
# the map in between, the same way the GPU block above does.
$script:ppidMap = @{}

function Update-Ppid {
  $map = @{}
  try {
    foreach ($w in Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue) {
      $map[[int]$w.ProcessId] = [int]$w.ParentProcessId
    }
  } catch { }
  if ($map.Count -gt 0) { $script:ppidMap = $map }
}

# ---------------------------------------------------------------- main loop

$round = 0
$bootMs = 0
try { $bootMs = [DateTimeOffset]::new((Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToUnixTimeMilliseconds() } catch { $bootMs = 0 }

while ($true) {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  if (($round % 5) -eq 0) { Update-Gpu }
  # Offset from the GPU refresh so the two heavy CIM queries never land on the same
  # round and stretch a single tick.
  if (($round % 5) -eq 2) { Update-Ppid }

  # ---- Process table. TotalProcessorTime is cumulative seconds since boot, the
  # Node side diffs it into a utilisation rate.
  $sb = New-Object System.Text.StringBuilder
  $threadTotal = 0
  $procCount = 0
  $procs = Get-Process -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $threads = 0
    try { $threads = $p.Threads.Count } catch { $threads = 0 }
    $threadTotal += $threads
    $cpu = 0
    try { $cpu = [double]$p.TotalProcessorTime.TotalSeconds } catch { $cpu = 0 }
    $rss = 0
    try { $rss = [double]$p.WorkingSet64 } catch { $rss = 0 }
    $start = 0
    try { $start = [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() } catch { $start = 0 }
    $user = ''
    try { $user = $p.UserName } catch { $user = '' }
    $ppid = 0
    if ($script:ppidMap.ContainsKey([int]$p.Id)) { $ppid = $script:ppidMap[[int]$p.Id] }
    if ($procCount -gt 0) { [void]$sb.Append(',') }
    [void]$sb.Append('{"pid":').Append($p.Id)
    [void]$sb.Append(',"ppid":').Append($ppid)
    [void]$sb.Append(',"user":"').Append((Get-JsonString $user)).Append('"')
    [void]$sb.Append(',"cpu":').Append($cpu.ToString('R', [Globalization.CultureInfo]::InvariantCulture))
    [void]$sb.Append(',"rss":').Append($rss.ToString('R', [Globalization.CultureInfo]::InvariantCulture))
    [void]$sb.Append(',"th":').Append($threads)
    [void]$sb.Append(',"st":').Append($start)
    [void]$sb.Append(',"name":"').Append((Get-JsonString $p.ProcessName)).Append('"}')
    $procCount += 1
  }

  # ---- Memory
  $memJson = '"total":' + $totalMem +
             ',"avail":' + (Get-Raw $cAvail) +
             ',"mod":' + (Get-Raw $cModified) +
             ',"free":' + (Get-Raw $cFreeZero) +
             ',"sbCore":' + (Get-Raw $cSbCore) +
             ',"sbNorm":' + (Get-Raw $cSbNorm) +
             ',"sbRes":' + (Get-Raw $cSbRes) +
             ',"cache":' + (Get-Raw $cCache)

  $g = $script:gpuCache
  $gpuJson = '"device":' + $g.device + ',"render":' + $g.render + ',"tiler":' + $g.tiler +
             ',"vramUsed":' + $g.vramUsed + ',"vramAlloc":' + $g.vramAlloc +
             ',"temp":' + $g.temp + ',"power":' + $g.power + ',"zone":' + $g.zone

  $diskJson = '"read":' + (Get-Raw $cDiskRead) + ',"write":' + (Get-Raw $cDiskWrite) +
              ',"opR":' + (Get-Raw $cDiskOpR) + ',"opW":' + (Get-Raw $cDiskOpW)

  $netJson = '"name":"' + (Get-JsonString $netName) + '"' +
             ',"ib":' + (Get-Raw $cNetIn) + ',"ob":' + (Get-Raw $cNetOut) +
             ',"ip":' + (Get-Raw $cNetPktIn) + ',"op":' + (Get-Raw $cNetPktOut)

  $line = '{"t":' + $t +
          ',"boot":' + $bootMs +
          ',"queue":' + (Get-Nxt $cQueue) +
          ',"mem":{' + $memJson + '}' +
          ',"gpu":{' + $gpuJson + '}' +
          ',"disk":{' + $diskJson + '}' +
          ',"net":{' + $netJson + '}' +
          ',"threads":' + $threadTotal +
          ',"procs":[' + $sb.ToString() + ']}'

  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()

  $round += 1
  $spent = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $t
  $rest = $IntervalMs - $spent
  if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }
}
