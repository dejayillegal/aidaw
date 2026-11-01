package com.parametricals.technodaw;

import static org.junit.Assert.*;
import android.app.Activity;
import android.content.Intent;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs against the installed APK, including its actual bundled production JS. */
@RunWith(AndroidJUnit4.class)
public class StartupSmokeTest {
    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private String evaluate(Activity activity, WebView webView, String script) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        activity.runOnUiThread(() -> webView.evaluateJavascript(script, value -> {
            result.set(value);
            ready.countDown();
        }));
        assertTrue("WebView JavaScript timed out", ready.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    @Test
    public void bundledWorkstationLoadsAndRendersAudioOffline() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        assertNotNull("Launcher intent missing", intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = instrumentation.startActivitySync(intent);
        try {
            AtomicReference<WebView> reference = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> reference.set(findWebView(activity.getWindow().getDecorView())));
            WebView webView = reference.get();
            assertNotNull("Capacitor WebView missing", webView);
            boolean rendered = false;
            for (int attempt = 0; attempt < 120; attempt++) {
                String state = evaluate(activity, webView,
                    "Boolean(document.querySelector('#root')?.textContent.length > 200 && document.querySelectorAll('button').length > 5)");
                if ("true".equals(state)) { rendered = true; break; }
                Thread.sleep(500);
            }
            assertTrue("Bundled React workstation did not render", rendered);
            assertEquals("Bundled local origin required", "\"https://localhost\"",
                evaluate(activity, webView, "location.origin"));
            evaluate(activity, webView,
                "window.__nativeSmoke='running'; (async()=>{try {" +
                "const c=new OfflineAudioContext(1,4410,44100);const o=c.createOscillator();o.connect(c.destination);o.start();" +
                "const b=await c.startRendering();if(!b.getChannelData(0).some(x=>Math.abs(x)>0.01))throw Error('Silent audio');" +
                "const input='<Ableton><LiveSet/></Ableton>';" +
                "const gz=await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();" +
                "const text=await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();" +
                "if(text!==input)throw Error('Gzip roundtrip');window.__nativeSmoke='passed';" +
                "}catch(e){window.__nativeSmoke='failed: '+e.message}})();true");
            String state = "";
            for (int attempt = 0; attempt < 60; attempt++) {
                state = evaluate(activity, webView, "window.__nativeSmoke");
                if (!"\"running\"".equals(state)) break;
                Thread.sleep(500);
            }
            assertEquals("Offline Web Audio and gzip roundtrip: " + state, "\"passed\"", state);
        } finally {
            activity.runOnUiThread(activity::finish);
        }
    }
}
