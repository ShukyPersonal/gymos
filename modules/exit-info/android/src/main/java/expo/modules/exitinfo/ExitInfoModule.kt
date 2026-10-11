package expo.modules.exitinfo

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reads Android's historical process-exit records so the app can log WHY its
// previous process died (ANR / signal / freezer / FGS policy / OOM / ...).
class ExitInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExitInfo")

    Function("getRecentExitReasons") { maxCount: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return@Function emptyList<Map<String, Any?>>()
      }
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
      val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.getHistoricalProcessExitReasons(context.packageName, 0, maxCount).map { info ->
        mapOf(
          "reason" to reasonName(info.reason),
          "reasonCode" to info.reason,
          "description" to (info.description ?: ""),
          "timestamp" to info.timestamp,
          "importance" to info.importance,
          "status" to info.status
        )
      }
    }
  }

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "ANR"
    ApplicationExitInfo.REASON_CRASH -> "CRASH"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
    ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
    ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
    ApplicationExitInfo.REASON_OTHER -> "OTHER"
    ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
    ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
    ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
    ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
    else -> "UNKNOWN_$reason"
  }
}
