@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /LD /DNOMINMAX /O2 /EHsc /std:c++20 /Zc:__cplusplus /MD /I"%~dp0node-v24.16.0\include\node" "%~dp0gc-cycles.cc" /Fo"%~dp0gc-cycles.obj" /Fe"%~dp0gc-cycles.node" /link "%~dp0node.lib" kernel32.lib
