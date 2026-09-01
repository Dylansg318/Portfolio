// zebra-bidi.exe — bidirectional status reader for Zebra label printers over usbprint.sys
// Part of the Device Print Agent. Query-only by design: the command allowlist makes it
// impossible to send configuration/destructive commands through this tool.
//
// IO design note (learned empirically on the ZP 450):
//   The printer terminates every status response with a zero-length USB packet (ZLP).
//   Synchronous ReadFile drained until the ZLP is 100% reliable (64/64 in testing).
//   Overlapped reads that time out and CancelIoEx the dangling IRP disrupt the IN
//   pipe and eat the NEXT query's response (deterministic every-other-read failure).
//   Therefore: sync reads, drain to ZLP, NEVER cancel on the happy path. A watchdog
//   deadline hard-exits the process (rare: printer off/dead) — the retry
//   layer in the caller handles that.
//
// Usage:
//   zebra-bidi.exe list
//   zebra-bidi.exe query --match <substr-of-device-path> --cmd <hs|es|od|sgd:<name>> [--timeout <ms>]
//   zebra-bidi.exe serve --match <substr-of-device-path> [--timeout <ms>]
//     resident mode: prints {"ok":true,"serve":true} then answers one
//     allowlisted command per stdin line with one JSON line, in order.
//     Watchdog timeout => timeout JSON, flush, exit 5 (caller respawns).
//
// Output: single-line JSON on stdout.
// Exit codes: 0 ok, 2 no device, 3 open failed, 4 write failed, 5 read timeout/no data,
//             6 busy (mutex timeout), 7 bad args.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Native {
  public static Guid GUID_USBPRINT = new Guid("28D78FAD-5A12-11D1-AE5B-0000F803A8C2");
  public const int DIGCF_PRESENT = 0x2, DIGCF_DEVICEINTERFACE = 0x10;
  public const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
  public const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2;
  public const uint OPEN_EXISTING = 3;

  [StructLayout(LayoutKind.Sequential)]
  public struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid Guid; public int Flags; public IntPtr Reserved; }

  [DllImport("setupapi.dll", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr h, int f);
  [DllImport("setupapi.dll", SetLastError=true)]
  public static extern bool SetupDiEnumDeviceInterfaces(IntPtr h, IntPtr d, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA data);
  [DllImport("setupapi.dll", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr h, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, ref int req, IntPtr devInfo);
  [DllImport("setupapi.dll", SetLastError=true)]
  public static extern bool SetupDiDestroyDeviceInfoList(IntPtr h);

  [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern IntPtr CreateFile(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool WriteFile(IntPtr h, byte[] b, int n, out int w, IntPtr ov);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadFile(IntPtr h, byte[] b, int n, out int r, IntPtr ov);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}

class ZebraBidi {
  static string JsonEscape(string s) {
    if (s == null) return "";
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '"') sb.Append("\\\"");
      else if (c == '\\') sb.Append("\\\\");
      else if (c == '\r') sb.Append("\\r");
      else if (c == '\n') sb.Append("\\n");
      else if (c == '\t') sb.Append("\\t");
      else if (c < 32) sb.AppendFormat("\\u{0:x4}", (int)c);
      else sb.Append(c);
    }
    return sb.ToString();
  }

  static List<string> Enumerate() {
    var res = new List<string>();
    IntPtr h = Native.SetupDiGetClassDevs(ref Native.GUID_USBPRINT, IntPtr.Zero, IntPtr.Zero,
                                          Native.DIGCF_PRESENT | Native.DIGCF_DEVICEINTERFACE);
    var did = new Native.SP_DEVICE_INTERFACE_DATA(); did.cbSize = Marshal.SizeOf(did);
    int i = 0;
    while (Native.SetupDiEnumDeviceInterfaces(h, IntPtr.Zero, ref Native.GUID_USBPRINT, i, ref did)) {
      int req = 0;
      Native.SetupDiGetDeviceInterfaceDetail(h, ref did, IntPtr.Zero, 0, ref req, IntPtr.Zero);
      IntPtr det = Marshal.AllocHGlobal(req);
      Marshal.WriteInt32(det, (IntPtr.Size == 8) ? 8 : 6);
      int req2 = 0;
      if (Native.SetupDiGetDeviceInterfaceDetail(h, ref did, det, req, ref req2, IntPtr.Zero))
        res.Add(Marshal.PtrToStringAuto(new IntPtr(det.ToInt64() + 4)));
      Marshal.FreeHGlobal(det);
      i++;
    }
    Native.SetupDiDestroyDeviceInfoList(h);
    return res;
  }

  // Strip STX/ETX framing and stray NULs (some firmware appends 0x00 to SGD
  // replies), normalize CRLF.
  static string Clean(string s) {
    var sb = new StringBuilder();
    foreach (char c in s) if (c != '\x02' && c != '\x03' && c != '\x00') sb.Append(c);
    return sb.ToString().Replace("\r\n", "\n").Trim('\n', ' ');
  }

  // Worker result shared with the watchdog.
  class IoResult {
    public volatile bool done;
    public string error; public int win32; public int exitCode;
    public string raw = "";
  }

  // Expected-response completion check: lets us stop reading without a speculative
  // extra blocking read when the terminator is unambiguous.
  static bool ResponseComplete(string cmdName, string acc) {
    if (acc.Length == 0) return false;
    if (cmdName == "hs") {                      // three STX...ETX framed strings
      int etx = 0; foreach (char c in acc) if (c == '\x03') etx++;
      return etx >= 3;
    }
    if (cmdName == "es" || cmdName == "od") {   // block framed with at least one ETX at end
      return acc.TrimEnd('\r', '\n').EndsWith("\x03");
    }
    if (cmdName.StartsWith("sgd:")) {           // "value" — closing quote ends it
      string t = acc.TrimEnd('\r', '\n', ' ', '\0');
      return t.Length >= 2 && t[0] == '"' && t.EndsWith("\"");
    }
    return false;
  }

  static void RunQuery(string target, string cmdName, byte[] payload, IoResult res) {
    IntPtr h = Native.CreateFile(target, Native.GENERIC_READ | Native.GENERIC_WRITE,
                                 Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, IntPtr.Zero,
                                 Native.OPEN_EXISTING, 0, IntPtr.Zero);
    if (h == (IntPtr)(-1)) {
      res.error = "open failed"; res.win32 = Marshal.GetLastWin32Error(); res.exitCode = 3; res.done = true; return;
    }
    try {
      int w;
      if (!Native.WriteFile(h, payload, payload.Length, out w, IntPtr.Zero)) {
        res.error = "write failed"; res.win32 = Marshal.GetLastWin32Error(); res.exitCode = 4; res.done = true; return;
      }
      var acc = new StringBuilder();
      var buf = new byte[4096];
      // Sync reads: each returns on data or on the printer's ZLP terminator (n==0).
      // Stop as soon as the response is provably complete — never issue an extra
      // speculative read that would need cancelling.
      while (true) {
        int n;
        bool ok = Native.ReadFile(h, buf, buf.Length, out n, IntPtr.Zero);
        if (!ok) break;                    // pipe error — return what we have
        if (n == 0) break;                 // ZLP — printer says "response finished"
        acc.Append(Encoding.ASCII.GetString(buf, 0, n));
        if (ResponseComplete(cmdName, acc.ToString())) break;
      }
      res.raw = acc.ToString();
      if (res.raw.Length == 0) { res.error = "no response"; res.exitCode = 5; }
      else res.exitCode = 0;
      res.done = true;
    } finally { Native.CloseHandle(h); }
  }

  static long SafeLong(string s) { long v; return long.TryParse(s, out v) ? v : -1; }
  static string SafeInt(string s) { long v; return long.TryParse(s, out v) ? v.ToString() : "-1"; }

  // Wire payload for an allowlisted command; null + error otherwise.
  static byte[] BuildPayload(string cmdName, out string error) {
    error = null;
    string payload;
    switch (cmdName) {
      case "hs": payload = "~HS\r\n"; break;
      case "es": payload = "~HQES\r\n"; break;
      case "od": payload = "~HQOD\r\n"; break;
      default:
        if (cmdName.StartsWith("sgd:")) {
          string v = cmdName.Substring(4);
          foreach (char c in v)
            if (!(char.IsLetterOrDigit(c) || c == '.' || c == '_')) { error = "invalid sgd name"; return null; }
          payload = "! U1 getvar \"" + v + "\"\r\n";
        } else { error = "cmd not in allowlist"; return null; }
        break;
    }
    return Encoding.ASCII.GetBytes(payload);
  }

  // Success-path JSON for a cleaned response.
  static string FormatResult(string cmdName, string clean, long ms) {
    var outSb = new StringBuilder();
    outSb.Append("{\"ok\":true,\"cmd\":\"").Append(JsonEscape(cmdName))
         .Append("\",\"ms\":").Append(ms)
         .Append(",\"raw\":\"").Append(JsonEscape(clean)).Append("\"");
    if (cmdName == "hs") {
      var lines = clean.Split('\n');
      if (lines.Length >= 2) {
        var f1 = lines[0].Split(',');
        var f2 = lines[1].Split(',');
        if (f1.Length >= 12 && f2.Length >= 11) {
          outSb.Append(",\"hs\":{");
          outSb.Append("\"paperOut\":").Append(f1[1] == "1" ? "true" : "false");
          outSb.Append(",\"paused\":").Append(f1[2] == "1" ? "true" : "false");
          outSb.Append(",\"labelLengthDots\":").Append(SafeInt(f1[3]));
          outSb.Append(",\"formatsInBuffer\":").Append(SafeInt(f1[4]));
          outSb.Append(",\"bufferFull\":").Append(f1[5] == "1" ? "true" : "false");
          outSb.Append(",\"diagMode\":").Append(f1[6] == "1" ? "true" : "false");
          outSb.Append(",\"partialFormat\":").Append(f1[7] == "1" ? "true" : "false");
          outSb.Append(",\"corruptRam\":").Append(f1[9] == "1" ? "true" : "false");
          outSb.Append(",\"underTemp\":").Append(f1[10] == "1" ? "true" : "false");
          outSb.Append(",\"overTemp\":").Append(f1[11] == "1" ? "true" : "false");
          outSb.Append(",\"headUp\":").Append(f2[2] == "1" ? "true" : "false");
          outSb.Append(",\"ribbonOut\":").Append(f2[3] == "1" ? "true" : "false");
          outSb.Append(",\"labelWaiting\":").Append(f2[7] == "1" ? "true" : "false");
          outSb.Append(",\"labelsRemainingInBatch\":").Append(SafeInt(f2[8]));
          outSb.Append("}");
        }
      }
    }
    if (cmdName == "es") {
      long errFlag = 0, warnFlag = 0; string eg1 = "", eg2 = "", wg1 = "", wg2 = "";
      foreach (var ln in clean.Split('\n')) {
        var tt = ln.Trim();
        if (tt.StartsWith("ERRORS:")) { var p = tt.Substring(7).Trim().Split(new[]{' '}, StringSplitOptions.RemoveEmptyEntries); if (p.Length >= 3) { errFlag = SafeLong(p[0]); eg1 = p[1]; eg2 = p[2]; } }
        if (tt.StartsWith("WARNINGS:")) { var p = tt.Substring(9).Trim().Split(new[]{' '}, StringSplitOptions.RemoveEmptyEntries); if (p.Length >= 3) { warnFlag = SafeLong(p[0]); wg1 = p[1]; wg2 = p[2]; } }
      }
      outSb.Append(",\"es\":{\"errorFlag\":").Append(errFlag)
           .Append(",\"errorGroup1\":\"").Append(JsonEscape(eg1)).Append("\"")
           .Append(",\"errorGroup2\":\"").Append(JsonEscape(eg2)).Append("\"")
           .Append(",\"warnFlag\":").Append(warnFlag)
           .Append(",\"warnGroup1\":\"").Append(JsonEscape(wg1)).Append("\"")
           .Append(",\"warnGroup2\":\"").Append(JsonEscape(wg2)).Append("\"}");
    }
    if (cmdName.StartsWith("sgd:odometer") || cmdName == "od") {
      long inches = -1;
      var m = System.Text.RegularExpressions.Regex.Match(clean, @"(\d+)\s*INCHES");
      if (!m.Success) m = System.Text.RegularExpressions.Regex.Match(clean, @"TOTAL USAGE:\s*(\d+)");
      // Both patterns above are ~HQOD REPORT shapes. An SGD getvar answers with
      // the bare value instead — `"12345"` — so odometer.total_print_length (the
      // only odometer read the agent actually issues, bidiOdometer) matched
      // NEITHER and returned -1 => null => the settle loop spun to its 25s cap
      // and every verdict degraded to 'unavailable'. Scoped to the sgd: path on
      // purpose: a bare-number fallback on a multi-line ~HQOD report would
      // happily read a counter that isn't the odometer.
      if (!m.Success && cmdName.StartsWith("sgd:"))
        m = System.Text.RegularExpressions.Regex.Match(clean, "^\"?(\\d+)\"?$");
      if (m.Success) inches = SafeLong(m.Groups[1].Value);
      outSb.Append(",\"odometerInches\":").Append(inches);
    }
    outSb.Append("}");
    return outSb.ToString();
  }

  // Runs ONE query end-to-end (mutex, enumerate, IO thread, watchdog, parse).
  // mustExit=true when the watchdog fired: the sync read thread is still
  // blocked on the IN pipe and process teardown is the ONLY safe reclaim
  // (see the IO design note at the top of this file).
  static int ExecuteOne(string match, string cmdName, int timeoutMs, out string json, out bool mustExit) {
    mustExit = false;
    string perr;
    byte[] payloadBytes = BuildPayload(cmdName, out perr);
    if (payloadBytes == null) { json = "{\"ok\":false,\"error\":\"" + perr + "\"}"; return 7; }

    bool created;
    using (var mtx = new Mutex(false, "Global\\DeviceAgent-ZebraBidi", out created)) {
      bool got = false;
      try { got = mtx.WaitOne(5000); } catch (AbandonedMutexException) { got = true; }
      if (!got) { json = "{\"ok\":false,\"error\":\"busy: another query in progress\"}"; return 6; }
      try {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        string target = null;
        foreach (var p in Enumerate()) if (p.ToLower().Contains(match.ToLower())) { target = p; break; }
        if (target == null) { json = "{\"ok\":false,\"error\":\"device not found\",\"match\":\"" + JsonEscape(match) + "\"}"; return 2; }

        var res = new IoResult();
        var t = new Thread(() => { try { RunQuery(target, cmdName, payloadBytes, res); } catch (Exception ex) { res.error = ex.Message; res.exitCode = 5; res.done = true; } });
        t.IsBackground = true;
        t.Start();
        while (!res.done && sw.ElapsedMilliseconds < timeoutMs) Thread.Sleep(20);
        if (!res.done) {
          json = "{\"ok\":false,\"error\":\"no response (timeout)\",\"ms\":" + sw.ElapsedMilliseconds + "}";
          mustExit = true;
          return 5;
        }
        if (res.exitCode != 0) {
          json = "{\"ok\":false,\"error\":\"" + JsonEscape(res.error) + "\",\"win32\":" + res.win32 + ",\"ms\":" + sw.ElapsedMilliseconds + "}";
          return res.exitCode;
        }
        json = FormatResult(cmdName, Clean(res.raw), sw.ElapsedMilliseconds);
        return 0;
      } finally { try { mtx.ReleaseMutex(); } catch {} }
    }
  }

  static int Main(string[] args) {
    if (args.Length == 0) { Console.WriteLine("{\"ok\":false,\"error\":\"no args\"}"); return 7; }

    if (args[0] == "list") {
      var paths = Enumerate();
      var sb = new StringBuilder("{\"ok\":true,\"devices\":[");
      for (int i = 0; i < paths.Count; i++) { if (i > 0) sb.Append(','); sb.Append('"').Append(JsonEscape(paths[i])).Append('"'); }
      sb.Append("]}");
      Console.WriteLine(sb.ToString());
      return 0;
    }

    if (args[0] != "query" && args[0] != "serve") { Console.WriteLine("{\"ok\":false,\"error\":\"unknown mode\"}"); return 7; }

    string match = null, cmdName = null;
    int timeoutMs = 4000;
    for (int i = 1; i < args.Length - 1; i++) {
      if (args[i] == "--match") match = args[i + 1];
      if (args[i] == "--cmd") cmdName = args[i + 1];
      if (args[i] == "--timeout") int.TryParse(args[i + 1], out timeoutMs);
    }
    if (timeoutMs < 500) timeoutMs = 500;
    if (timeoutMs > 15000) timeoutMs = 15000;

    if (args[0] == "serve") {
      // Resident mode: one request per stdin line, one JSON reply per line.
      // Per-request mutex + device open/close — the daemon NEVER holds the
      // device or the global mutex between requests, so the maintenance CLI
      // (--selftest-bidi etc.) still interleaves safely beside a live agent.
      if (match == null) { Console.WriteLine("{\"ok\":false,\"error\":\"need --match\"}"); return 7; }
      Console.WriteLine("{\"ok\":true,\"serve\":true}");   // ready banner = version sniff
      Console.Out.Flush();
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        string req = line.Trim();
        if (req.Length == 0) continue;
        string json; bool mustExit;
        ExecuteOne(match, req, timeoutMs, out json, out mustExit);
        Console.WriteLine(json);
        Console.Out.Flush();
        if (mustExit) Environment.Exit(5);   // blocked read thread — teardown reclaims it; caller respawns
      }
      return 0;   // stdin EOF: parent agent went away
    }

    // query mode (unchanged contract)
    if (match == null || cmdName == null) { Console.WriteLine("{\"ok\":false,\"error\":\"need --match and --cmd\"}"); return 7; }
    string qjson; bool qExit;
    int code = ExecuteOne(match, cmdName, timeoutMs, out qjson, out qExit);
    Console.WriteLine(qjson);
    if (qExit) { Console.Out.Flush(); Environment.Exit(5); }
    return code;
  }
}
