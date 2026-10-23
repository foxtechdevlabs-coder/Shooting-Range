param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $FilePath)) {
    Write-Error "File not found: $FilePath"
    exit 2
}

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOEX {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOEX pDocInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendFileToPrinter(string printerName, string filePath) {
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOEX di = new DOCINFOEX();
        di.pDocName = "ZPL Label Print";
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            int err = Marshal.GetLastWin32Error();
            throw new Exception("OpenPrinter failed with error code: " + err);
        }

        try {
            if (StartDocPrinter(hPrinter, 1, di) == 0) {
                int err = Marshal.GetLastWin32Error();
                throw new Exception("StartDocPrinter failed with error code: " + err);
            }

            try {
                if (!StartPagePrinter(hPrinter)) {
                    int err = Marshal.GetLastWin32Error();
                    throw new Exception("StartPagePrinter failed with error code: " + err);
                }

                try {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    try {
                        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                        int written = 0;
                        if (!WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written) || written != bytes.Length) {
                            int err = Marshal.GetLastWin32Error();
                            throw new Exception("WritePrinter failed with error code: " + err);
                        }
                    } finally {
                        Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    }
                } finally {
                    EndPagePrinter(hPrinter);
                }
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
[RawPrinterHelper]::SendFileToPrinter($PrinterName, $FilePath)
