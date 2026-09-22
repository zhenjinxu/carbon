using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8APIFramework.Parameter;
using U8Login;

internal static class U8MOrderOperationProbe
{
    const string Work = @"D:\Object\carbon\.codex\work";

    static void ResolveAssemblies()
    {
        AppDomain.CurrentDomain.AssemblyResolve += (sender, args) =>
        {
            var name = new AssemblyName(args.Name).Name + ".dll";
            foreach (var dir in new[] { @"D:\U8SOFT\UFMOM\U8APIFramework", @"D:\U8SOFT\Interop", @"D:\Object\carbon\tools" })
            {
                var path = Path.Combine(dir, name);
                if (File.Exists(path)) return Assembly.LoadFrom(path);
            }
            return null;
        };
    }

    static U8ApiBroker Broker(clsLogin login, string api)
    {
        return new U8ApiBroker(new U8ApiAddress(api), new U8EnvContext { U8Login = login });
    }

    static ExtensionBusinessEntity Load(clsLogin login, string code)
    {
        var broker = Broker(login, "U8API/MOrder/MOrderLoad");
        try
        {
            broker.AssignNormalValue("mocode", code);
            if (!broker.Invoke() || !Convert.ToBoolean(broker.GetReturnValue())) throw new Exception("MOrderLoad failed: " + broker.GetExceptionString());
            return broker.GetExtBoEntity("extbo");
        }
        finally { try { broker.Release(); } catch { } }
    }

    static string Value(ExtensionItem item, string name)
    {
        try { return Convert.ToString(item[name]) ?? ""; } catch { return ""; }
    }

    static void MainCore()
    {
        ResolveAssemblies();
        var info = File.ReadAllText(Path.Combine(Work, "u8-local-connection-info.tmp"));
        var match = System.Text.RegularExpressions.Regex.Match(info, "u8用户名：(?<u>[^，]+)，密码：(?<p>[^，]+).*服务器地址：(?<s>[\\d.]+)");
        if (!match.Success) throw new Exception("Cannot parse U8 connection info");
        var login = new clsLoginClass();
        string sub = "AS", account = "(default)@006", year = "2026", user = match.Groups["u"].Value, password = match.Groups["p"].Value, date = DateTime.Now.ToString("yyyy-MM-dd"), server = match.Groups["s"].Value, serial = "";
        if (!login.Login(ref sub, ref account, ref year, ref user, ref password, ref date, ref server, ref serial)) throw new Exception("U8 login failed");
        try
        {
            var order = Load(login, "J260900117");
            if (order.ItemCount != 1) throw new Exception("Unexpected order item count: " + order.ItemCount);
            var head = order[0];
            Console.WriteLine("head MoId=" + Value(head, "MoId") + " MoCode=" + Value(head, "MoCode"));
            Console.WriteLine("head subentities=" + String.Join(",", head.SubEntity.Keys));
            var details = head.SubEntity["Mom_OrderDetail"];
            Console.WriteLine("details=" + details.ItemCount);
            for (var i = 0; i < details.ItemCount; i++)
            {
                var detail = details[i];
                if (Value(detail, "DInvCode") != "23992114020302") continue;
                Console.WriteLine("target index=" + i + " DMoDId=" + Value(detail, "DMoDId") + " sort=" + Value(detail, "DSortSeq") + " inv=" + Value(detail, "DInvCode") + " qty=" + Value(detail, "DQty") + " mrp=" + Value(detail, "DMrpQty") + " status=" + Value(detail, "DStatus") + " start=" + Value(detail, "DStartDate") + " due=" + Value(detail, "DDueDate"));
                Console.WriteLine("detail subentities=" + String.Join(",", detail.SubEntity.Keys));
                foreach (var subName in detail.SubEntity.Keys)
                {
                    var child = detail.SubEntity[subName];
                    Console.WriteLine(" child " + subName + " count=" + child.ItemCount);
                    for (var j = 0; j < Math.Min(child.ItemCount, 20); j++)
                    {
                        var row = child[j];
                        Console.WriteLine("  row[" + j + "] fields=" + String.Join(",", new[] { "DOpSeq", "DInOpSeq", "DOpScheduleType", "DWhCode", "DQty", "DStatus", "DPartId", "DRoutingId", "DOpDesc", "DOpUnitName", "DInOpUnitName" }));
                        Console.WriteLine("  values=" + String.Join("|", new[] { Value(row, "DOpSeq"), Value(row, "DInOpSeq"), Value(row, "DOpScheduleType"), Value(row, "DWhCode"), Value(row, "DQty"), Value(row, "DStatus"), Value(row, "DPartId"), Value(row, "DRoutingId"), Value(row, "DOpDesc"), Value(row, "DOpUnitName"), Value(row, "DInOpUnitName") }));
                    }
                }
            }
        }
        finally { try { login.ShutDown(); } catch { } try { Marshal.FinalReleaseComObject(login); } catch { } }
    }

    static void Main()
    {
        try { MainCore(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().FullName); Console.Error.WriteLine(ex.Message); Console.Error.WriteLine(ex.StackTrace); Environment.ExitCode = 1; }
    }
}
