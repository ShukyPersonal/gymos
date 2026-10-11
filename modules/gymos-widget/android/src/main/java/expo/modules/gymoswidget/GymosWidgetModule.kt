package expo.modules.gymoswidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// JS-facing API for the workout notification.
//
// `show` (re)posts the notification via WorkoutService; button presses arrive
// as a BROADCAST (so the shade stays open) and are forwarded to JS as an
// `onWidgetAction` event. The foreground service keeps the process alive for
// the whole workout, so a live JS context is guaranteed while the buttons
// exist — the receiver is registered dynamically for that reason.
class GymosWidgetModule : Module() {

  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("GymosWidget")

    Events("onWidgetAction")

    // A button that opens the app (the final set, "Open to edit") carries its
    // action as an intent extra. Without this the app would just open and the
    // set would never be logged — the user would land on the exercise screen
    // with the press effectively lost.
    OnNewIntent { intent ->
      intent.getStringExtra(WorkoutService.EXTRA_ACTION_ID)?.let { id ->
        intent.removeExtra(WorkoutService.EXTRA_ACTION_ID) // consume once
        sendEvent("onWidgetAction", Bundle().apply { putString("actionId", id) })
      }
    }

    // Cold start: the launch intent is already set by the time JS is ready,
    // so JS pulls it explicitly rather than waiting for an event.
    Function("consumeLaunchAction") {
      val activity = appContext.currentActivity ?: return@Function null
      val id = activity.intent?.getStringExtra(WorkoutService.EXTRA_ACTION_ID)
      activity.intent?.removeExtra(WorkoutService.EXTRA_ACTION_ID)
      id
    }

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      val r = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          val actionId = intent?.getStringExtra(WorkoutService.EXTRA_ACTION_ID) ?: return
          this@GymosWidgetModule.sendEvent(
            "onWidgetAction",
            Bundle().apply { putString("actionId", actionId) }
          )
        }
      }
      val filter = IntentFilter(WorkoutService.ACTION_BUTTON)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(r, filter)
      }
      receiver = r
    }

    OnDestroy {
      val context = appContext.reactContext
      receiver?.let { runCatching { context?.unregisterReceiver(it) } }
      receiver = null
    }

    // config: { title, body, buttons: [{ id, title, launchApp? }], chronoUntil? }
    Function("show") { config: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@Function false
      @Suppress("UNCHECKED_CAST")
      val buttons = (config["buttons"] as? List<Map<String, Any?>>) ?: emptyList()

      val intent = Intent(context, WorkoutService::class.java).apply {
        action = WorkoutService.ACTION_SHOW
        putExtra(WorkoutService.EXTRA_TITLE, config["title"] as? String ?: "")
        putExtra(WorkoutService.EXTRA_BODY, config["body"] as? String ?: "")
        putExtra(
          WorkoutService.EXTRA_BUTTON_IDS,
          buttons.map { it["id"] as? String ?: "" }.toTypedArray()
        )
        putExtra(
          WorkoutService.EXTRA_BUTTON_TITLES,
          buttons.map { it["title"] as? String ?: "" }.toTypedArray()
        )
        putExtra(
          WorkoutService.EXTRA_BUTTON_LAUNCH,
          buttons.map { it["launchApp"] as? Boolean ?: false }.toBooleanArray()
        )
        putExtra(
          WorkoutService.EXTRA_CHRONO_UNTIL,
          (config["chronoUntil"] as? Number)?.toLong() ?: 0L
        )
      }
      // startForegroundService is only legal from the foreground; the JS side
      // guards this the same way it did for notifee.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    Function("dismiss") {
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, WorkoutService::class.java).apply {
        action = WorkoutService.ACTION_DISMISS
      }
      runCatching { context.startService(intent) }
      true
    }
  }
}
