# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:
# Native-module classes the C++ side finds by name (JNI), which R8 would otherwise rename or remove.
-keep class com.margelo.nitro.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.reactnativecommunity.webview.** { *; }
-keep class com.oblador.keychain.** { *; }
-keep class com.reactnativegooglesignin.** { *; }
-dontwarn com.google.android.gms.**
