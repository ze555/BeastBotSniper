package com.beastbotsniper.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var status: TextView
    private var attempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val frame = FrameLayout(this)
        status = TextView(this).apply {
            text = "جاري تشغيل محرك BeastBotSniper محلياً...\nقد يستغرق التحضير الأول عدة دقائق."
            textSize = 17f
            gravity = android.view.Gravity.CENTER
            setPadding(32, 32, 32, 32)
        }
        webView = WebView(this).apply {
            visibility = View.GONE
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.host == "127.0.0.1" || uri.host == "localhost") return false
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
            }
        }
        frame.addView(webView, FrameLayout.LayoutParams(-1, -1))
        frame.addView(status, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        requestNotificationPermissionAndStart()
    }

    private fun requestNotificationPermissionAndStart() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 71)
        } else startLocalEngine()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 71) startLocalEngine()
    }

    private fun startLocalEngine() {
        val intent = Intent(this, NodeRuntimeService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
        Thread {
            while (attempts < 180) {
                attempts++
                try {
                    val connection = URL("http://127.0.0.1:3000/api/health").openConnection() as HttpURLConnection
                    connection.connectTimeout = 1200
                    connection.readTimeout = 1200
                    val ready = connection.responseCode == 200
                    connection.disconnect()
                    if (ready) {
                        runOnUiThread {
                            status.visibility = View.GONE
                            webView.visibility = View.VISIBLE
                            webView.loadUrl("http://127.0.0.1:3000")
                        }
                        return@Thread
                    }
                } catch (_: Exception) {}
                Thread.sleep(1000)
            }
            runOnUiThread { status.text = "لم يبدأ الخادم المحلي بعد.\nأغلق التطبيق وافتحه مجدداً، وتأكد من وجود مساحة تخزين كافية." }
        }.start()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
