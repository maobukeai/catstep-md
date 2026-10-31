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
 static string Fresh(int length) {string s="CatstepMD-"+Guid.NewGuid().ToString("N");return s+new string('x',Math.Max(0,length-s.Length));}
 static void EnsureFresh(string target) {IntPtr p;bool found=Read(target,1,0,out p);int e=Marshal.GetLastWin32Error();if(found){CredFree(p);throw new Exception("unexpected existing random target; abort");}if(e!=1168)throw new Exception("fresh-target read error "+e);}
 static void Cleanup(string target) {bool ok=Delete(target,1,0);int e=ok?0:Marshal.GetLastWin32Error();IntPtr p;bool remains=Read(target,1,0,out p);int r=remains?0:Marshal.GetLastWin32Error();if(remains)CredFree(p);Console.WriteLine("own_cleanup_ok="+ok+"; delete_error="+e+"; remains="+remains+"; final_read_error="+r);}
 static bool TryWrite(string target, int bytes, string label) {
  IntPtr blob=Marshal.AllocHGlobal(Math.Max(1,bytes));
  try {if(bytes>0)Marshal.Copy(new byte[bytes],0,blob,bytes);
   Credential c=new Credential{Type=1,TargetName=target,Comment="keyring v3.6.3",CredentialBlobSize=(uint)bytes,CredentialBlob=blob,Persist=3,UserName="fixture",TargetAlias=""};
   bool ok=Write(ref c,0);int e=ok?0:Marshal.GetLastWin32Error();Console.WriteLine(label+"; target_chars="+target.Length+"; blob_bytes="+bytes+"; ok="+ok+"; error="+e);return ok;
  } finally {Marshal.FreeHGlobal(blob);}
 }
 public static void Run() {
  foreach(int length in new int[]{90,100,110}) {
   string t=Fresh(length);EnsureFresh(t);
   try {TryWrite(t,128,"create-large");TryWrite(t,0,"same-target-empty");TryWrite(t,128,"same-target-update-large");}
   finally {Cleanup(t);}
  }
  string a=Fresh(42), b=Fresh(42);EnsureFresh(a);EnsureFresh(b);
  try {TryWrite(a,128,"hold-own-A");TryWrite(b,128,"create-own-B-with-A-held");Cleanup(a);TryWrite(b,128,"retry-own-B-after-A-deleted");}
  finally {Cleanup(a);Cleanup(b);}
 }
}
