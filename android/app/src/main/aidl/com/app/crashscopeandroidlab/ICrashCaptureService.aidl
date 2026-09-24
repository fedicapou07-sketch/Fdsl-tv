package com.app.crashscopeandroidlab;

interface ICrashCaptureService {
    void destroy() = 16777114;
    void exit() = 1;
    boolean start(String packageName) = 2;
    String stopAndGetReport() = 3;
    String getSnapshot() = 4;
    void clear() = 5;
    int getUid() = 6;
}
