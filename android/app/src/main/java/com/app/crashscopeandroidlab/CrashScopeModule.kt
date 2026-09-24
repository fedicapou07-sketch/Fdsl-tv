package com.app.crashscopeandroidlab

import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.IBinder
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import rikka.shizuku.Shizuku

class CrashScopeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "CrashScopeNative"
        const val PERMISSION_REQUEST_CODE = 4242
    }

    private var captureService: ICrashCaptureService? = null
    private var pendingStart: Pair<String, Promise>? = null

    private val userServiceArgs = Shizuku.UserServiceArgs(
        ComponentName(context.packageName, CrashCaptureService::class.java.name)
    ).daemon(false).processNameSuffix("capture").debuggable(BuildConfig.DEBUG).version(BuildConfig.VERSION_CODE)

    private val userConnection = object : android.content.ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            captureService = if (binder?.pingBinder() == true) ICrashCaptureService.Stub.asInterface(binder) else null
            val start = pendingStart
            if (start != null && captureService != null) {
                try {
                    val started = captureService!!.start(start.first)
                    pendingStart = null
                    start.second.resolve(started)
                } catch (error: Throwable) {
                    pendingStart = null
                    start.second.reject("CAPTURE_START_ERROR", error.message, error)
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            captureService = null
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun getBridgeStatus(promise: Promise) {
        try {
            val result: WritableMap = Arguments.createMap()
            val binderAlive = Shizuku.pingBinder()
            val permission = if (binderAlive && !Shizuku.isPreV11()) {
                Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
            } else false
            result.putBoolean("shizukuInstalledOrAvailable", binderAlive)
            result.putBoolean("permissionGranted", permission)
            result.putInt("serverUid", if (binderAlive) Shizuku.getUid() else -1)
            result.putString("transport", when {
                !binderAlive -> "unavailable"
                Shizuku.getUid() == 0 -> "root"
                Shizuku.getUid() == 2000 -> "adb-shell"
                else -> "other"
            })
            result.putBoolean("canStartCapture", binderAlive && permission)
            promise.resolve(result)
        } catch (error: Throwable) {
            promise.reject("SHIZUKU_STATUS_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun requestShizukuPermission(promise: Promise) {
        try {
            if (!Shizuku.pingBinder()) {
                promise.resolve(false)
                return
            }
            if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) {
                promise.resolve(true)
                return
            }
            Shizuku.requestPermission(PERMISSION_REQUEST_CODE)
            promise.resolve(false)
        } catch (error: Throwable) {
            promise.reject("SHIZUKU_PERMISSION_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun startCapture(packageName: String, promise: Promise) {
        try {
            if (!Shizuku.pingBinder()) {
                promise.reject("SHIZUKU_UNAVAILABLE", "Shizuku is not running")
                return
            }
            if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
                promise.reject("SHIZUKU_NOT_AUTHORIZED", "Grant Shizuku permission first")
                return
            }
            if (captureService != null) {
                promise.resolve(captureService!!.start(packageName))
                return
            }
            pendingStart = packageName to promise
            Shizuku.bindUserService(userServiceArgs, userConnection)
        } catch (error: Throwable) {
            pendingStart = null
            promise.reject("CAPTURE_BIND_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun stopCapture(promise: Promise) {
        try {
            val service = captureService
            if (service == null) {
                promise.resolve("")
                return
            }
            val report = service.stopAndGetReport()
            captureService = null
            Shizuku.unbindUserService(userServiceArgs, userConnection, true)
            promise.resolve(report)
        } catch (error: Throwable) {
            promise.reject("CAPTURE_STOP_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun getCaptureSnapshot(promise: Promise) {
        try {
            promise.resolve(captureService?.getSnapshot() ?: "")
        } catch (error: Throwable) {
            promise.reject("CAPTURE_SNAPSHOT_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun getCaptureContract(promise: Promise) {
        val result = Arguments.createMap()
        result.putString("scope", "explicit-user-authorized-logcat")
        result.putString("target", "selected-package-only")
        result.putBoolean("readsPasswords", false)
        result.putBoolean("uploadsData", false)
        result.putString("next", "capture-service-active")
        promise.resolve(result)
    }
}
