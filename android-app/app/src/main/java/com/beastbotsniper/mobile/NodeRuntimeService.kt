package com.beastbotsniper.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

class NodeRuntimeService : Service() {
    companion object {
        const val ACTION_STOP_BOT = "com.beastbotsniper.mobile.STOP_BOT"
        private const val FOREGROUND_CHANNEL = "beastbot_engine"
        private const val TRADE_CHANNEL = "beastbot_trades"
        private const val FOREGROUND_ID = 7101
    }
    private val executor = Executors.newScheduledThreadPool(2)
    private var runtimeLaunchRequested = false
    private var baselineLoaded = false
    private val knownActive = mutableSetOf<String>()
    private val knownClosed = mutableSetOf<String>()
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BeastBotSniper:Engine").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(FOREGROUND_ID, foregroundNotification())
        if (intent?.action == ACTION_STOP_BOT) {
            executor.execute { post("/api/bot/stop") }
            return START_STICKY
        }
        if (!runtimeLaunchRequested) {
            runtimeLaunchRequested = true
            executor.execute { launchNodeRuntime() }
            executor.scheduleWithFixedDelay({ pollTradeEvents() }, 20, 15, TimeUnit.SECONDS)
        }
        return START_STICKY
    }

    private fun launchNodeRuntime() {
        try {
            val root = File(filesDir, "nodejs-project")
            val marker = File(root, ".bundle-version")
            val expectedVersion = "0.1.0-debug"
            if (!root.exists() || !marker.exists() || marker.readText() != expectedVersion) {
                root.deleteRecursively()
                root.mkdirs()
                extractBundle(root)
                marker.writeText(expectedVersion)
            }
            val research = File(filesDir, "data/research")
            research.mkdirs()
            File(filesDir, "tmp").mkdirs()
            android.util.Log.i("BeastBotNode", "Starting embedded Node.js from " + root.absolutePath)
            NodeBridge.startNodeWithArguments(arrayOf("node", "dist/server.cjs"), root.absolutePath, research.absolutePath)
            android.util.Log.e("BeastBotNode", "Embedded Node.js exited")
        } catch (error: Throwable) {
            android.util.Log.e("BeastBotNode", "Node runtime failed", error)
            showTradeNotification("تعذر تشغيل المحرك", error.message ?: "خطأ غير معروف")
        }
    }

    private fun extractBundle(destination: File) {
        ZipInputStream(assets.open("nodejs-project.zip").buffered()).use { zip ->
            var entry = zip.nextEntry
            val rootPath = destination.canonicalPath + File.separator
            while (entry != null) {
                val output = File(destination, entry.name)
                val canonical = output.canonicalPath
                require(canonical.startsWith(rootPath) || canonical == destination.canonicalPath) { "Invalid bundle path" }
                if (entry.isDirectory) output.mkdirs() else {
                    output.parentFile?.mkdirs()
                    FileOutputStream(output).use { out -> zip.copyTo(out) }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
    }

    private fun pollTradeEvents() {
        try {
            val active = getArray("/api/trades/active")
            val closed = getArray("/api/trades/closed")
            val activeNow = active.map { tradeKey(it, false) }.toSet()
            val closedNow = closed.map { tradeKey(it, true) }.toSet()
            if (!baselineLoaded) {
                knownActive.addAll(activeNow)
                knownClosed.addAll(closedNow)
                baselineLoaded = true
                return
            }
            active.forEach { trade ->
                if (knownActive.add(tradeKey(trade, false))) {
                    val symbol = trade.optString("symbol", "رمز غير معروف")
                    val direction = trade.optString("direction", trade.optString("side", ""))
                    showTradeNotification("دخول صفقة: " + symbol, direction)
                }
            }
            closed.forEach { trade ->
                if (knownClosed.add(tradeKey(trade, true))) {
                    val symbol = trade.optString("symbol", "رمز غير معروف")
                    val pnl = firstNumber(trade, arrayOf("pnl", "profit", "netPnl", "realizedPnl", "profitLoss"))
                    val result = if (pnl == null) "تم إغلاق الصفقة" else
                        "النتيجة: " + (if (pnl >= 0) "+" else "") + "$" + String.format("%.2f", pnl)
                    showTradeNotification("إغلاق صفقة: " + symbol, result)
                }
            }
        } catch (error: Exception) {
            android.util.Log.w("BeastBotNode", "Trade event polling failed", error)
        }
    }

    private fun tradeKey(item: JSONObject, closed: Boolean): String {
        val fields = if (closed) arrayOf("closeTime", "exitTime", "closedAt", "timestamp")
            else arrayOf("entryTime", "openTime", "timestamp")
        val time = fields.firstNotNullOfOrNull { field ->
            if (item.has(field) && !item.isNull(field)) item.optString(field) else null
        } ?: ""
        return listOf(item.optString("symbol"), item.optString("direction", item.optString("side")),
            time, item.optString("entryPrice"), item.optString("exitPrice"), item.optString("pnl"))
            .joinToString("|").ifBlank { item.toString() }
    }

    private fun firstNumber(item: JSONObject, fields: Array<String>): Double? {
        for (field in fields) if (item.has(field) && !item.isNull(field)) {
            val value = item.optDouble(field, Double.NaN)
            if (!value.isNaN()) return value
        }
        return null
    }

    private fun getArray(path: String): List<JSONObject> {
        val connection = URL("http://127.0.0.1:3000" + path).openConnection() as HttpURLConnection
        connection.connectTimeout = 2500
        connection.readTimeout = 2500
        return try {
            val parsed = connection.inputStream.bufferedReader().use { it.readText() }.trim()
            val array = if (parsed.startsWith("[")) JSONArray(parsed) else {
                val obj = JSONObject(parsed)
                obj.optJSONArray("trades") ?: obj.optJSONArray("data") ?: JSONArray()
            }
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }
        } finally { connection.disconnect() }
    }

    private fun post(path: String) {
        try {
            val connection = URL("http://127.0.0.1:3000" + path).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.connectTimeout = 2500
            connection.readTimeout = 2500
            connection.doOutput = true
            connection.outputStream.use { it.write("{}".toByteArray()) }
            connection.inputStream.close()
            connection.disconnect()
        } catch (error: Exception) {
            android.util.Log.w("BeastBotNode", "Could not send stop command", error)
        }
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(
            FOREGROUND_CHANNEL, "حالة محرك التداول", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "إشعار استمرار خدمة المحرك المحلي" })
        manager.createNotificationChannel(NotificationChannel(
            TRADE_CHANNEL, "تنبيهات الصفقات", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "إشعارات دخول وخروج الصفقات ونتائجها" })
    }

    private fun foregroundNotification(): Notification {
        val pending = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stopPending = PendingIntent.getService(this, 2,
            Intent(this, NodeRuntimeService::class.java).setAction(ACTION_STOP_BOT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, FOREGROUND_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("BeastBotSniper يعمل محلياً")
            .setContentText("المحرك داخل الهاتف • اضغط لفتح لوحة التحكم")
            .setContentIntent(pending)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_pause),
                "إيقاف التداول", stopPending
            ).build())
            .build()
    }

    private fun showTradeNotification(title: String, message: String) {
        val notification = Notification.Builder(this, TRADE_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title).setContentText(message).setAutoCancel(true).build()
        try {
            getSystemService(NotificationManager::class.java).notify((title + message).hashCode(), notification)
        } catch (error: SecurityException) {
            android.util.Log.w("BeastBotNode", "Notification permission is not granted", error)
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        try { wakeLock?.release() } catch (_: Exception) {}
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
