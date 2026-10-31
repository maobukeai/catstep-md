using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CatstepNativeCredentialProbe {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential {
  public uint Flags, Type;
  [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
  [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize;
  public IntPtr CredentialBlob;
  public uint Persist, AttributeCount;
  public IntPtr Attributes;
  [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
  [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
 }
 [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Write(ref Credential credential, uint flags);
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
 [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Delete(string target, uint type, uint flags);
 [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
 public static void Run() {
  Console.WriteLine("credential_struct_bytes=" + Marshal.SizeOf<Credential>() + "; session_id=" + System.Diagnostics.Process.GetCurrentProcess().SessionId);
  foreach (string mode in new string[]{"simple","path-target","path-user","path-both","long-user","long-target","colon-target","slash-target"}) { uint persist=3;
   string nonce=Guid.NewGuid().ToString("N"); string username="fixture";
string shape=System.IO.Path.Combine(System.IO.Path.GetTempPath(), "catstep-shape-"+nonce);
string target="CatstepMD-native-"+nonce;
if(mode=="path-target" || mode=="path-both")target=shape+".solomd-encryption-key";
if(mode=="path-user" || mode=="path-both")username=shape;
if(mode=="long-user")username=new string('u',200);
if(mode=="long-target")target=target+new string('t',200);
if(mode=="colon-target")target="CatstepMD:"+nonce;
if(mode=="slash-target")target="CatstepMD\\"+nonce;
Console.WriteLine("mode="+mode+"; target_chars="+target.Length+"; username_chars="+username.Length);
   IntPtr existing;
   bool existed=Read(target,1,0,out existing); int preError=Marshal.GetLastWin32Error();
   if(existed) { CredFree(existing); throw new InvalidOperationException("random fixture unexpectedly existed; no mutation performed"); }
   if(preError!=1168) { Console.WriteLine("persist="+persist+"; preflight_read_error="+preError+"; aborted_before_write"); continue; }
   byte[] bytes=Encoding.Unicode.GetBytes(new string('0',64));
   IntPtr blob=Marshal.AllocHGlobal(bytes.Length);
   try {
    Marshal.Copy(bytes,0,blob,bytes.Length);
    Credential cred=new Credential{Flags=0,Type=1,TargetName=target,Comment="keyring v3.6.3",CredentialBlobSize=(uint)bytes.Length,CredentialBlob=blob,Persist=persist,AttributeCount=0,Attributes=IntPtr.Zero,TargetAlias="",UserName=username};
    bool written=Write(ref cred,0); int writeError=written?0:Marshal.GetLastWin32Error();
    IntPtr result; bool read=Read(target,1,0,out result); int readError=read?0:Marshal.GetLastWin32Error();
    bool matches=false;
    if(read) { try { var got=Marshal.PtrToStructure<Credential>(result); byte[] data=new byte[got.CredentialBlobSize]; Marshal.Copy(got.CredentialBlob,data,0,data.Length); matches=Convert.ToBase64String(data)==Convert.ToBase64String(bytes); } finally {CredFree(result);} }
    Console.WriteLine("persist="+persist+"; write_ok="+written+"; write_error="+writeError+"; read_ok="+read+"; read_error="+readError+"; own_payload_matches="+matches);
   } finally {
    Marshal.FreeHGlobal(blob);
    // This exact freshly generated target passed a NoEntry preflight. Never
    // enumerate credentials or delete any target other than this invocation's.
    bool deleted=Delete(target,1,0); int deleteError=deleted?0:Marshal.GetLastWin32Error();
    IntPtr after; bool remains=Read(target,1,0,out after); int afterError=remains?0:Marshal.GetLastWin32Error(); if(remains)CredFree(after);
    Console.WriteLine("persist="+persist+"; own_fixture_delete_ok="+deleted+"; delete_error="+deleteError+"; remains="+remains+"; final_read_error="+afterError);
   }
  }
 }
}

