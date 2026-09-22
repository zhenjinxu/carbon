using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8MOMAPIFramework;
using UFIDA.U8.MomServiceCommon;
using UFIDA.U8.U8APIFramework.Meta;
using UFIDA.U8.U8APIFramework.Parameter;

internal static class U8MOrderClone
{
    const string Source = "J260900063";
    const string Target = "J260900193";
    const string Item = "19260501030302";
    const string Work = @"D:\Object\carbon\.codex\work";

    static void ResolveAssemblies() { AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => { var n = new System.Reflection.AssemblyName(args.Name).Name + ".dll"; foreach (var d in new[] { @"D:\U8SOFT\UFMOM\U8APIFramework", @"D:\U8SOFT\Interop", @"D:\U8SOFT\ufcomsql" }) { var p = Path.Combine(d, n); if (File.Exists(p)) return Assembly.LoadFrom(p); } return null; }; }

    static U8ApiBroker Broker(U8Login.clsLogin login, string api)
    {
        var context = new U8EnvContext { U8Login = login };
        return new U8ApiBroker(new U8ApiAddress(api), context);
    }

    static string Value(ExtensionItem row, string name)
    {
        try { return Convert.ToString(row[name]) ?? ""; } catch { return ""; }
    }

    static ExtensionBusinessEntity Load(U8Login.clsLogin login, string code)
    {
        var b = Broker(login, "U8API/MOrder/MOrderLoad");
        try
        {
            b.AssignNormalValue("mocode", code);
            if (!b.Invoke()) throw new Exception("MOrderLoad Invoke failed: " + b.GetExceptionString());
            if (!Convert.ToBoolean(b.GetReturnValue())) throw new Exception("MOrderLoad returned false");
            return b.GetExtBoEntity("extbo");
        }
        finally { try { b.Release(); } catch { } }
    }

    static void MainCore()
    {
        ResolveAssemblies();
        Directory.CreateDirectory(Work);
        var guard = Path.Combine(Work, "u8-morder-dll-clone-J260900193-call-count.txt");
        if (File.Exists(guard)) throw new Exception("Write guard exists; refusing duplicate add.");
        var login = new U8Login.clsLoginClass();
        string sub = "AS", acc = "(default)@006", year = "2026", user = "", pass = "", date = DateTime.Now.ToString("yyyy-MM-dd"), server = "", serial = "";
        var info = File.ReadAllText(Path.Combine(Work, "u8-local-connection-info.tmp"));
        var m = System.Text.RegularExpressions.Regex.Match(info, "u8用户名：(?<u>[^，]+)，密码：(?<p>[^，]+).*服务器地址：(?<s>[\\d.]+)");
        if (!m.Success) throw new Exception("Cannot parse U8 connection info");
        user = m.Groups["u"].Value; pass = m.Groups["p"].Value; server = m.Groups["s"].Value;
        if (!login.Login(ref sub, ref acc, ref year, ref user, ref pass, ref date, ref server, ref serial)) throw new Exception("U8 login failed");
        try
        {
            var source = Load(login, Source);
            if (source.ItemCount != 1) throw new Exception("Unexpected source item count");
            var head = source[0];
            var details = head.SubEntity["Mom_OrderDetail"];
            ExtensionItem chosen = null;
            for (int i = 0; i < details.ItemCount; i++)
            {
                var d = details[i];
                if (Value(d, "DInvCode") == Item && Value(d, "DQty") == "10") { if (chosen != null) throw new Exception("Multiple target details"); chosen = d; }
            }
            if (chosen == null) throw new Exception("Target detail not found");
            if (!Object.ReferenceEquals(details[0], chosen)) throw new Exception("Target detail is not first; refusing positional clone.");
            if (!details.Remove(1)) throw new Exception("Failed to remove non-target detail.");
            head["MoId"] = "1"; head["MoCode"] = Target;
            chosen["DMoDId"] = "1"; chosen["DRelsUser"] = ""; chosen["DRelsDate"] = ""; chosen["DRelsTime"] = "";
            var add = Broker(login, "U8API/MOrder/MOrderAdd");
            try { add.AssignNormalValue("extbo", source); if (!add.Invoke() || !Convert.ToBoolean(add.GetReturnValue())) throw new Exception("MOrderAdd failed: " + add.GetExceptionString()); }
            finally { try { add.Release(); } catch { } }
            var created = Load(login, Target);
            var cd = created[0].SubEntity["Mom_OrderDetail"];
            if (created.ItemCount != 1 || cd.ItemCount != 1 || Value(cd[0], "DInvCode") != Item || Value(cd[0], "DQty") != "10") throw new Exception("Read-back verification failed");
            File.WriteAllText(guard, "add=1");
            Console.WriteLine("created " + Target + " detail " + Item + " qty 10");
        }
        finally { try { login.ShutDown(); } catch { } try { Marshal.FinalReleaseComObject(login); } catch { } }
    }
    static void Main()
    {
        try { MainCore(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().FullName); Console.Error.WriteLine(ex.Message); Environment.ExitCode = 1; }
    }
}
