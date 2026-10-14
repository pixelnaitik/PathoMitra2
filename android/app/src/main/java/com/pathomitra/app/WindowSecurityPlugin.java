package com.pathomitra.app;

import android.app.Activity;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Turns Android's FLAG_SECURE on the app window on or off.
 *
 * Why a plugin exists for one window flag: the setting lives in the web layer
 * (Settings -> Security, persisted through lib/settings.ts), but the thing it
 * controls is a native window attribute the WebView cannot reach from JS.
 *
 * What the flag does: while set, the screen cannot be captured, so screenshots
 * and screen recordings produce a blank page, the Recents thumbnail shows a
 * placeholder instead of live content, and screen-sharing apps capture nothing.
 * That is the point in a console whose every screen lists other people's names
 * alongside their diagnoses, on a phone that may be handed across a bench.
 *
 * Default is ON and it is applied in MainActivity.onCreate, before the bridge
 * has loaded any page. If this call ever fails — a broken plugin registration, an
 * exception, a JS bug — the window simply stays protected rather than silently
 * becoming capturable. Failure has to lean towards the safe state.
 *
 * The lab asked for capturable screens, so this is offered as a switch rather
 * than removed: turning it off is a deliberate, per-device choice in Settings.
 *
 * Threading: Capacitor 8 posts plugin calls onto its own handler thread, and
 * changing a window flag is UI work, so it is raised on the activity's UI thread
 * (the same reason PdfViewerPlugin does it for startActivity).
 */
@CapacitorPlugin(name = "WindowSecurity")
public class WindowSecurityPlugin extends Plugin {

    @PluginMethod
    public void setScreenshotProtection(final PluginCall call) {
        final Boolean enabled = call.getBoolean("enabled");
        final Activity activity = getActivity();
        if (enabled == null) {
            call.reject("setScreenshotProtection requires an 'enabled' boolean");
            return;
        }
        if (activity == null) {
            call.reject("No activity available to change the window flags");
            return;
        }

        activity.runOnUiThread(
            () -> {
                final Window window = activity.getWindow();
                if (window == null) {
                    call.reject("No window available to change the flags");
                    return;
                }
                if (enabled) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
                JSObject result = new JSObject();
                result.put("enabled", enabled);
                call.resolve(result);
            }
        );
    }
}
