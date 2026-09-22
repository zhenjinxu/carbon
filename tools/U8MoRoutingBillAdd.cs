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

internal static class U8MoRoutingBillAdd
{
    const string Work = @"D:\Object\carbon\.codex\work";
    const string MoCode = "J260900117";
    const string InvCode = "23992114020302";
    const string GuardName = "u8-moroutingbill-add-J260900117-23992114020302-call-count.txt";

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
            var value = line.Substring(i + 1).Trim().Trim('"', '\'');
            env[line.Substring(0, i).Trim()] = value;
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

    static DataSet Query(SqlConnection conn)
    {
        var sql = @"
SET NOCOUNT ON;
SELECT TOP (2) o.MoId, o.MoCode, o.CreateUser, o.CreateDate, o.CreateTime, o.VTid, o.RelsVTid, o.cSysBarCode,
       d.MoDId, d.SortSeq, d.InvCode, d.Qty, d.MrpQty, d.Status, d.AuditStatus, d.RelsUser, d.RelsDate, d.RelsTime,
       d.CloseUser, d.CloseDate, d.MoTypeId, d.SoCode, d.SoSeq, d.MoLotCode,
       i.cInvName, i.cInvStd, i.cComUnitCode, cu.cComUnitName,
       md.StartDate AS DetailStartDate, md.DueDate AS DetailDueDate
FROM dbo.mom_order AS o
JOIN dbo.mom_orderdetail AS d ON d.MoId = o.MoId
LEFT JOIN dbo.Inventory AS i ON i.cInvCode = d.InvCode
LEFT JOIN dbo.ComputationUnit AS cu ON cu.cComunitCode = i.cComUnitCode
LEFT JOIN dbo.mom_morder AS md ON md.MoDId = d.MoDId
WHERE o.MoCode = @moCode AND d.InvCode = @invCode
ORDER BY d.SortSeq, d.MoDId;

SELECT r.MoRoutingId, r.MoId, r.MoDId, r.Qty AS RoutingQty, r.VTid AS RoutingVTid,
       rd.MoRoutingDId, rd.OpSeq, rd.OperationId, op.OpCode, rd.Description AS RoutingDescription, op.Description AS OperationDescription,
       rd.WcId, wc.WcCode, wc.Description AS WcName,
       rd.StartDate, rd.DueDate, rd.StartTime, rd.DueTime,
       rd.SubFlag, rd.LastFlag, rd.FirstFlag, rd.ReportFlag, rd.BFFlag, rd.FeeFlag,
       rd.AuxUnitCode, rd.ChangeRate, rd.SubQty,
       rd.BalMachiningQty, rd.BalQualifiedQty, rd.BalRefusedQty, rd.BalScrapQty, rd.BalDeclareQty,
       rd.QualifiedQty, rd.RefusedQty, rd.ScrapQty, rd.ReworkQty, rd.CompleteQty, rd.ShiftQty, rd.ReportQty,
       rd.DutyClassCode, rd.WorkOnFalg, rd.WorkOnUser, rd.WorkOnDate
FROM dbo.sfc_morouting AS r
JOIN dbo.sfc_moroutingdetail AS rd ON rd.MoRoutingId = r.MoRoutingId
LEFT JOIN dbo.sfc_operation AS op ON op.OperationId = rd.OperationId
LEFT JOIN dbo.sfc_workcenter AS wc ON wc.WcId = rd.WcId
WHERE r.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY rd.OpSeq, rd.MoRoutingDId;

SELECT b.MID, b.cVouchCode, b.cVouchDate, b.cVouchTime, b.CreateUser, b.CreateDate, b.CreateTime,
       b.MoId, b.MoDId, b.WcId, b.TransType, b.SortType, b.OutQcFlag, b.cVouchType, b.VT_ID,
       bd.MDId, bd.MoRoutingId, bd.MoRoutingDId, bd.OutMoRoutingDId, bd.TransformId, bd.OpSeq, bd.OpCode, bd.opDescription, bd.OpStatus,
       bd.QualifiedQty, bd.MachiningQty, bd.RefusedQty, bd.ScrapQty, bd.DeclareQty, bd.fAvaQuantity, bd.Status, bd.TMId
FROM dbo.fc_MoRoutingBill AS b
JOIN dbo.fc_MoRoutingBilldetail AS bd ON bd.MID = b.MID
WHERE bd.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY b.MID DESC, bd.MDId DESC;

SELECT t.TransformId, t.DocCode, t.DocDate, t.DocTime, t.MoId, t.MoDId, t.MoRoutingId, t.MoRoutingDId, t.InMoRoutingDId,
       t.TransformType, t.OpStatus, t.TransOutQty, t.QualifiedQty, t.MachiningQty, t.RefusedQty, t.ScrapQty, t.DeclareQty,
       t.CreateUser, t.CreateDate, t.CreateTime, t.Status, t.PFReportId, t.PFReportDId, t.RefDocCode, t.RefDocDId
FROM dbo.sfc_optransform AS t
WHERE t.MoDId IN (SELECT d.MoDId FROM dbo.mom_order AS o JOIN dbo.mom_orderdetail AS d ON d.MoId=o.MoId WHERE o.MoCode=@moCode AND d.InvCode=@invCode)
ORDER BY t.TransformId DESC;

SELECT ISNULL(MAX(MID),0) AS MaxMID FROM dbo.fc_MoRoutingBill;
SELECT ISNULL(MAX(TransformId),0) AS MaxTransformId FROM dbo.sfc_optransform;
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

    static DataTable QueryAfter(SqlConnection conn, int moDId, int beforeMid, int beforeTransform)
    {
        var sql = @"
SELECT b.MID, b.cVouchCode, b.cVouchDate, b.cVouchTime, b.CreateUser, b.CreateDate, b.CreateTime,
       b.TransType, b.SortType, b.OutQcFlag, b.cVouchType, b.VT_ID,
       bd.MDId, bd.MoId, bd.MoDId, bd.MoRoutingId, bd.MoRoutingDId, bd.OutMoRoutingDId, bd.TransformId, bd.OpSeq, bd.OpCode, bd.opDescription, bd.OpStatus,
       bd.QualifiedQty, bd.MachiningQty, bd.RefusedQty, bd.ScrapQty, bd.DeclareQty, bd.fAvaQuantity, bd.Status, bd.TMId
FROM dbo.fc_MoRoutingBill AS b
JOIN dbo.fc_MoRoutingBilldetail AS bd ON bd.MID = b.MID
WHERE bd.MoDId = @moDId AND b.MID > @beforeMid
ORDER BY b.MID, bd.MDId;
SELECT t.TransformId, t.DocCode, t.DocDate, t.DocTime, t.MoId, t.MoDId, t.MoRoutingId, t.MoRoutingDId, t.InMoRoutingDId,
       t.TransformType, t.OpStatus, t.TransOutQty, t.QualifiedQty, t.MachiningQty, t.RefusedQty, t.ScrapQty, t.DeclareQty,
       t.CreateUser, t.CreateDate, t.CreateTime, t.Status, t.RefDocCode, t.RefDocDId
FROM dbo.sfc_optransform AS t
WHERE t.MoDId = @moDId AND t.TransformId > @beforeTransform
ORDER BY t.TransformId;
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
            da.SelectCommand.Parameters.Add("@beforeMid", SqlDbType.Int).Value = beforeMid;
            da.SelectCommand.Parameters.Add("@beforeTransform", SqlDbType.Int).Value = beforeTransform;
            da.Fill(ds);
        }
        var merged = new DataTable("after");
        merged.Columns.Add("kind");
        foreach (DataTable t in ds.Tables)
        {
            foreach (DataColumn c in t.Columns) if (!merged.Columns.Contains(c.ColumnName)) merged.Columns.Add(c.ColumnName);
        }
        string[] kinds = { "bill", "transform", "route" };
        for (int i = 0; i < ds.Tables.Count; i++)
        {
            foreach (DataRow r in ds.Tables[i].Rows)
            {
                var nr = merged.NewRow();
                nr["kind"] = kinds[i];
                foreach (DataColumn c in ds.Tables[i].Columns) nr[c.ColumnName] = r[c];
                merged.Rows.Add(nr);
            }
        }
        return merged;
    }

