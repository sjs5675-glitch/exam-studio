' Exam Studio Launcher (Windows)
' 콘솔 창 없이 서버를 시작하고 브라우저를 엽니다.
' 처음 한 번은 install.bat 을 먼저 실행해 의존성을 설치하세요.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootDir   = fso.GetParentFolderName(WScript.ScriptFullName)
studioDir = rootDir & "\studio"
venvBin   = rootDir & "\.venv\Scripts"
WshShell.CurrentDirectory = studioDir

' Node.js 확인
If WshShell.Run("cmd /c where node.exe >nul 2>nul", 0, True) <> 0 Then
    MsgBox "Node.js가 설치되어 있지 않습니다." & vbCrLf & vbCrLf & _
           "https://nodejs.org 에서 LTS 버전을 설치 후 install.bat 을 실행하세요.", _
           vbExclamation, "Exam Studio"
    WScript.Quit 1
End If

' 의존성 미설치 시 안내
If Not fso.FolderExists(studioDir & "\node_modules\.bin") Then
    MsgBox "의존성이 설치되지 않았습니다." & vbCrLf & vbCrLf & _
           "먼저 install.bat 을 더블클릭해 설치를 완료하세요.", _
           vbExclamation, "Exam Studio"
    WScript.Quit 1
End If

' venv(파이썬 의존성)를 PATH 앞에 추가 — spawn 되는 python 이 .venv 를 쓰도록
pathPrefix = ""
If fso.FolderExists(venvBin) Then pathPrefix = "set ""PATH=" & venvBin & ";%PATH%"" && "

' 기존 포트 프로세스 정리
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano 2^>nul ^| findstr "":3020"" ^| findstr ""LISTENING""') do taskkill /pid %a /f >nul 2>nul", 0, True
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -ano 2^>nul ^| findstr "":3021 "" ^| findstr ""LISTENING""') do taskkill /pid %a /f >nul 2>nul", 0, True

' 서버 시작 (숨김)
WshShell.Run "cmd /c cd /d """ & studioDir & """ && " & pathPrefix & "call pnpm.cmd dev:sse", 0, False
WshShell.Run "cmd /c cd /d """ & studioDir & """ && " & pathPrefix & "call pnpm.cmd dev", 0, False

' Next.js 준비 대기 (최대 90초)
ready = False
For i = 1 To 90
    WScript.Sleep 1000
    If WshShell.Run("cmd /c netstat -ano 2>nul | findstr "":3020"" | findstr ""LISTENING"" >nul 2>nul", 0, True) = 0 Then
        ready = True
        Exit For
    End If
Next

If ready Then WshShell.Run "http://localhost:3020"

' 스크립트 종료 — 서버는 백그라운드에서 계속 실행됩니다.
