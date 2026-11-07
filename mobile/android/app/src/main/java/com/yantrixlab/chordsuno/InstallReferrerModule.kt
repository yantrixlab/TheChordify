package com.yantrixlab.chordsuno

import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * What Google Play remembers about the link the app was installed from (the "referrer" part of its address). An influencer's link
 * (chordsuno.com/r/<name>/app) sends a phone to Play with "ref=<name>" attached; the app asks for it once, on its first start.
 * Answers null when there is none, or when Play cannot say (a sideloaded build, no Play services).
 */
class InstallReferrerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "InstallReferrer"

  @ReactMethod
  fun getReferrer(promise: Promise) {
    val client: InstallReferrerClient
    try {
      client = InstallReferrerClient.newBuilder(reactApplicationContext).build()
    } catch (e: Exception) {
      promise.resolve(null)
      return
    }
    try {
      client.startConnection(
        object : InstallReferrerStateListener {
          override fun onInstallReferrerSetupFinished(responseCode: Int) {
            try {
              if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                promise.resolve(client.installReferrer.installReferrer)
              } else {
                promise.resolve(null)
              }
            } catch (e: Exception) {
              promise.resolve(null)
            } finally {
              try {
                client.endConnection()
              } catch (e: Exception) {
                // nothing to close
              }
            }
          }

          override fun onInstallReferrerServiceDisconnected() {
            // nothing to do: it is asked for once
          }
        },
      )
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }
}

class InstallReferrerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(InstallReferrerModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