    static string S(DataRow r, string name)
    {
        if (!r.Table.Columns.Contains(name) || r[name] == DBNull.Value) return "";
        if (r[name] is DateTime) return ((DateTime)r[name]).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        if (r[name] is decimal) return ((decimal)r[name]).ToString("0.##########", CultureInfo.InvariantCulture);
        if (r[name] is double) return ((double)r[name]).ToString("0.##########", CultureInfo.InvariantCulture);
        return Convert.ToString(r[name], CultureInfo.InvariantCulture) ?? "";
    }

    static string DateOnly(DataRow r, string name)
    {
        if (!r.Table.Columns.Contains(name) || r[name] == DBNull.Value) return "";
        if (r[name] is DateTime) return ((DateTime)r[name]).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return S(r, name);
    }

    static decimal Dec(DataRow r, string name)
    {
        var s = S(r, name);
        return s.Length == 0 ? 0m : decimal.Parse(s, CultureInfo.InvariantCulture);
    }

    static int IntVal(DataRow r, string name) { return Convert.ToInt32(r[name], CultureInfo.InvariantCulture); }

    static U8ApiBroker Broker(clsLogin login, string api)
    {
        return new U8ApiBroker(new U8ApiAddress(api), new U8EnvContext { U8Login = login });
    }

    static void Set(ExtensionItem item, string field, object value)
    {
        try { item[field] = value; }
        catch (Exception ex) { throw new Exception("Failed assigning field " + field + ": " + ex.Message, ex); }
    }

