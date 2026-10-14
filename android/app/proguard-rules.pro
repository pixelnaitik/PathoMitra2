# ---------------------------------------------------------------------------
# PathLab OS — release (R8) rules.
#
# Capacitor ships consumer rules for its own plugin classes, @PluginMethod,
# @PermissionCallback / @ActivityCallback / @Permission annotations, so those
# are covered by :capacitor-android. What is left here is the reflection that
# minification otherwise strips silently — the failure would only appear at
# runtime, on a plugin call, in the shipped APK.
# ---------------------------------------------------------------------------

# The JS <-> native bridge entry point. R8 full mode does not keep annotated
# WebView methods on its own, and losing this breaks every plugin call.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Plugin option/DTO classes are populated by Gson from JS payloads; R8 renaming
# or removing the fields turns every call into a null.
-keep class * extends com.getcapacitor.Plugin { *; }
-keep class * extends com.getcapacitor.PluginCall { *; }
-keep class com.getcapacitor.** { *; }

# @capacitor-community/sqlite + SQLCipher: the plugin reflects over its own
# models, and SQLCipher's native/JNI layer must not be renamed.
-keep class com.getcapacitor.community.database.** { *; }
-keep class net.zetetic.database.** { *; }
-keep class net.sqlcipher.** { *; }

# @capgo/capacitor-printer carries a patched PdfDocumentAdapter that Android's
# PrintManager drives through a public API surface.
-keep class com.capgo.printer.** { *; }

# @aparajita biometric auth + secure storage reflect into Keystore / BiometricPrompt.
-keep class com.aparajita.capacitor.** { *; }

# Cordova shim module is inert today (no plugins), but its loader reflects by
# class name from cordova_plugins.js if a plugin is ever added.
-keep class org.apache.cordova.** { *; }

# Compile-time-only annotation classes referenced by Google Tink, which arrives
# transitively with SQLCipher / the secure-storage plugin. They are not on the
# Android runtime classpath and nothing needs them at runtime, but R8 fails the
# release build on the dangling references unless they are silenced.
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.Nonnull
-dontwarn javax.annotation.concurrent.GuardedBy

# Readable stack traces for the on-device crash log (src/lib/telemetry.ts).
# Without this the ring buffer records only obfuscated frames, which is useless
# for diagnosing a field failure in a build we cannot attach a debugger to.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
