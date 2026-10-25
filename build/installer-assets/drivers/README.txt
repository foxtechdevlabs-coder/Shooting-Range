========================================================================
 PRINTER AND SCANNER SETUP  (Zebra ZD220 + QBT2500 scanner)
========================================================================

The driver files are supplied separately — they are NOT on this pen drive
because of their size and licensing. Obtain them from the printer
supplier, from Zebra's support site (download once on any PC with
internet), or from the folder your IT contact provides.

This is the ONLY part of the setup that needs an administrator account on
the PC. Everything else installs per-user.


A. INSTALL THE ZEBRA ZD220 PRINTER DRIVER
-----------------------------------------
  1. Copy the Zebra driver package (e.g. "ZD220_ZDesigner_Printer_
     Driver_v...exe" or the "ZDesigner ZD220-203dpi ZPL" driver) to the
     PC.
  2. Right-click the file -> "Run as administrator".
  3. Accept the licence and finish the wizard.
  4. Connect the printer by USB and switch it on.
  5. Open Windows Settings -> Bluetooth & devices -> Printers & scanners
     and confirm the printer appears, for example as:
        ZDesigner ZD220-203dpi ZPL
  6. Open "Printer properties" and set:
        Port        USB001 (or the USB port the printer is on)
        Paper size  the label size you actually load
                    (2.25 x 1.25 in / 57 x 32 mm is typical for pouch labels)
        Orientation Portrait
  7. Print the Windows test page once to confirm the driver works.

  In the app: Settings -> Barcode labels
     Printer -> select "ZDesigner ZD220-203dpi ZPL" (the exact name shown
     in Printers & scanners), Driver -> "Windows spooler", then click
     "Print test label".

  Note: labels are sent as raw ZPL (the printer's own language), so the
  label layout is controlled by the app, not by the Windows driver.


B. SET THE QBT2500 BARCODE SCANNER TO USB KEYBOARD MODE
-------------------------------------------------------
  The app treats the scanner as a keyboard: it types the barcode into the
  focused scan box. No driver or software is required.

  1. Plug the scanner into a USB port. It should beep/power on.
  2. Open Notepad on the PC and scan any test barcode.
        - If the barcode text appears in Notepad, the scanner is already
          in USB keyboard (HID) mode. Skip to step 4.
        - If nothing appears, it is probably in USB-COM (virtual serial)
          mode and must be switched.
  3. Switch to keyboard mode using the scanner's setup barcodes:
        - Look in the QBT2500 quick-start sheet for the barcode labelled
          "USB Keyboard" / "USB HID Keyboard" / "Keyboard wedge" and scan it.
        - The scanner restarts. Scan a test barcode into Notepad again to
          confirm text appears.
        - If the sheet is missing: hold the trigger for ~5 seconds to
          enter setup mode, or contact the supplier for the USB HID
          configuration barcode. Do not use "USB Virtual COM" mode.
  4. Recommended scanner settings (set with the manual's barcodes):
        Suffix / terminator : CR (Enter) — the app also accepts scans
                              submitted with Enter from the keyboard
        Keyboard layout     : US (or the PC's layout)
        Code 128            : enabled  (the labels use Code 128)
  5. In the app, open "Scan station" and scan a printed pouch label.
     The participant should appear immediately.

  If scans occasionally go nowhere, click once inside the app window;
  the scan box regains focus automatically whenever the window is
  activated.


C. FALLBACK WHEN NO PRINTER IS CONNECTED
----------------------------------------
  Printing still works without a printer: the app writes the label as a
  .zpl file into the "labels" folder inside the data folder
  (Settings -> About -> Open shows the data folder). You can reprint
  those files later from another PC, or after reconnecting the printer.
  The Barcode screen shows an inline warning with a link to Settings
  whenever the configured printer is missing or offline.

========================================================================
