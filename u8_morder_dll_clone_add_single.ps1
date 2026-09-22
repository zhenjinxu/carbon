param(
  [ValidateSet('Preflight','Execute')]
  [string]$Mode = 'Preflight',
  [string]$SourceOrderNo = 'J260900063',
  [string]$NewOrderNo = 'J260900193',
  [string]$WorkDir = 'D:\Object\carbon\.codex\work'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$u8Root = 'D:\U8SOFT'
$frameworkDir = Join-Path $u8Root 'UFMOM\U8APIFramework'
$interopDir = Join-Path $u8Root 'Interop'
$connectionInfoPath = Join-Path $WorkDir 'u8-local-connection-info.tmp'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
$prefix = Join-Path $WorkDir "u8-morder-dll-clone-$SourceOrderNo-$NewOrderNo-$stamp"
$resultPath = "$prefix-$Mode.result.json"
$sourceXmlPath = "$prefix-source.extbo.xml"
$cloneXmlPath = "$prefix-clone.extbo.xml"
$callCountPath = Join-Path $WorkDir "u8-morder-dll-clone-$NewOrderNo-call-count.txt"

function Get-ConnectionInfo {
  $text = [IO.File]::ReadAllText($connectionInfoPath, [Text.Encoding]::UTF8)
  $comma = [char]0xFF0C
  $colon = [char]0xFF1A
  $parts = $text.Split($comma)
  if ($parts.Count -lt 4) { throw 'Unable to parse local U8 connection information.' }
  # The first comma-delimited segment is a human-readable heading.
  $userPart = $parts[1]
  $passwordPart = $parts[2]
  $userColon = $userPart.IndexOf($colon)
  $passwordColon = $passwordPart.IndexOf($colon)
  $accountMatch = [regex]::Match($text, '\[(?<account>\d+)\]')
  $serverMatch = [regex]::Match($text, '(?<server>\d{1,3}(?:\.\d{1,3}){3})')
  if ($userColon -lt 0 -or $passwordColon -lt 0 -or -not $accountMatch.Success -or -not $serverMatch.Success) {
    throw 'Unable to parse local U8 connection information.'
  }
  return [ordered]@{
    User = $userPart.Substring($userColon + 1).Trim()
    Password = $passwordPart.Substring($passwordColon + 1).Trim()
    Account = $accountMatch.Groups['account'].Value
    Server = $serverMatch.Groups['server'].Value
  }
}

function Load-U8Assemblies {
  foreach ($path in @(
    (Join-Path $frameworkDir 'UFIDA.U8.MomServiceCommon.dll'),
    (Join-Path $frameworkDir 'UFIDA.U8.U8MOMAPIFramework.dll'),
    (Join-Path $frameworkDir 'UFIDA.U8.U8APIFramework.dll'),
    (Join-Path $interopDir 'Interop.U8Login.dll'),
    (Join-Path $interopDir 'Interop.MSXML2.dll')
  )) {
    [void][Reflection.Assembly]::LoadFrom($path)
  }
}

function New-ApiBroker([string]$Api) {
  $context = New-Object UFIDA.U8.U8APIFramework.U8EnvContext
  $context.U8Login = $script:login
  $address = New-Object UFIDA.U8.U8APIFramework.U8ApiAddress($Api)
  return New-Object UFIDA.U8.U8APIFramework.U8ApiBroker($address, $context)
}

function Get-Value($row, [string]$Name) {
  try {
    $value = $row[$Name]
    if ($null -eq $value) { return '' }
    return [string]$value
  } catch { return '' }
}

function Get-DecimalValue($row, [string]$Name) {
  $text = Get-Value $row $Name
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $parsed = [decimal]0
  if (-not [decimal]::TryParse($text, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
    throw "Field $Name is not numeric: $text"
  }
  return $parsed
}

function Get-OrderSummary($extbo) {
  if ($null -eq $extbo -or $extbo.ItemCount -ne 1) {
    $count = if ($null -eq $extbo) { 0 } else { $extbo.ItemCount }
    throw "Expected one production-order extbo item, got $count."
  }
  $head = $extbo[0]
  $details = $head.SubEntity['Mom_OrderDetail']
  if ($null -eq $details) { throw 'Production-order extbo has no Mom_OrderDetail entity.' }
  $detailRows = @()
  for ($i = 0; $i -lt $details.ItemCount; $i++) {
    $row = $details[$i]
    $alloc = $row.SubEntity['Mom_MoAllocate']
    $detailRows += [ordered]@{
      index = $i
      DMoClass = Get-Value $row 'DMoClass'
      DInvCode = Get-Value $row 'DInvCode'
      DStartDate = Get-Value $row 'DStartDate'
      DDueDate = Get-Value $row 'DDueDate'
      DQty = Get-Value $row 'DQty'
      DMrpQty = Get-Value $row 'DMrpQty'
      DSortSeq = Get-Value $row 'DSortSeq'
      DMoDId = Get-Value $row 'DMoDId'
      DStatus = Get-Value $row 'DStatus'
      DWhCode = Get-Value $row 'DWhCode'
      DMDeptCode = Get-Value $row 'DMDeptCode'
      DBomId = Get-Value $row 'DBomId'
      DRoutingId = Get-Value $row 'DRoutingId'
      DRelsUser = Get-Value $row 'DRelsUser'
      DRelsDate = Get-Value $row 'DRelsDate'
      DRelsTime = Get-Value $row 'DRelsTime'
      allocationCount = if ($null -eq $alloc) { 0 } else { $alloc.ItemCount }
    }
  }
  return [ordered]@{
    MoId = Get-Value $head 'MoId'
    MoCode = Get-Value $head 'MoCode'
    detailCount = $detailRows.Count
    details = @($detailRows)
  }
}

function Read-Order([string]$OrderNo) {
  $broker = New-ApiBroker 'U8API/MOrder/MOrderLoad'
  try {
    $broker.AssignNormalValue('mocode', $OrderNo)
    if (-not $broker.Invoke()) {
      $exception = $broker.GetException()
      $reason = $broker.GetExceptionString()
      $detail = if ($null -ne $exception) { $exception.Message } else { '' }
      throw "MOrderLoad Invoke failed: $detail $reason".Trim()
    }
    $raw = $broker.GetReturnValue()
    if ($null -eq $raw -or -not [Convert]::ToBoolean($raw)) {
      throw "MOrderLoad returned Boolean false or null: $raw"
    }
    $extbo = $broker.GetExtBoEntity('extbo')
    $xml = $extbo.Serialize()
    return [ordered]@{
      Summary = Get-OrderSummary $extbo
      ExtboXml = $xml
      ReturnValue = [Convert]::ToBoolean($raw)
      ReturnValueType = $raw.GetType().FullName
    }
  } finally {
    try { $broker.Release() } catch {}
  }
}

function Build-CloneXml([string]$sourceXml) {
  $sourceDocument = [Xml.XmlDocument]::new()
  $sourceDocument.LoadXml($sourceXml)
  $cloneDocument = $sourceDocument.Clone()
  $head = $cloneDocument.SelectSingleNode('/Mom_Order/mom_order')
  if ($null -eq $head) { throw 'Source extbo has no mom_order node.' }
  $head.SetAttribute('moid', '1')
  $head.SetAttribute('mocode', $NewOrderNo)
  foreach ($name in @('createuser', 'createdate', 'createtime', 'modifyuser', 'modifydate', 'modifytime')) {
    if ($head.HasAttribute($name)) { $head.RemoveAttribute($name) }
  }
  $detailNodes = @($cloneDocument.SelectNodes('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail'))
  if ($detailNodes.Count -ne 1) { throw "Expected one source detail node, got $($detailNodes.Count)." }
  $detail = $detailNodes[0]
  $detail.SetAttribute('dmodid', '1')
  foreach ($name in @('drelsuser', 'drelsdate', 'drelstime', 'dcloseuser', 'dclosedate', 'dclosetime')) {
    if ($detail.HasAttribute($name)) { $detail.RemoveAttribute($name) }
  }
  $allocNodes = @($detail.SelectNodes('./Mom_MoAllocate/mom_moallocate'))
  if ($allocNodes.Count -ne 1) { throw "Expected one source allocation node, got $($allocNodes.Count)." }
  return $cloneDocument.OuterXml
}

function Invoke-Add([string]$cloneXml) {
  $broker = New-ApiBroker 'U8API/MOrder/MOrderAdd'
  try {
    $extbo = $broker.GetExtBoEntity('extbo')
    $extbo.Deserialize($cloneXml)
    if ($extbo.ItemCount -ne 1) { throw 'Prepared add extbo does not contain one order.' }
    $details = $extbo[0].SubEntity['Mom_OrderDetail']
    if ($details.ItemCount -ne 1) { throw 'Prepared add extbo does not contain one detail.' }
    $detail = $details[0]
    if ((Get-Value $extbo[0] 'MoCode') -ne $NewOrderNo -or (Get-Value $extbo[0] 'MoId') -ne '1') {
      throw 'Prepared add extbo identity mismatch.'
    }
    if ((Get-Value $detail 'DMoDId') -ne '1') { throw 'Prepared add detail ID mismatch.' }
    if (-not $broker.Invoke()) {
      $exception = $broker.GetException()
      $reason = $broker.GetExceptionString()
      $detailText = if ($null -ne $exception) { $exception.Message } else { '' }
      throw "MOrderAdd Invoke failed: $detailText $reason".Trim()
    }
    $raw = $broker.GetReturnValue()
    if ($null -eq $raw -or -not [Convert]::ToBoolean($raw)) {
      throw "MOrderAdd returned Boolean false or null: $raw"
    }
    return [ordered]@{ ReturnValue = [Convert]::ToBoolean($raw); ReturnValueType = $raw.GetType().FullName }
  } finally {
    try { $broker.Release() } catch {}
  }
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$result = [ordered]@{
  mode = $Mode
  sourceOrderNo = $SourceOrderNo
  newOrderNo = $NewOrderNo
  process64 = [Environment]::Is64BitProcess
  startedAt = (Get-Date).ToString('o')
}
$connection = $null
$login = $null
try {
  if ($SourceOrderNo -eq $NewOrderNo) { throw 'Source and new order numbers must differ.' }
  $connection = Get-ConnectionInfo
  Load-U8Assemblies
  $login = New-Object U8Login.clsLoginClass
  $script:login = $login
  $subId = 'AS'; $accId = '(default)@' + $connection.Account; $year = '2026'
  $userId = $connection.User; $password = $connection.Password
  $loginDate = (Get-Date).ToString('yyyy-MM-dd'); $server = $connection.Server; $serial = ''
  if (-not $login.Login([ref]$subId, [ref]$accId, [ref]$year, [ref]$userId, [ref]$password, [ref]$loginDate, [ref]$server, [ref]$serial)) {
    throw 'U8 login failed.'
  }
  $password = $null; $connection = $null

  $source = Read-Order $SourceOrderNo
  $result.sourceBefore = $source.Summary
  if ($source.Summary.MoCode -ne $SourceOrderNo -or $source.Summary.MoId -ne '1000004689') { throw 'Source order identity mismatch.' }
  if ($source.Summary.detailCount -lt 1) { throw 'Source order has no detail rows.' }
  $sourceDetail = $source.Summary.details[0]
  if ($sourceDetail.DMoDId -ne '1000118479' -or $sourceDetail.DInvCode -ne '19260501030302') { throw 'Source detail identity mismatch.' }
  if ($sourceDetail.allocationCount -ne 1) { throw 'Source order must have exactly one allocation row.' }
  if (([decimal]$sourceDetail.DQty) -ne 10 -or ([decimal]$sourceDetail.DMrpQty) -ne 10) {
    throw 'Source quantity is not 10/10; refusing clone.'
  }

  $cloneXml = Build-CloneXml $source.ExtboXml
  [IO.File]::WriteAllText($sourceXmlPath, $source.ExtboXml, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($cloneXmlPath, $cloneXml, [Text.UTF8Encoding]::new($false))
  $cloneDoc = [Xml.XmlDocument]::new(); $cloneDoc.LoadXml($cloneXml)
  $result.cloneAssertions = [ordered]@{
    root = $cloneDoc.DocumentElement.Name
    orderCount = @($cloneDoc.SelectNodes('/Mom_Order/mom_order')).Count
    detailCount = @($cloneDoc.SelectNodes('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail')).Count
    allocationCount = @($cloneDoc.SelectNodes('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail/Mom_MoAllocate/mom_moallocate')).Count
    moid = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order').GetAttribute('moid')
    mocode = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order').GetAttribute('mocode')
    dmodid = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail').GetAttribute('dmodid')
    dinvcode = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail').GetAttribute('dinvcode')
    dqty = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail').GetAttribute('dqty')
    dmrpqty = $cloneDoc.SelectSingleNode('/Mom_Order/mom_order/Mom_OrderDetail/mom_orderdetail').GetAttribute('dmrpqty')
  }
  if ($result.cloneAssertions.orderCount -ne 1 -or $result.cloneAssertions.detailCount -ne 1 -or $result.cloneAssertions.allocationCount -ne 1) { throw 'Clone XML shape assertion failed.' }
  if ($result.cloneAssertions.mocode -ne $NewOrderNo -or $result.cloneAssertions.moid -ne '1' -or $result.cloneAssertions.dmodid -ne '1') { throw 'Clone XML identity assertion failed.' }
  if ($result.cloneAssertions.dinvcode -ne $sourceDetail.DInvCode -or $result.cloneAssertions.dqty -ne $sourceDetail.DQty -or $result.cloneAssertions.dmrpqty -ne $sourceDetail.DMrpQty) { throw 'Clone XML business-field assertion failed.' }

  if ($Mode -eq 'Preflight') {
    $result.decision = 'read_only_clone_prepared'
  } else {
    if (Test-Path -LiteralPath $callCountPath) { throw 'Clone add write guard already exists; refusing a second MOrderAdd.' }
    [IO.File]::WriteAllText($callCountPath, 'write_started', [Text.UTF8Encoding]::new($false))
    $result.add = Invoke-Add $cloneXml
    $created = Read-Order $NewOrderNo
    $result.createdAfter = $created.Summary
    if ($created.Summary.MoCode -ne $NewOrderNo -or $created.Summary.detailCount -ne 1) { throw 'Created order read-back identity or detail count mismatch.' }
    $createdDetail = $created.Summary.details[0]
    $checks = [ordered]@{
      invCode = ($createdDetail.DInvCode -eq $sourceDetail.DInvCode)
      qty = (([decimal]$createdDetail.DQty) -eq ([decimal]$sourceDetail.DQty))
      mrpQty = (([decimal]$createdDetail.DMrpQty) -eq ([decimal]$sourceDetail.DMrpQty))
      startDate = ($createdDetail.DStartDate -eq $sourceDetail.DStartDate)
      dueDate = ($createdDetail.DDueDate -eq $sourceDetail.DDueDate)
      whCode = ($createdDetail.DWhCode -eq $sourceDetail.DWhCode)
      deptCode = ($createdDetail.DMDeptCode -eq $sourceDetail.DMDeptCode)
      allocationCount = ($createdDetail.allocationCount -eq $sourceDetail.allocationCount)
    }
    $result.readBackChecks = $checks
    if (@($checks.Values | Where-Object { -not $_ }).Count -ne 0) { throw 'Created order read-back business-field mismatch.' }
    $result.decision = 'created_and_verified'
    [IO.File]::WriteAllText($callCountPath, 'add=1', [Text.UTF8Encoding]::new($false))
  }
  $result.completedAt = (Get-Date).ToString('o')
  $json = $result | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($resultPath, $json, [Text.UTF8Encoding]::new($false))
  $json
} catch {
  $result.error = $_.Exception.Message
  $result.completedAt = (Get-Date).ToString('o')
  $json = $result | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($resultPath, $json, [Text.UTF8Encoding]::new($false))
  $json
  exit 1
} finally {
  $connection = $null
  try { if ($null -ne $login) { $login.ShutDown() } } catch {}
  try { if ($null -ne $login) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($login) } } catch {}
}
