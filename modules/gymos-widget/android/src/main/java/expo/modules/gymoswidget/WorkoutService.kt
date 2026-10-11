package expo.modules.gymoswidget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Foreground service that owns the workout notification.
//
// Why this exists instead of notifee: notifee builds every action press as an
// ACTIVITY PendingIntent (its transparent trampoline). Android ALWAYS collapses
// the notification shade when an action starts an activity, which dumped the
// user back to their home screen mid-workout. A BROADCAST PendingIntent does
// not collapse the shade — but notifee gives no way to supply one, so we build
// the notification ourselves.
//
// Owning the service also lets us pass FOREGROUND_SERVICE_TYPE_SPECIAL_USE to
// startForeground() explicitly, rather than relying on the manifest to override
// notifee's default SHORT_SERVICE (whose ~3-minute deadline used to ANR-kill
// the app mid-workout).
class WorkoutService : Service() {

  companion object {
    const val CHANNEL_ID = "gymos-workout"
    const val NOTIF_ID = 4711

    const val ACTION_SHOW = "expo.modules.gymoswidget.SHOW"
    const val ACTION_DISMISS = "expo.modules.gymoswidget.DISMISS"
    // Broadcast sent when a notification button is pressed.
    const val ACTION_BUTTON = "expo.modules.gymoswidget.BUTTON"
    const val EXTRA_ACTION_ID = "actionId"

    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    // Parallel arrays: buttons[i] is labelled titles[i] and reports ids[i].
    const val EXTRA_BUTTON_IDS = "buttonIds"
    const val EXTRA_BUTTON_TITLES = "buttonTitles"
    // Buttons that should open the app instead of acting silently.
    const val EXTRA_BUTTON_LAUNCH = "buttonLaunch"
    // Countdown: when > 0, Android renders a live chronometer to this instant.
    const val EXTRA_CHRONO_UNTIL = "chronoUntil"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_DISMISS -> {
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val notification = build(intent)
        startForegroundCompat(notification)
      }
    }
    // Do NOT restart with a null intent if the process dies — a workout that
    // ended shouldn't resurrect a stale notification.
    return START_NOT_STICKY
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  @Suppress("DEPRECATION")
  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      stopForeground(true)
    }
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIF_ID)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Workout",
      NotificationManager.IMPORTANCE_LOW // silent; the bell is a separate channel
    ).apply {
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    nm.createNotificationChannel(channel)
  }

  private fun build(intent: Intent?): Notification {
    ensureChannel()

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Workout"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    val ids = intent?.getStringArrayExtra(EXTRA_BUTTON_IDS) ?: emptyArray()
    val titles = intent?.getStringArrayExtra(EXTRA_BUTTON_TITLES) ?: emptyArray()
    val launch = intent?.getBooleanArrayExtra(EXTRA_BUTTON_LAUNCH) ?: BooleanArray(ids.size)
    val chronoUntil = intent?.getLongExtra(EXTRA_CHRONO_UNTIL, 0L) ?: 0L

    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)     // per-second countdown updates stay silent
      .setAutoCancel(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(launchAppIntent())

    if (chronoUntil > 0L) {
      builder.setUsesChronometer(true)
        .setChronometerCountDown(true)
        .setWhen(chronoUntil)
        .setShowWhen(true)
    } else {
      builder.setShowWhen(false)
    }

    for (i in ids.indices) {
      val id = ids[i]
      val label = if (i < titles.size) titles[i] else id
      val wantsLaunch = i < launch.size && launch[i]
      val pi = if (wantsLaunch) launchAppIntent(id) else broadcastIntent(id)
      builder.addAction(0, label, pi)
    }

    return builder.build()
  }

  // Broadcast PendingIntent — the whole point: pressing this does NOT collapse
  // the notification shade, unlike an activity intent.
  private fun broadcastIntent(actionId: String): PendingIntent {
    val intent = Intent(ACTION_BUTTON).apply {
      setPackage(packageName)
      putExtra(EXTRA_ACTION_ID, actionId)
    }
    return PendingIntent.getBroadcast(
      this,
      actionId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun launchAppIntent(actionId: String? = null): PendingIntent {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      if (actionId != null) putExtra(EXTRA_ACTION_ID, actionId)
    }
    return PendingIntent.getActivity(
      this,
      (actionId ?: "open").hashCode(),
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