    static string BillCode(int n) { return n.ToString("D10", CultureInfo.InvariantCulture); }

    static void BuildExtBo(ExtensionBusinessEntity extbo, DataRow detail, DataTable routes, string billCode)
    {
        var qty = Dec(detail, "Qty").ToString("0.##########", CultureInfo.InvariantCulture);
        var h = extbo[0];
        Set(h, "mid", "");
        Set(h, "cvouchcode", billCode);
        Set(h, "cvouchdate", DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        Set(h, "mocode", MoCode);
        Set(h, "moseq", S(detail, "SortSeq"));
        Set(h, "cvouchtime", DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture));
        Set(h, "startdate", DateOnly(detail, "DetailStartDate"));
        Set(h, "duedate", DateOnly(detail, "DetailDueDate"));
        Set(h, "invcode", InvCode);
        Set(h, "invname", S(detail, "cInvName"));
        Set(h, "invstd", S(detail, "cInvStd"));
        Set(h, "moqty", qty);
        Set(h, "unitcode", S(detail, "cComUnitCode"));
        Set(h, "outqcflag", "0");
        Set(h, "moid", S(detail, "MoId"));
        Set(h, "modid", S(detail, "MoDId"));
        Set(h, "cvouchtype", "FC92");
        Set(h, "vt_id", "31066");

        var fc = h.SubEntity["fc_moroutingbilldetail"];
        for (int i = 0; i < routes.Rows.Count; i++)
        {
            var dst = routes.Rows[i];
            var src = i == 0 ? routes.Rows[i] : routes.Rows[i - 1];
            var row = i == 0 ? fc[0] : fc.NewItem();
            var opStatus = i == 0 ? "1" : "3";
            var useQty = i == 0 ? qty : "0";
            Set(row, "mocode", MoCode);
            Set(row, "moseq", S(detail, "SortSeq"));
            Set(row, "opseq", S(src, "OpSeq"));
            Set(row, "opseqdesc", S(src, "RoutingDescription"));
            Set(row, "opstatus", opStatus);
            Set(row, "inopseq", S(dst, "OpSeq"));
            Set(row, "inopseqdesc", S(dst, "RoutingDescription"));
            Set(row, "mid", "");
            Set(row, "mdid", "");
            Set(row, "transformid", "");
            Set(row, "moid", S(detail, "MoId"));
            Set(row, "modid", S(detail, "MoDId"));
            Set(row, "invcode", InvCode);
            Set(row, "invname", S(detail, "cInvName"));
            Set(row, "invstd", S(detail, "cInvStd"));
            Set(row, "moqty", qty);
            Set(row, "invunit", S(detail, "cComUnitName"));
            Set(row, "molotcode", S(detail, "MoLotCode"));
            Set(row, "moroutingid", S(dst, "MoRoutingId"));
            Set(row, "outmoroutingdid", S(src, "MoRoutingDId"));
            Set(row, "wcid", S(src, "WcId"));
            Set(row, "wccode", S(src, "WcCode"));
            Set(row, "wcname", S(src, "WcName"));
            Set(row, "subflag", S(src, "SubFlag") == "True" ? "1" : "0");
            Set(row, "moroutingdid", S(dst, "MoRoutingDId"));
            Set(row, "inwcid", S(dst, "WcId"));
            Set(row, "inwccode", S(dst, "WcCode"));
            Set(row, "inwcname", S(dst, "WcName"));
            Set(row, "useqty", useQty);
            Set(row, "shiftqty", S(dst, "ShiftQty"));
            Set(row, "completedqty", S(dst, "CompleteQty"));
            Set(row, "uncompletedqty", qty);
            Set(row, "machiningqty", "0");
            Set(row, "qualifiedqty", qty);
            Set(row, "refusedqty", "0");
            Set(row, "scrapqty", "0");
            Set(row, "declareqty", "0");
            Set(row, "balmachiningqty", i == 0 ? S(dst, "BalMachiningQty") : "0");
            Set(row, "balqualifiedqty", S(dst, "BalQualifiedQty"));
            Set(row, "balrefusedqty", S(dst, "BalRefusedQty"));
            Set(row, "balscrapqty", S(dst, "BalScrapQty"));
            Set(row, "baldeclareqty", S(dst, "BalDeclareQty"));
            Set(row, "totalmachiningqty", S(dst, "ReportQty"));
            Set(row, "totalqualifiedqty", S(dst, "QualifiedQty"));
            Set(row, "totalrefusedqty", S(dst, "RefusedQty"));
            Set(row, "totalscrapqty", S(dst, "ScrapQty"));
            Set(row, "totaldeclareqty", "0");
            Set(row, "startdate", DateOnly(dst, "StartDate"));
            Set(row, "duedate", DateOnly(dst, "DueDate"));
            Set(row, "actualstartdate", DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            Set(row, "actualduedate", DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            Set(row, "socode", S(detail, "SoCode"));
            Set(row, "soseq", S(detail, "SoSeq"));
            Set(row, "motypedesc", "");
            Set(row, "DOpCode", S(src, "OpCode"));
            Set(row, "DInOpCode", S(dst, "OpCode"));
        }
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

    static string JsonEscape(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    static void WriteResult(string path, string mode, string status, string billCode, DataRow detail, DataTable routes, DataTable after, string message)
    {
        var sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"mode\": \"" + JsonEscape(mode) + "\",");
        sb.AppendLine("  \"status\": \"" + JsonEscape(status) + "\",");
        sb.AppendLine("  \"moCode\": \"" + MoCode + "\",");
        sb.AppendLine("  \"invCode\": \"" + InvCode + "\",");
        sb.AppendLine("  \"billCode\": \"" + JsonEscape(billCode) + "\",");
        sb.AppendLine("  \"message\": \"" + JsonEscape(message) + "\",");
        sb.AppendLine("  \"detail\": { \"MoId\": \"" + S(detail, "MoId") + "\", \"MoDId\": \"" + S(detail, "MoDId") + "\", \"SortSeq\": \"" + S(detail, "SortSeq") + "\", \"Qty\": \"" + S(detail, "Qty") + "\", \"Status\": \"" + S(detail, "Status") + "\", \"AuditStatus\": \"" + S(detail, "AuditStatus") + "\" },");
        sb.AppendLine("  \"routes\": [");
        for (int i = 0; i < routes.Rows.Count; i++)
        {
            var r = routes.Rows[i];
            sb.Append("    { \"OpSeq\": \"" + S(r, "OpSeq") + "\", \"MoRoutingDId\": \"" + S(r, "MoRoutingDId") + "\", \"WcCode\": \"" + JsonEscape(S(r, "WcCode")) + "\", \"BalMachiningQty\": \"" + S(r, "BalMachiningQty") + "\", \"QualifiedQty\": \"" + S(r, "QualifiedQty") + "\" }");
            sb.AppendLine(i == routes.Rows.Count - 1 ? "" : ",");
        }
        sb.AppendLine("  ],");
        sb.AppendLine("  \"after\": [");
        if (after != null)
        {
            for (int i = 0; i < after.Rows.Count; i++)
            {
                var r = after.Rows[i];
                sb.Append("    { \"kind\": \"" + S(r, "kind") + "\", \"MID\": \"" + S(r, "MID") + "\", \"cVouchCode\": \"" + S(r, "cVouchCode") + "\", \"MDId\": \"" + S(r, "MDId") + "\", \"TransformId\": \"" + S(r, "TransformId") + "\", \"OpSeq\": \"" + S(r, "OpSeq") + "\", \"MoRoutingDId\": \"" + S(r, "MoRoutingDId") + "\", \"OutMoRoutingDId\": \"" + S(r, "OutMoRoutingDId") + "\", \"InMoRoutingDId\": \"" + S(r, "InMoRoutingDId") + "\", \"OpStatus\": \"" + S(r, "OpStatus") + "\", \"QualifiedQty\": \"" + S(r, "QualifiedQty") + "\", \"TransOutQty\": \"" + S(r, "TransOutQty") + "\", \"Status\": \"" + S(r, "Status") + "\" }");
                sb.AppendLine(i == after.Rows.Count - 1 ? "" : ",");
            }
        }
        sb.AppendLine("  ]");
        sb.AppendLine("}");
        File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
    }

    static void MainCore(string[] args)
    {
        ResolveAssemblies();
        Directory.CreateDirectory(Work);
        var mode = args.Length > 0 ? args[0].ToLowerInvariant() : "preflight";
        if (mode != "preflight" && mode != "execute") throw new Exception("Mode must be preflight or execute.");

        DataSet ds;
        using (var conn = OpenSql()) ds = Query(conn);
        var detailRows = ds.Tables[0];
        var routes = ds.Tables[1];
        var existingBills = ds.Tables[2];
        var existingTransforms = ds.Tables[3];
        if (detailRows.Rows.Count != 1) throw new Exception("Expected exactly one target order detail, got " + detailRows.Rows.Count);
        if (routes.Rows.Count != 3) throw new Exception("Expected exactly three routing rows, got " + routes.Rows.Count);
        if (S(routes.Rows[0], "OpSeq") != "0010" || S(routes.Rows[1], "OpSeq") != "0020" || S(routes.Rows[2], "OpSeq") != "0030") throw new Exception("Unexpected routing sequence.");
        if (Dec(detailRows.Rows[0], "Qty") != 672m) throw new Exception("Target quantity changed; expected 672, got " + S(detailRows.Rows[0], "Qty"));
        if (existingBills.Rows.Count != 0 || existingTransforms.Rows.Count != 0) throw new Exception("Existing report/transform rows found; refusing duplicate.");
        if (Dec(routes.Rows[0], "BalMachiningQty") < Dec(detailRows.Rows[0], "Qty")) throw new Exception("Available first operation machining qty is less than target qty.");
        var beforeMid = IntVal(ds.Tables[4].Rows[0], "MaxMID");
        var beforeTransform = IntVal(ds.Tables[5].Rows[0], "MaxTransformId");
        var nextCode = BillCode(IntVal(ds.Tables[6].Rows[0], "MaxBillCode") + 1);

        var login = Login();
        U8ApiBroker add = null;
        DataTable after = null;
        var resultPath = Path.Combine(Work, "u8-moroutingbill-add-J260900117-23992114020302-" + mode + ".result.json");
        try
        {
            add = Broker(login, "U8API/MoRoutingBill/MoRoutingBillAdd");
            var extbo = add.GetExtBoEntity("extbo");
            BuildExtBo(extbo, detailRows.Rows[0], routes, nextCode);
            if (mode == "preflight")
            {
                WriteResult(resultPath, mode, "BuiltOnly", nextCode, detailRows.Rows[0], routes, null, "Built MoRoutingBillAdd extbo; Invoke was not called.");
                Console.WriteLine("preflight ok billCode " + nextCode + " routes " + routes.Rows.Count + " qty " + S(detailRows.Rows[0], "Qty"));
                return;
            }

            var guard = Path.Combine(Work, GuardName);
            if (File.Exists(guard)) throw new Exception("Write guard exists; refusing duplicate MoRoutingBillAdd.");
            File.WriteAllText(guard, "attempted=1\r\nstartedAt=" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "\r\nbillCode=" + nextCode + "\r\n", Encoding.UTF8);
            if (!add.Invoke()) throw new Exception("MoRoutingBillAdd Invoke failed: " + add.GetExceptionString());
            var ret = Convert.ToBoolean(add.GetReturnValue());
            if (!ret) throw new Exception("MoRoutingBillAdd returned false: " + add.GetExceptionString());
            using (var conn = OpenSql()) after = QueryAfter(conn, IntVal(detailRows.Rows[0], "MoDId"), beforeMid, beforeTransform);
            int billRows = 0, transformRows = 0;
            foreach (DataRow r in after.Rows)
            {
                if (S(r, "kind") == "bill") billRows++;
                if (S(r, "kind") == "transform") transformRows++;
            }
            if (billRows != 3 || transformRows != 3) throw new Exception("Read-back verification failed: billRows=" + billRows + ", transformRows=" + transformRows);
            WriteResult(resultPath, mode, "CreatedAndVerified", nextCode, detailRows.Rows[0], routes, after, "MoRoutingBillAdd returned true and readback found 3 bill rows plus 3 transforms.");
            File.AppendAllText(guard, "completedAt=" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "\r\nresultPath=" + resultPath + "\r\n", Encoding.UTF8);
            Console.WriteLine("created and verified report " + nextCode + " for " + MoCode + "-" + S(detailRows.Rows[0], "SortSeq") + " " + InvCode + " qty " + S(detailRows.Rows[0], "Qty"));
        }
        finally
        {
            if (add != null) try { add.Release(); } catch { }
            try { login.ShutDown(); } catch { }
            try { Marshal.FinalReleaseComObject(login); } catch { }
        }
    }

    static void Main(string[] args)
    {
        try { MainCore(args); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().FullName); Console.Error.WriteLine(ex.Message); Console.Error.WriteLine(ex.StackTrace); Environment.ExitCode = 1; }
    }
}
