; Custom NSIS hook: make the .md / .markdown / .mdown / .mkd / .txt file
; association show a dedicated document icon for Catstep MD (猫步 MD).

!macro NSIS_HOOK_POSTINSTALL
  ; Primary: override Tauri-registered DefaultIcon for "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\Markdown Document\DefaultIcon" "" '"$INSTDIR\icons\file_icon.ico",0'
  WriteRegStr SHCTX "Software\Classes\Plain Text\DefaultIcon" "" '"$INSTDIR\icons\file_icon.ico",0'

  ; Dedicated Catstep MD ProgIDs
  WriteRegStr SHCTX "Software\Classes\CatstepMD.md" "" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\CatstepMD.md\DefaultIcon" "" '"$INSTDIR\icons\file_icon.ico",0'
  WriteRegStr SHCTX "Software\Classes\CatstepMD.md\shell\open\command" "" '"$INSTDIR\CatstepMD.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\CatstepMD.txt" "" "Plain Text"
  WriteRegStr SHCTX "Software\Classes\CatstepMD.txt\DefaultIcon" "" '"$INSTDIR\icons\file_icon.ico",0'
  WriteRegStr SHCTX "Software\Classes\CatstepMD.txt\shell\open\command" "" '"$INSTDIR\CatstepMD.exe" "%1"'

  ; Force Explorer to refresh icon cache (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\CatstepMD.md"
  DeleteRegKey SHCTX "Software\Classes\CatstepMD.txt"
!macroend

