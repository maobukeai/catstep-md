using System;
using System.Runtime.InteropServices;
public static class CatstepCapacityAfterApprovedCleanup {
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
 static string Fresh() { return "CatstepMD-" + Guid.NewGuid().ToString("N"); }
 static void EnsureFresh(string target) {
  IntPtr p; bool found=Read(target,1,0,out p); int e=found?0:Marshal.GetLastWin32Error();
  if(found) {CredFree(p);throw new Exception("unexpected existing random target; no action permitted");}
  if(e!=1168) throw new Exception("fresh-target presence check error "+e);
  Console.WriteLine("fresh_presence_check; target="+target+"; error="+e+"; payload_read=false");
 }
 static void Cleanup(string target) {
  bool ok=Delete(target,1,0); int e=ok?0:Marshal.GetLastWin32Error();
  IntPtr p; bool remains=Read(target,1,0,out p); int r=remains?0:Marshal.GetLastWin32Error();
  if(remains) CredFree(p);
  Console.WriteLine("own_cleanup; target="+target+"; delete_ok="+ok+"; delete_error="+e+"; remains="+remains+"; final_presence_error="+r+"; payload_read=false");
  if(remains || r!=1168 || (!ok && e!=1168)) throw new Exception("own probe cleanup failed");
 }
 static bool TryWrite(string target,string label) {
  IntPtr blob=Marshal.AllocHGlobal(128);
  try {
   Marshal.Copy(new byte[128],0,blob,128);
   Credential c=new Credential{Type=1,TargetName=target,Comment="keyring v3.6.3",CredentialBlobSize=128,CredentialBlob=blob,Persist=3,UserName="fixture",TargetAlias=""};
   bool ok=Write(ref c,0); int e=ok?0:Marshal.GetLastWin32Error();
   Console.WriteLine(label+"; target="+target+"; target_chars="+target.Length+"; user_chars=7; comment_chars=14; blob_bytes=128; persist=3; ok="+ok+"; error="+e);
   return ok;
  } finally {Marshal.FreeHGlobal(blob);}
 }
 public static void Run() {
  string a=Fresh(), b=Fresh(); EnsureFresh(a);EnsureFresh(b);
  try {
   TryWrite(a,"hold-own-A");
   TryWrite(b,"create-own-B-with-A-held");
   Cleanup(a);
   TryWrite(b,"retry-own-B-after-A-deleted");
  } finally {Cleanup(a);Cleanup(b);}
 }
}
