package com.pathomitra.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * The Capacitor bridge host.
 *
 * Screenshot and screen-recording protection (Android's FLAG_SECURE) is ON by
 * default and is applied here, before the WebView loads anything, so there is no
 * unprotected window between launch and the first JS tick. The lab asked for
 * capturable screens, so it is a switch rather than a hard rule —
 * WindowSecurityPlugin clears the flag when Settings -> Security -> "Allow
 * screenshots" is on, and leaves it set if that call never arrives. Turning the
 * protection off is therefore a deliberate per-device choice, not the default a
 * fresh install of a pathology console makes.
 *
 * Print / share / PDF output paths are unchanged: FLAG_SECURE blocks screen
 * capture only, never the print framework or a FileProvider grant.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin only feeds the bridge builder that super.onCreate()
        // consumes, so an app-defined plugin has to be declared before that call.
        registerPlugin(PdfViewerPlugin.class);
        registerPlugin(WindowSecurityPlugin.class);

        // Fail closed: protection is the starting state, and JS has to opt out.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);

        super.onCreate(savedInstanceState);
    }
}
