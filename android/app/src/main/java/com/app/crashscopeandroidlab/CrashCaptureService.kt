package com.app.crashscopeandroidlab

import android.os.Build
import android.system.Os
import androidx.annotation.Keep
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Keep
class CrashCaptureService : ICrashCaptureService.Stub() {
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    private val buffer = StringBuilder()
    private var process: Process? = null
    private var targetPackage = ""

    override fun start(packageName: String): Boolean {
        if (packageName.isBlank() || running.getAndSet(true)) return false
        targetPackage = packageName.trim()
        synchronized(lock) { buffer.setLength(0) }
        executor.execute {
            try {
                process = Runtime.getRuntime().exec(arrayOf("logcat", "-c"))
                process?.waitFor()
                process = Runtime.getRuntime().exec(arrayOf("logcat", "-v", "threadtime", "-b", "main", "-b", "crash", "-b", "system"))
                val reader = BufferedReader(InputStreamReader(process!!.inputStream))
                while (running.get()) {
                    val line = reader.readLine() ?: break
                    if (isRelevant(line)) append(line)
                }
            } catch (ignored: Throwable) {
                append("CrashScope capture error: ${ignored.javaClass.simpleName}: ${ignored.message}")
            } finally {
                try { process?.destroy() } catch (_: Throwable) {}
                process = null
            }
        }
        return true
    }

    private fun isRelevant(line: String): Boolean {
        return line.contains(targetPackage) ||
            line.contains("AndroidRuntime") ||
            line.contains("FATAL EXCEPTION") ||
            line.contains("am_crash") ||
            line.contains("am_anr") ||
            line.contains("SIGSEGV") ||
            line.contains("Fatal signal") ||
            line.contains("CRASH")
    }

    private fun append(line: String) {
        synchronized(lock) {
            if (buffer.length > 180_000) buffer.delete(0, 40_000)
            buffer.append(line).append('\n')
        }
    }

    override fun stopAndGetReport(): String {
        running.set(false)
        try { process?.destroy() } catch (_: Throwable) {}
        Thread.sleep(120)
        return getSnapshot()
    }

    override fun getSnapshot(): String = synchronized(lock) {
        buildString {
            append("CrashScope capture\n")
            append("package=").append(targetPackage).append('\n')
            append("device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
            append("android=").append(Build.VERSION.RELEASE).append(" (SDK ").append(Build.VERSION.SDK_INT).append(")\n")
            append("uid=").append(Os.getuid()).append('\n')
            append("--- logcat ---\n")
            append(buffer.toString())
        }
    }

    override fun clear() {
        synchronized(lock) { buffer.setLength(0) }
    }

    override fun getUid(): Int = Os.getuid()

    override fun exit() { destroy() }

    override fun destroy() {
        running.set(false)
        try { process?.destroy() } catch (_: Throwable) {}
        executor.shutdownNow()
        System.exit(0)
    }
}
