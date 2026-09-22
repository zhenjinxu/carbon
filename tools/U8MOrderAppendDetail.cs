using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using UFIDA.U8.U8APIFramework;
using UFIDA.U8.U8APIFramework.Meta;
using UFIDA.U8.U8APIFramework.Parameter;
using U8Login;

internal static class U8MOrderAppendDetail
{
    const string Work = @"D:\Object\carbon\.codex\work";
    const string SourceCode = "J260900063";
    const string TargetCode = "J260900193";
    const string GuardName = "u8-morder-dll-append-J260900193-call-count.txt";

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

    static string Value(ExtensionItem item, string name)
    {
        try { return Convert.ToString(item[name]) ?? ""; } catch { return ""; }
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

    static void CopyFields(ExtensionBusinessEntity sourceEntity, ExtensionItem sourceItem, ExtensionItem targetItem)
    {
        foreach (var field in sourceEntity.ExtensionBOMeta.MainFields)
        {
            try { targetItem[field.Name] = sourceItem[field.Name]; } catch { }
        }
        var subNames = sourceEntity.SubBONames;
        if (subNames == null) return;
        foreach (var subName in subNames)
        {
            var sourceSub = sourceItem.SubEntity[subName];
            var targetSub = targetItem.SubEntity[subName];
            if (sourceSub == null || targetSub == null) continue;
            for (var i = 0; i < sourceSub.ItemCount; i++)
            {
                var targetChild = targetSub.NewItem();
                CopyFields(sourceSub, sourceSub[i], targetChild);
            }
        }
    }

    static void MainCore()
    {
        ResolveAssemblies();
        Directory.CreateDirectory(Work);
        var guard = Path.Combine(Work, GuardName);
        if (File.Exists(guard)) throw new Exception("Append write guard exists; refusing duplicate update.");

        var info = File.ReadAllText(Path.Combine(Work, "u8-local-connection-info.tmp"));
        var match = System.Text.RegularExpressions.Regex.Match(info, "u8用户名：(?<u>[^，]+)，密码：(?<p>[^，]+).*服务器地址：(?<s>[\\d.]+)");
        if (!match.Success) throw new Exception("Cannot parse U8 connection info");

        var login = new clsLoginClass();
        string sub = "AS", account = "(default)@006", year = "2026", user = match.Groups["u"].Value, password = match.Groups["p"].Value, date = DateTime.Now.ToString("yyyy-MM-dd"), server = match.Groups["s"].Value, serial = "";
        if (!login.Login(ref sub, ref account, ref year, ref user, ref password, ref date, ref server, ref serial)) throw new Exception("U8 login failed");
        try
        {
            Console.WriteLine("load source");
            var source = Load(login, SourceCode);
            Console.WriteLine("load target");
            var target = Load(login, TargetCode);
            var sourceDetails = source[0].SubEntity["Mom_OrderDetail"];
            var targetDetails = target[0].SubEntity["Mom_OrderDetail"];
            if (sourceDetails.ItemCount < 2) throw new Exception("Source order has no second detail.");
            if (targetDetails.ItemCount < 1) throw new Exception("Target order has no existing detail.");
            var sourceDetail = sourceDetails[1];
            if (Value(sourceDetail, "DInvCode") != "1192430110500" || Value(sourceDetail, "DQty") != "2") throw new Exception("Source second detail identity/quantity changed.");
            for (var i = 0; i < targetDetails.ItemCount; i++) if (Value(targetDetails[i], "DInvCode") == "1192430110500") throw new Exception("Target already contains the requested detail; refusing duplicate.");
            Console.WriteLine("target status=" + Value(targetDetails[0], "DStatus") + " rels=" + Value(targetDetails[0], "DRelsUser") + " details=" + targetDetails.ItemCount);

            var updateBroker = Broker(login, "U8API/MOrder/MOrderUpdate");
            try
            {
                var update = updateBroker.GetExtBoEntity("extbo");
                update.Clone(target);
                Console.WriteLine("cloned target");
                var updateDetails = update[0].SubEntity["Mom_OrderDetail"];
                var newDetail = updateDetails.NewItem();
                if (newDetail == null) throw new Exception("NewItem returned null.");
                Console.WriteLine("created detail item");
                CopyFields(sourceDetails, sourceDetail, newDetail);
                newDetail["DMoDId"] = (updateDetails.ItemCount).ToString();
                newDetail["DSortSeq"] = (updateDetails.ItemCount).ToString();
                newDetail["DRelsUser"] = "";
                newDetail["DRelsDate"] = "";
                newDetail["DRelsTime"] = "";
                if (!updateBroker.Invoke() || !Convert.ToBoolean(updateBroker.GetReturnValue())) throw new Exception("MOrderUpdate failed: " + updateBroker.GetExceptionString());
            }
            finally { try { updateBroker.Release(); } catch { } }

            var after = Load(login, TargetCode);
            var afterDetails = after[0].SubEntity["Mom_OrderDetail"];
            ExtensionItem found = null;
            for (var i = 0; i < afterDetails.ItemCount; i++) if (Value(afterDetails[i], "DInvCode") == "1192430110500") found = afterDetails[i];
            if (found == null || Value(found, "DQty") != "2" || found.SubEntity["Mom_MoAllocate"].ItemCount != sourceDetail.SubEntity["Mom_MoAllocate"].ItemCount) throw new Exception("Read-back verification failed.");
            File.WriteAllText(guard, "update=1");
            Console.WriteLine("updated " + TargetCode + " appended " + Value(found, "DInvCode") + " qty " + Value(found, "DQty") + " allocations " + found.SubEntity["Mom_MoAllocate"].ItemCount);
        }
        finally { try { login.ShutDown(); } catch { } try { Marshal.FinalReleaseComObject(login); } catch { } }
    }

    static void Main()
    {
        try { MainCore(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.GetType().FullName); Console.Error.WriteLine(ex.Message); Console.Error.WriteLine(ex.StackTrace); Environment.ExitCode = 1; }
    }
}
