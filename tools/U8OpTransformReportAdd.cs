using System;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8APIFramework.Parameter;
using U8Login;

internal static class U8OpTransformReportAdd
{
    const string Work = @"D:\Object\carbon\.codex\work";
    const string MoCode = "J260900117";
    const string MoCodeWithSeq = "J260900117-0001";
    const string InvCode = "23992114020302";
    const decimal ExpectedQty = 672m;
    const string GuardName = "u8-optransform-report-add-J260900117-0001-23992114020302-call-count.txt";

    static void ResolveAssemblies()
    {
        AppDomain.CurrentDomain.AssemblyResolve += (sender, args) =>
        {
            var name = new AssemblyName(args.Name).Name + ".dll";
            foreach (var dir in new[] { @"D:\U8SOFT\UFMOM\U8APIFramework", @"D:\U8SOFT\Interop", @"D:\U8SOFT\ufcomsql", @"D:\Object\carbon\tools" })
            {
                var p = Path.Combine(dir, name);
                if (File.Exists(p)) return Assembly.LoadFrom(p);
            }
            return null;
        };
    }

    static Dictionary<string, string> ReadEnvFile(string file)
    {
        var env = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in File.ReadAllLines(file, Encoding.UTF8))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            var i = line.IndexOf('=');
            if (i < 0) continue;
            env[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim().Trim('"', '\'');
        }
        return env;
    }

    static SqlConnection OpenSql()
    {
        var env = ReadEnvFile(@"D:\Object\carbon\.env.u8.local");
        var cs = "Server=" + env["U8_SERVER"] + "," + (env.ContainsKey("U8_PORT") ? env["U8_PORT"] : "1433") + ";Database=" + env["U8_DATABASE"] + ";User ID=" + env["U8_USER"] + ";Password=" + env["U8_PASSWORD"] + ";TrustServerCertificate=True;Encrypt=False;Connection Timeout=15";
        var conn = new SqlConnection(cs);
        conn.Open();
        return conn;
    }

    static DataSet QueryTarget(SqlConnection conn)
    {
        var sql = @"
SET NOCOUNT ON;
SELECT TOP (2) o.MoId, o.MoCode, o.CreateUser, o.CreateDate, o.CreateTime,
       d.MoDId, d.SortSeq, d.InvCode, d.Qty, d.MrpQty, d.Status, d.AuditStatus, d.MoLotCode, d.SoCode, d.SoSeq,
       i.cInvName, i.cInvStd, i.cComUnitCode, cu.cComUnitName,
       md.StartDate AS DetailStartDate, md.DueDate AS DetailDueDate
FROM dbo.mom_order AS o
JOIN dbo.mom_orderdetail AS d ON d.MoId = o.MoId
LEFT JOIN dbo.Inventory AS i ON i.cInvCode = d.InvCode
LEFT JOIN dbo.ComputationUnit AS cu ON cu.cComunitCode = i.cComUnitCode
LEFT JOIN dbo.mom_morder AS md ON md.MoDId = d.MoDId
WHERE o.MoCode = @moCode AND d.InvCode = @invCode
ORDER BY d.SortSeq, d.MoDId;

SELECT r.MoRoutingId, r.MoId, r.MoDId, r.Qty AS RoutingQty,
       rd.MoRoutingDId, rd.OpSeq, rd.OperationId, op.OpCode, rd.Description AS RoutingDescription, op.Description AS OperationDescription,
       rd.WcId, wc.WcCode, wc.Description AS WcName,
       rd.StartDate, rd.DueDate, rd.SubFlag, rd.LastFlag, rd.FirstFlag, rd.ReportFlag,
       rd.AuxUnitCode, rd.ChangeRate, rd.SubQty,
       rd.BalMachiningQty, rd.BalQualifiedQty, rd.BalRefusedQty, rd.BalScrapQty, rd.BalDeclareQty,
       rd.QualifiedQty, rd.RefusedQty, rd.ScrapQty, rd.ReworkQty, rd.CompleteQty, rd.ShiftQty, rd.ReportQty
FROM dbo.sfc_morouting AS r
JOIN dbo.sfc_moroutingdetail AS rd ON rd.MoRoutingId = r.MoRoutingId
LEFT JOIN dbo.sfc_operation AS op ON op.OperationId = rd.OperationId
LEFT JOIN dbo.sfc_workcenter AS wc ON wc.WcId = rd.WcId
WHERE r.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY rd.OpSeq, rd.MoRoutingDId;

SELECT b.MID, b.cVouchCode, b.cVouchType, b.VT_ID, bd.MDId, bd.MoDId, bd.MoRoutingId, bd.MoRoutingDId, bd.OutMoRoutingDId, bd.TransformId, bd.OpSeq, bd.OpStatus, bd.QualifiedQty, bd.Status AS DetailStatus
FROM dbo.fc_MoRoutingBill AS b
JOIN dbo.fc_MoRoutingBilldetail AS bd ON bd.MID = b.MID
WHERE bd.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY b.MID DESC, bd.MDId;

SELECT t.TransformId, t.DocCode, t.DocDate, t.DocTime, t.MoId, t.MoDId, t.MoRoutingId, t.MoRoutingDId, t.InMoRoutingDId,
       t.TransformType, t.OpStatus, t.TransOutQty, t.QualifiedQty, t.MachiningQty,
       t.RefusedQty, t.ScrapQty, t.DeclareQty, t.CreateUser, t.CreateDate, t.CreateTime, t.Status, t.RefDocCode, t.RefDocDId
FROM dbo.sfc_optransform AS t
WHERE t.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY t.TransformId DESC;

SELECT ISNULL(MAX(TransformId),0) AS MaxTransformId FROM dbo.sfc_optransform;
SELECT ISNULL(MAX(TRY_CONVERT(int, DocCode)),0) AS MaxTransformDocCode FROM dbo.sfc_optransform WHERE TRY_CONVERT(int, DocCode) IS NOT NULL;
SELECT ISNULL(MAX(MID),0) AS MaxMID FROM dbo.fc_MoRoutingBill;
SELECT ISNULL(MAX(TRY_CONVERT(int, cVouchCode)),0) AS MaxBillCode FROM dbo.fc_MoRoutingBill WHERE TRY_CONVERT(int, cVouchCode) IS NOT NULL;
";
        var ds = new DataSet();
        using (var da = new SqlDataAdapter(sql, conn))
        {
            da.SelectCommand.Parameters.Add("@moCode", SqlDbType.NVarChar, 30).Value = MoCode;
            da.SelectCommand.Parameters.Add("@invCode", SqlDbType.NVarChar, 60).Value = InvCode;
            da.Fill(ds);
        }
        return ds;
    }

    static DataSet QueryFc92Sample(SqlConnection conn)
    {
        var sql = @"
SET NOCOUNT ON;
DECLARE @mid int = 1000001055;
SELECT TOP (1) b.MID, b.cVouchCode, b.cVouchDate, b.cVouchTime, b.CreateUser, b.CreateDate, b.CreateTime,
       b.MoId, b.MoDId, b.WcId, b.TransType, b.SortType, b.OutQcFlag, b.cVouchType, b.VT_ID
FROM dbo.fc_MoRoutingBill AS b WHERE b.MID = @mid;
SELECT bd.MDId, bd.MID, bd.MoId, bd.MoDId, bd.MoRoutingId, bd.MoRoutingDId, bd.OutMoRoutingDId, bd.TransformId,
       bd.OpSeq, bd.OpCode, bd.OpDescription, bd.OpStatus, bd.QualifiedQty, bd.MachiningQty, bd.RefusedQty, bd.ScrapQty, bd.DeclareQty,
       bd.fAvaQuantity, bd.Status
FROM dbo.fc_MoRoutingBilldetail AS bd WHERE bd.MID = @mid ORDER BY bd.MDId;
SELECT t.TransformId, t.DocCode, t.DocDate, t.DocTime, t.MoId, t.MoDId, t.MoRoutingId, t.MoRoutingDId, t.InMoRoutingDId,
       t.TransformType, t.OpStatus, t.TransOutQty, t.QualifiedQty, t.MachiningQty,
       t.RefusedQty, t.ScrapQty, t.DeclareQty, t.CreateUser, t.CreateDate, t.CreateTime, t.Status, t.RefDocCode, t.RefDocDId
FROM dbo.sfc_optransform AS t WHERE t.RefDocCode = (SELECT cVouchCode FROM dbo.fc_MoRoutingBill WHERE MID=@mid) ORDER BY t.TransformId;
";
        var ds = new DataSet();
        using (var da = new SqlDataAdapter(sql, conn)) da.Fill(ds);
        return ds;
    }

    static DataSet QueryAfter(SqlConnection conn, int moDId, int beforeTransform, int beforeMid)
    {
        var sql = @"
SET NOCOUNT ON;
SELECT t.TransformId, t.DocCode, t.DocDate, t.DocTime, t.MoId, t.MoDId, t.MoRoutingId, t.MoRoutingDId, t.InMoRoutingDId,
       t.TransformType, t.OpStatus, t.TransOutQty, t.QualifiedQty, t.MachiningQty,
       t.RefusedQty, t.ScrapQty, t.DeclareQty, t.CreateUser, t.CreateDate, t.CreateTime, t.Status, t.RefDocCode, t.RefDocDId
FROM dbo.sfc_optransform AS t
WHERE t.MoDId = @moDId AND t.TransformId > @beforeTransform
ORDER BY t.TransformId;

SELECT b.MID, b.cVouchCode, b.cVouchType, b.VT_ID, bd.MDId, bd.MoDId, bd.MoRoutingId, bd.MoRoutingDId, bd.OutMoRoutingDId, bd.TransformId, bd.OpSeq, bd.OpStatus, bd.QualifiedQty, bd.Status AS DetailStatus
FROM dbo.fc_MoRoutingBill AS b
JOIN dbo.fc_MoRoutingBilldetail AS bd ON bd.MID = b.MID
WHERE bd.MoDId = @moDId AND b.MID > @beforeMid
ORDER BY b.MID, bd.MDId;

SELECT rd.MoRoutingDId, rd.OpSeq, rd.BalMachiningQty, rd.BalQualifiedQty, rd.QualifiedQty, rd.RefusedQty, rd.ScrapQty, rd.CompleteQty, rd.ReportQty
FROM dbo.sfc_moroutingdetail AS rd
JOIN dbo.sfc_morouting AS r ON r.MoRoutingId = rd.MoRoutingId
WHERE r.MoDId = @moDId
ORDER BY rd.OpSeq, rd.MoRoutingDId;
";
        var ds = new DataSet();
        using (var da = new SqlDataAdapter(sql, conn))
        {
            da.SelectCommand.Parameters.Add("@moDId", SqlDbType.Int).Value = moDId;
            da.SelectCommand.Parameters.Add("@beforeTransform", SqlDbType.Int).Value = beforeTransform;
            da.SelectCommand.Parameters.Add("@beforeMid", SqlDbType.Int).Value = beforeMid;
            da.Fill(ds);
        }
        return ds;
    }

    static string S(DataRow r, string name)
    {
        if (!r.Table.Columns.Contains(name) || r[name] == DBNull.Value) return "";
        if (r[name] is DateTime) return ((DateTime)r[name]).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        if (r[name] is decimal) return ((decimal)r[name]).ToString("0.##########", CultureInfo.InvariantCulture);
        if (r[name] is double) return ((double)r[name]).ToString("0.##########", CultureInfo.InvariantCulture);
        return Convert.ToString(r[name], CultureInfo.InvariantCulture) ?? "";
    }

    static decimal Dec(DataRow r, string name)
    {
        var value = S(r, name);
        return value.Length == 0 ? 0m : decimal.Parse(value, CultureInfo.InvariantCulture);
    }

    static int IntVal(DataTable t, string name) { return Convert.ToInt32(t.Rows[0][name], CultureInfo.InvariantCulture); }

    static U8ApiBroker Broker(clsLogin login, string api)
    {
        return new U8ApiBroker(new U8ApiAddress(api), new U8EnvContext { U8Login = login });
    }

    static clsLogin Login()
    {
        var info = File.ReadAllText(Path.Combine(Work, "u8-local-connection-info.tmp"), Encoding.UTF8);
        var m = Regex.Match(info, "u8用户名：(?<u>[^，]+)，密码：(?<p>[^，]+).*服务器地址：(?<s>[\\d.]+)");
        if (!m.Success) throw new Exception("Cannot parse U8 connection info");
        var login = new clsLoginClass();
        string sub = "AS", account = "(default)@006", year = "2026", user = m.Groups["u"].Value, password = m.Groups["p"].Value, date = DateTime.Now.ToString("yyyy-MM-dd"), server = m.Groups["s"].Value, serial = "";
        if (!login.Login(ref sub, ref account, ref year, ref user, ref password, ref date, ref server, ref serial)) throw new Exception("U8 login failed: " + login.ShareString);
        return login;
    }

    static void Set(ExtensionItem item, string field, object value)
    {
        try { item[field] = value; }
        catch (Exception ex) { throw new Exception("Failed assigning field " + field + ": " + ex.Message, ex); }
    }

    static string NextCode(int n) { return n.ToString("D10", CultureInfo.InvariantCulture); }

    static bool BoolFlag(DataRow r, string name)
    {
        var s = S(r, name);
        return string.Equals(s, "True", StringComparison.OrdinalIgnoreCase) || s == "1";
    }

    static void BuildOpTransform(ExtensionBusinessEntity extbo, DataRow detail, DataRow outRoute, DataRow inRoute, string docCode, decimal qty, string opStatus)
    {
        var h = extbo[0];
        string q = qty.ToString("0.##########", CultureInfo.InvariantCulture);
        string nowDate = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string nowTime = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture);

        Set(h, "TransformId", "");
        Set(h, "DocCode", docCode);
        Set(h, "DocDate", nowDate);
        Set(h, "DocTime", nowTime);
        Set(h, "TransformType", "1"); // sfc_optransform 真实 FC92 样例均为 1；FC03094 界面 TransType=0 是筛选参数
        Set(h, "MoCode", MoCode);
        Set(h, "SortSeq", S(detail, "SortSeq"));
        Set(h, "OpSeq", S(outRoute, "OpSeq"));
        Set(h, "OpStatus", opStatus);
        Set(h, "InOpSeq", S(inRoute, "OpSeq"));

        Set(h, "InvCode", InvCode);
        Set(h, "InvName", S(detail, "cInvName"));
        Set(h, "InvStd", S(detail, "cInvStd"));
        Set(h, "InvUnit", S(detail, "cComUnitName"));
        Set(h, "MoQty", q);
        Set(h, "AuxQty", "0");
        Set(h, "MoId", S(detail, "MoId"));
        Set(h, "MoDId", S(detail, "MoDId"));
        Set(h, "MoRoutingId", S(outRoute, "MoRoutingId"));
        Set(h, "MoRoutingDId", S(outRoute, "MoRoutingDId"));
        Set(h, "InMoRoutingDId", S(inRoute, "MoRoutingDId"));
        Set(h, "MoLotCode", S(detail, "MoLotCode"));
        Set(h, "SoCode", S(detail, "SoCode"));
        Set(h, "SoSeq", S(detail, "SoSeq"));

        Set(h, "OpSeqDesc", S(outRoute, "RoutingDescription"));
        Set(h, "WcCode", S(outRoute, "WcCode"));
        Set(h, "WcName", S(outRoute, "WcName"));
        Set(h, "SubFlag", BoolFlag(outRoute, "SubFlag") ? "1" : "0");
        Set(h, "InOpSeqDesc", S(inRoute, "RoutingDescription"));
        Set(h, "InWcCode", S(inRoute, "WcCode"));
        Set(h, "InWcName", S(inRoute, "WcName"));
        Set(h, "InSubFlag", BoolFlag(inRoute, "SubFlag") ? "1" : "0");
        Set(h, "ReportPoint", BoolFlag(outRoute, "ReportFlag") ? "1" : "0");
        Set(h, "OpTransType", "0");

        Set(h, "UseQty", q);
        Set(h, "MachiningQty", "0");
        Set(h, "DeclareQty", "0");
        Set(h, "TransOutQty", q);
        Set(h, "QualifiedQty", q);
        Set(h, "RefusedQty", "0");
        Set(h, "ScrapQty", "0");
    }

    static string JsonEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    static void AppendTable(StringBuilder sb, string name, DataTable t, bool trailingComma)
    {
        sb.AppendLine("  \"" + name + "\": [");
        for (int i = 0; i < t.Rows.Count; i++)
        {
            var r = t.Rows[i];
            sb.Append("    {");
            for (int c = 0; c < t.Columns.Count; c++)
            {
                var col = t.Columns[c].ColumnName;
                sb.Append("\"" + JsonEscape(col) + "\": \"" + JsonEscape(S(r, col)) + "\"");
                if (c < t.Columns.Count - 1) sb.Append(", ");
            }
            sb.Append("}");
            sb.AppendLine(i == t.Rows.Count - 1 ? "" : ",");
        }
        sb.AppendLine("  ]" + (trailingComma ? "," : ""));
    }

    static void WriteResult(string path, string mode, string status, string docCode, string message, DataSet target, DataSet sample, DataSet after)
    {
        var sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"mode\": \"" + JsonEscape(mode) + "\",");
        sb.AppendLine("  \"status\": \"" + JsonEscape(status) + "\",");
        sb.AppendLine("  \"moCode\": \"" + MoCodeWithSeq + "\",");
        sb.AppendLine("  \"invCode\": \"" + InvCode + "\",");
        sb.AppendLine("  \"docCode\": \"" + JsonEscape(docCode) + "\",");
        sb.AppendLine("  \"message\": \"" + JsonEscape(message) + "\",");
        AppendTable(sb, "targetOrderDetail", target.Tables[0], true);
        AppendTable(sb, "targetRoutes", target.Tables[1], true);
        AppendTable(sb, "existingTargetBills", target.Tables[2], true);
        AppendTable(sb, "existingTargetTransforms", target.Tables[3], true);
        AppendTable(sb, "sampleFc92Bill", sample.Tables[0], true);
        AppendTable(sb, "sampleFc92Details", sample.Tables[1], true);
        AppendTable(sb, "sampleFc92Transforms", sample.Tables[2], after != null);
        if (after != null)
        {
            AppendTable(sb, "afterTransforms", after.Tables[0], true);
            AppendTable(sb, "afterBills", after.Tables[1], true);
            AppendTable(sb, "afterRoutes", after.Tables[2], false);
        }
        sb.AppendLine("}");
        File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
    }

    static void ValidateTarget(DataSet target)
    {
        if (target.Tables[0].Rows.Count != 1) throw new Exception("Expected exactly one target order detail, got " + target.Tables[0].Rows.Count);
        if (target.Tables[1].Rows.Count < 2) throw new Exception("Expected at least two routing rows, got " + target.Tables[1].Rows.Count);
        var detail = target.Tables[0].Rows[0];
        if (S(detail, "SortSeq") != "1") throw new Exception("Expected SortSeq=1 for " + MoCodeWithSeq + ", got " + S(detail, "SortSeq"));
        if (Dec(detail, "Qty") != ExpectedQty) throw new Exception("Expected Qty=" + ExpectedQty + ", got " + S(detail, "Qty"));
        if (S(target.Tables[1].Rows[0], "OpSeq") != "0010" || S(target.Tables[1].Rows[1], "OpSeq") != "0020") throw new Exception("Unexpected first two operation sequence values.");
    }

    static DataRow OutRouteForStep(DataTable routes, int step)
    {
        return step == 0 ? routes.Rows[0] : routes.Rows[step - 1];
    }

    static DataRow InRouteForStep(DataTable routes, int step)
    {
        return routes.Rows[step];
    }

    static string OpStatusForStep(int step)
    {
        return step == 0 ? "1" : "3";
    }

    static void InvokeSingleOpTransform(clsLogin login, DataRow detail, DataTable routes, int step, int firstDocNumber)
    {
        U8ApiBroker add = null;
        try
        {
            add = Broker(login, "U8API/OpTransform/OpTransformAdd");
            var extbo = add.GetExtBoEntity("extbo");
            var docCode = NextCode(firstDocNumber + step);
            BuildOpTransform(extbo, detail, OutRouteForStep(routes, step), InRouteForStep(routes, step), docCode, ExpectedQty, OpStatusForStep(step));
            if (!add.Invoke()) throw new Exception("OpTransformAdd Invoke failed at step " + step + ": " + add.GetExceptionString());
            var ret = Convert.ToBoolean(add.GetReturnValue());
            if (!ret) throw new Exception("OpTransformAdd returned false at step " + step + ": " + add.GetExceptionString());
        }
        finally
        {
            if (add != null) try { add.Release(); } catch { }
        }
    }

    static void MainCore(string[] args)
    {
        ResolveAssemblies();
        Directory.CreateDirectory(Work);
        var mode = args.Length > 0 ? args[0].ToLowerInvariant() : "preflight";
        if (mode != "preflight" && mode != "execute") throw new Exception("Mode must be preflight or execute.");

        DataSet target;
        DataSet sample;
        using (var conn = OpenSql())
        {
            target = QueryTarget(conn);
            sample = QueryFc92Sample(conn);
        }
        ValidateTarget(target);

        var detail = target.Tables[0].Rows[0];
        var routes = target.Tables[1];
        int beforeTransform = IntVal(target.Tables[4], "MaxTransformId");
        int beforeMid = IntVal(target.Tables[6], "MaxMID");
        int firstDocNumber = IntVal(target.Tables[5], "MaxTransformDocCode") + 1;
        string firstDocCode = NextCode(firstDocNumber);
        string lastDocCode = NextCode(firstDocNumber + routes.Rows.Count - 1);
        string docCodeRange = firstDocCode == lastDocCode ? firstDocCode : firstDocCode + "-" + lastDocCode;
        var resultPath = Path.Combine(Work, "u8-optransform-report-add-J260900117-0001-23992114020302-" + mode + ".result.json");

        var login = Login();
        try
        {
            if (mode == "preflight")
            {
                for (int step = 0; step < routes.Rows.Count; step++)
                {
                    U8ApiBroker preBroker = null;
                    try
                    {
                        preBroker = Broker(login, "U8API/OpTransform/OpTransformAdd");
                        var extbo = preBroker.GetExtBoEntity("extbo");
                        BuildOpTransform(extbo, detail, OutRouteForStep(routes, step), InRouteForStep(routes, step), NextCode(firstDocNumber + step), ExpectedQty, OpStatusForStep(step));
                    }
                    finally
                    {
                        if (preBroker != null) try { preBroker.Release(); } catch { }
                    }
                }
                WriteResult(resultPath, mode, "BuiltOnly", docCodeRange, "Built three OpTransformAdd extbo items; Invoke was not called.", target, sample, null);
                Console.WriteLine("preflight ok docCodes " + docCodeRange + " " + MoCodeWithSeq + " " + InvCode + " qty " + ExpectedQty.ToString("0.##########", CultureInfo.InvariantCulture) + " steps " + routes.Rows.Count);
                return;
            }

            var guard = Path.Combine(Work, GuardName);
            if (File.Exists(guard)) throw new Exception("Write guard exists; refusing duplicate OpTransformAdd.");
            File.WriteAllText(guard, "attempted=1\r\nstartedAt=" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "\r\ndocCodes=" + docCodeRange + "\r\n", Encoding.UTF8);

            for (int step = 0; step < routes.Rows.Count; step++)
            {
                InvokeSingleOpTransform(login, detail, routes, step, firstDocNumber);
            }

            DataSet after;
            using (var conn = OpenSql()) after = QueryAfter(conn, Convert.ToInt32(detail["MoDId"], CultureInfo.InvariantCulture), beforeTransform, beforeMid);
            if (after.Tables[0].Rows.Count != routes.Rows.Count) throw new Exception("Read-back verification failed: expected " + routes.Rows.Count + " new sfc_optransform rows, got " + after.Tables[0].Rows.Count + ".");
            for (int i = 0; i < after.Tables[0].Rows.Count; i++)
            {
                var created = after.Tables[0].Rows[i];
                if (S(created, "MoDId") != S(detail, "MoDId") || Dec(created, "QualifiedQty") != ExpectedQty || S(created, "TransformType") != "1")
                    throw new Exception("Read-back verification failed at created row " + i + ".");
            }
            WriteResult(resultPath, mode, "CreatedAndVerified", docCodeRange, "OpTransformAdd returned true for all operation-transfer rows and readback found the expected new sfc_optransform rows.", target, sample, after);
            File.AppendAllText(guard, "completedAt=" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "\r\nresultPath=" + resultPath + "\r\n", Encoding.UTF8);
            Console.WriteLine("created and verified OpTransform docs " + docCodeRange + " for " + MoCodeWithSeq + " " + InvCode + " qty " + ExpectedQty.ToString("0.##########", CultureInfo.InvariantCulture));
        }
        finally
        {
            try { login.ShutDown(); } catch { }
            try { Marshal.FinalReleaseComObject(login); } catch { }
        }
    }
    static void Main(string[] args)
    {
        try { MainCore(args); }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.GetType().FullName);
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine(ex.StackTrace);
            Environment.ExitCode = 1;
        }
    }
}
