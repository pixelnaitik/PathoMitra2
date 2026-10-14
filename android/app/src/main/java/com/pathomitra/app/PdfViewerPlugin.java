package com.pathomitra.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Opens a file the app has already written in whatever viewer the device
 * resolves for its type — for report PDFs that is Chrome, Drive, or the OEM
 * PDF viewer, whichever the user picks.
 *
 * Why a plugin is needed at all: the WebView has no inline PDF renderer and
 * ignores `window.open`, so "preview a report" on the APK used to end at the
 * system print sheet. A VIEW intent over the saved copy is the real preview:
 * the document opens in a proper reader with paging and zoom.
 *
 * The file:// URI the Filesystem plugin returns is useless to another app on
 * Android 7+ (file:// extras are rejected outright), so the URI is converted
 * through the FileProvider declared in AndroidManifest — the same provider the
 * Share plugin uses — which issues a content:// URI carrying a one-shot read
 * grant. The provider's paths table only exposes the app's `PathoMitra/`
 * folder, so the grant cannot leak anything else.
 *
 * Threading: Capacitor 8 posts plugin method calls onto its own "CapacitorHandler"
 * thread rather than the UI thread, and starting an activity is UI work, so the
 * intent is raised on the activity's UI thread.
 *
 * A device with no PDF-capable app at all rejects the call with
 * "No app on this device can open this file"; the JS layer (lib/native-print)
 * then falls back to the print sheet, which still renders every page.
 */
@CapacitorPlugin(name = "PdfViewer")
public class PdfViewerPlugin extends Plugin {

    @PluginMethod
    public void openFile(PluginCall call) {
        final String uri = call.getString("uri");
        final String mimeType = call.getString("mimeType", "application/pdf");
        final Activity activity = getActivity();
        if (uri == null || uri.isEmpty()) {
            call.reject("No file URI supplied to open");
            return;
        }
        if (activity == null) {
            call.reject("No activity available to open the file");
            return;
        }

        activity.runOnUiThread(
            () -> {
                try {
                    Uri source = Uri.parse(uri);
                    if ("file".equals(source.getScheme())) {
                        source = FileProvider.getUriForFile(
                                activity,
                                activity.getPackageName() + ".fileprovider",
                                new File(source.getPath()));
                    }
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(source, mimeType);
                    // The viewing app gets read access to this one URI only.
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    // Where several viewers are installed and none is the
                    // default, the system resolver shows its own "Open with"
                    // sheet, remembering the user's choice.
                    activity.startActivity(view);
                    call.resolve();
                } catch (ActivityNotFoundException e) {
                    call.reject("No app on this device can open this file", e);
                } catch (IllegalArgumentException e) {
                    // The path sits outside the FileProvider table — a write
                    // that landed somewhere unexpected, not a user error.
                    call.reject("The file is outside the paths this app may hand out", e);
                }
            }
        );
    }
}
