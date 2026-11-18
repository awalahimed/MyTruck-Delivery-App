package __PACKAGE__

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Shows the error when the app crashes, instead of only Android's "keeps stopping" message.
 *
 * Added to the Android build by plugins/withCrashReporter.js. Runs in its own process (":crash"),
 * so it still works when the crash happens while the app itself is starting.
 */
class CrashReportActivity : Activity() {

  companion object {
    private const val EXTRA_REPORT = "mytruck_crash_report"
    private const val REPORT_FILE = "mytruck_last_crash.txt"

    private fun processName(): String {
      return try {
        if (Build.VERSION.SDK_INT >= 28) {
          Application.getProcessName() ?: ""
        } else {
          File("/proc/self/cmdline").readText().trim { it <= ' ' }
        }
      } catch (e: Throwable) {
        ""
      }
    }

    @JvmStatic
    fun isCrashProcess(): Boolean = processName().endsWith(":crash")

    @JvmStatic
    fun install(app: Application) {
      if (isCrashProcess()) return
      val previous = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        try {
          val report = buildReport(app, thread, error)
          try {
            File(app.filesDir, REPORT_FILE).writeText(report)
          } catch (ignored: Throwable) {
          }
          val intent = Intent(app, CrashReportActivity::class.java)
            .putExtra(EXTRA_REPORT, report.take(60000))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          app.startActivity(intent)
          Process.killProcess(Process.myPid())
          System.exit(10)
        } catch (ignored: Throwable) {
          previous?.uncaughtException(thread, error)
        }
      }
    }

    private fun buildReport(app: Application, thread: Thread, error: Throwable): String {
      val version = try {
        app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "?"
      } catch (e: Throwable) {
        "?"
      }
      val trace = StringWriter()
      error.printStackTrace(PrintWriter(trace))
      return "MyTruck $version · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · " +
        "${Build.MANUFACTURER} ${Build.MODEL}\nThread: ${thread.name}\n\n$trace"
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val report = intent?.getStringExtra(EXTRA_REPORT)
      ?: try { File(filesDir, REPORT_FILE).readText() } catch (e: Throwable) { "No error details were saved." }

    val pad = (16 * resources.displayMetrics.density).toInt()
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#0B2A26"))
      setPadding(pad, pad * 3, pad, pad * 2)
    }
    root.addView(TextView(this).apply {
      text = "MyTruck stopped because of an error"
      setTextColor(Color.WHITE)
      textSize = 20f
      setTypeface(typeface, Typeface.BOLD)
    })
    root.addView(TextView(this).apply {
      text = "Please tap \"Share error\" (or take a screenshot) and send it to the MyTruck team."
      setTextColor(Color.parseColor("#CBD5E1"))
      textSize = 13f
      setPadding(0, pad / 2, 0, pad)
    })
    val scroll = ScrollView(this).apply {
      setBackgroundColor(Color.parseColor("#06201C"))
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
    }
    scroll.addView(TextView(this).apply {
      text = report
      setTextColor(Color.parseColor("#FCA5A5"))
      textSize = 11f
      typeface = Typeface.MONOSPACE
      setTextIsSelectable(true)
      setPadding(pad / 2, pad / 2, pad / 2, pad / 2)
    })
    root.addView(scroll)

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, pad, 0, 0)
    }
    fun button(label: String, action: () -> Unit) = Button(this).apply {
      text = label
      layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      setOnClickListener { action() }
    }
    buttons.addView(button("Copy") {
      val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("MyTruck error", report))
      Toast.makeText(this, "Error copied", Toast.LENGTH_SHORT).show()
    })
    buttons.addView(button("Share error") {
      val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, report)
      startActivity(Intent.createChooser(send, "Share error"))
    })
    buttons.addView(button("Close") { finishAndRemoveTask() })
    root.addView(buttons)
    setContentView(root)
  }
}
