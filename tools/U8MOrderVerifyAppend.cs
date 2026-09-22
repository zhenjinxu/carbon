using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8APIFramework.Parameter;
using U8Login;

internal static class U8MOrderVerifyAppend
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
            if (!broker.Invoke() || !Convert.ToBoolean(broker.GetReturnValue())) throw new Exception("MOrderLoad failed for " + code + ": " + broker.GetExceptionString());
            return broker.GetExtBoEntity("extbo");
        }
        finally { try { broker.Release(); } catch { } }
    }

    static string Value(ExtensionItem item, string field)
    {
        try { return Convert.ToString(item[field]) ?? ""; } catch { return ""; }
    }

    static void CompareFields(ExtensionBusinessEntity entity, ExtensionItem expected, ExtensionItem actual, HashSet<string> excluded, List<string> differences, string path)
    {
        foreach (var field in entity.ExtensionBOMeta.MainFields)
        {
            if (excluded.Contains(field.Name)) continue;
            var left = Value(expected, field.Name);
            var right = Value(actual, field.Name);
            if (!String.Equals(left, right, StringComparison.Ordinal)) differences.Add(path + "." + field.Name + ": " + left + " != " + right);
        }
    }

    static void MainCore()
    {
        var info = File.ReadAllText(Path.Combine(Work, "u8-local-connection-info.tmp"));
        var match = System.Text.RegularExpressions.Regex.Match(info, "u8用户名：(?<u>[^，]+)，密码：(?<p>[^，]+).*服务器地址：(?<s>[\\d.]+)");
        if (!match.Success) throw new Exception("Cannot parse U8 connection info");
        var login = new clsLoginClass();
        string sub = "AS", account = "(default)@006", year = "2026", user = match.Groups["u"].Value, password = match.Groups["p"].Value, date = DateTime.Now.ToString("yyyy-MM-dd"), server = match.Groups["s"].Value, serial = "";
        if (!login.Login(ref sub, ref account, ref year, ref user, ref password, ref date, ref server, ref serial)) throw new Exception("U8 login failed");
        try
        {
            var source = Load(login, "J260900063");
            var target = Load(login, "J260900193");
            var sourceDetails = source[0].SubEntity["Mom_OrderDetail"];
            var targetDetails = target[0].SubEntity["Mom_OrderDetail"];
            if (sourceDetails.ItemCount != 2) throw new Exception("Source detail count is " + sourceDetails.ItemCount + ", expected 2.");
            if (targetDetails.ItemCount != 2) throw new Exception("Target detail count is " + targetDetails.ItemCount + ", expected 2.");
            if (Value(targetDetails[0], "DInvCode") != "19260501030302" || Value(targetDetails[0], "DQty") != "10") throw new Exception("Target first detail changed unexpectedly.");
            if (Value(sourceDetails[1], "DInvCode") != "1192430110500" || Value(sourceDetails[1], "DQty") != "2") throw new Exception("Source second detail changed unexpectedly.");
            if (Value(targetDetails[1], "DInvCode") != "1192430110500" || Value(targetDetails[1], "DQty") != "2") throw new Exception("Target second detail identity/quantity mismatch.");

            var excluded = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "DMoDId", "DRelsUser", "DRelsDate", "DRelsTime", "DCloseUser", "DCloseDate", "DCloseTime" };
            var differences = new List<string>();
            CompareFields(sourceDetails, sourceDetails[1], targetDetails[1], excluded, differences, "detail");
            var sourceAllocations = sourceDetails[1].SubEntity["Mom_MoAllocate"];
            var targetAllocations = targetDetails[1].SubEntity["Mom_MoAllocate"];
            if (sourceAllocations.ItemCount != 7 || targetAllocations.ItemCount != 7) throw new Exception("Allocation count mismatch: source=" + sourceAllocations.ItemCount + " target=" + targetAllocations.ItemCount);
            for (var i = 0; i < sourceAllocations.ItemCount; i++) CompareFields(sourceAllocations, sourceAllocations[i], targetAllocations[i], new HashSet<string>(StringComparer.OrdinalIgnoreCase), differences, "allocation[" + i + "]");
            if (differences.Count != 0) throw new Exception("Business-field differences: " + String.Join("; ", differences.ToArray()));
            Console.WriteLine("verified sourceDetails=2 targetDetails=2 first=19260501030302x10 second=1192430110500x2 allocations=7 differences=0");
        }
        finally { try { login.ShutDown(); } catch { } try { Marshal.FinalReleaseComObject(login); } catch { } }
    }
    static void Main()
    {
        try { MainCore(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().FullName); Console.Error.WriteLine(ex.Message); Console.Error.WriteLine(ex.StackTrace); Environment.ExitCode = 1; }
    }
}
