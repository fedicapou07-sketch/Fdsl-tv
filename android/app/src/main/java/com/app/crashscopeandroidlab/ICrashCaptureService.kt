package com.app.crashscopeandroidlab

import android.os.Binder
import android.os.IBinder
import android.os.IInterface
import android.os.Parcel

interface ICrashCaptureService : IInterface {
    fun destroy()
    fun exit()
    fun start(packageName: String): Boolean
    fun stopAndGetReport(): String
    fun getSnapshot(): String
    fun clear()
    fun getUid(): Int

    abstract class Stub : Binder(), ICrashCaptureService {
        companion object {
            private const val DESCRIPTOR = "com.app.crashscopeandroidlab.ICrashCaptureService"
            private const val TRANSACTION_START = IBinder.FIRST_CALL_TRANSACTION + 1
            private const val TRANSACTION_STOP = IBinder.FIRST_CALL_TRANSACTION + 2
            private const val TRANSACTION_SNAPSHOT = IBinder.FIRST_CALL_TRANSACTION + 3
            private const val TRANSACTION_CLEAR = IBinder.FIRST_CALL_TRANSACTION + 4
            private const val TRANSACTION_UID = IBinder.FIRST_CALL_TRANSACTION + 5
            private const val TRANSACTION_EXIT = 1
            private const val TRANSACTION_DESTROY = 16777114

            fun asInterface(binder: IBinder?): ICrashCaptureService? {
                if (binder == null) return null
                val local = binder.queryLocalInterface(DESCRIPTOR)
                return if (local is ICrashCaptureService) local else Proxy(binder)
            }
        }

        init { attachInterface(this, DESCRIPTOR) }

        override fun asBinder(): IBinder = this

        override fun onTransact(code: Int, data: Parcel, reply: Parcel, flags: Int): Boolean {
            if (code == INTERFACE_TRANSACTION) {
                reply.writeString(DESCRIPTOR)
                return true
            }
            data.enforceInterface(DESCRIPTOR)
            return when (code) {
                TRANSACTION_DESTROY -> {
                    destroy()
                    true
                }
                TRANSACTION_EXIT -> {
                    exit()
                    true
                }
                TRANSACTION_START -> {
                    val result = start(data.readString().orEmpty())
                    reply.writeNoException()
                    reply.writeInt(if (result) 1 else 0)
                    true
                }
                TRANSACTION_STOP -> {
                    reply.writeNoException()
                    reply.writeString(stopAndGetReport())
                    true
                }
                TRANSACTION_SNAPSHOT -> {
                    reply.writeNoException()
                    reply.writeString(getSnapshot())
                    true
                }
                TRANSACTION_CLEAR -> {
                    clear()
                    reply.writeNoException()
                    true
                }
                TRANSACTION_UID -> {
                    reply.writeNoException()
                    reply.writeInt(getUid())
                    true
                }
                else -> super.onTransact(code, data, reply, flags)
            }
        }

        private class Proxy(private val remote: IBinder) : ICrashCaptureService {
            override fun asBinder(): IBinder = remote

            override fun start(packageName: String): Boolean = transactBoolean(TRANSACTION_START) {
                writeString(packageName)
            }

            override fun stopAndGetReport(): String = transactString(TRANSACTION_STOP)
            override fun getSnapshot(): String = transactString(TRANSACTION_SNAPSHOT)

            override fun clear() {
                transact(TRANSACTION_CLEAR) { }
            }

            override fun getUid(): Int {
                val data = Parcel.obtain()
                val reply = Parcel.obtain()
                try {
                    data.writeInterfaceToken(DESCRIPTOR)
                    remote.transact(TRANSACTION_UID, data, reply, 0)
                    reply.readException()
                    return reply.readInt()
                } finally {
                    data.recycle()
                    reply.recycle()
                }
            }

            private fun transactString(code: Int): String {
                val data = Parcel.obtain()
                val reply = Parcel.obtain()
                try {
                    data.writeInterfaceToken(DESCRIPTOR)
                    remote.transact(code, data, reply, 0)
                    reply.readException()
                    return reply.readString().orEmpty()
                } finally {
                    data.recycle()
                    reply.recycle()
                }
            }

            private fun transactBoolean(code: Int, writer: Parcel.() -> Unit): Boolean {
                val data = Parcel.obtain()
                val reply = Parcel.obtain()
                try {
                    data.writeInterfaceToken(DESCRIPTOR)
                    data.writer()
                    remote.transact(code, data, reply, 0)
                    reply.readException()
                    return reply.readInt() != 0
                } finally {
                    data.recycle()
                    reply.recycle()
                }
            }

            private fun transact(code: Int, writer: Parcel.() -> Unit) {
                val data = Parcel.obtain()
                val reply = Parcel.obtain()
                try {
                    data.writeInterfaceToken(DESCRIPTOR)
                    data.writer()
                    remote.transact(code, data, reply, 0)
                    reply.readException()
                } finally {
                    data.recycle()
                    reply.recycle()
                }
            }
        }
    }
}
