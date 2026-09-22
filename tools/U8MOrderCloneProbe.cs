using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8APIFramework.Parameter;
using U8Login;

internal static class U8MOrderCloneProbe
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

    static U8ApiBroker Broker(clsLogin login, string api) { return new U8ApiBroker(new U8ApiAddress(api), new U8EnvContext { U8Login = login }); }

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

    static void Main()
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
            var source = Load(login, "J260900063");
            var target = Load(login, "J260900193");
            var sourceDetails = source[0].SubEntity["Mom_OrderDetail"];
            var targetDetails = target[0].SubEntity["Mom_OrderDetail"];
            Console.WriteLine("sourceDetails=" + sourceDetails.ItemCount + " targetDetails=" + targetDetails.ItemCount);
            for (var i = 0; i < sourceDetails.ItemCount; i++)
            {
                var d = sourceDetails[i];
                Console.WriteLine("source[" + i + "] id=" + Value(d, "DMoDId") + " inv=" + Value(d, "DInvCode") + " qty=" + Value(d, "DQty") + " alloc=" + d.SubEntity["Mom_MoAllocate"].ItemCount);
            }
            var updateBroker = Broker(login, "U8API/MOrder/MOrderUpdate");
            try
            {
                var update = updateBroker.GetExtBoEntity("extbo");
                update.Clone(target);
                Console.WriteLine("clonedTargetDetails=" + update[0].SubEntity["Mom_OrderDetail"].ItemCount);
            }
            finally { try { updateBroker.Release(); } catch { } }
        }
        finally { try { login.ShutDown(); } catch { } try { Marshal.FinalReleaseComObject(login); } catch { } }
    }
}
