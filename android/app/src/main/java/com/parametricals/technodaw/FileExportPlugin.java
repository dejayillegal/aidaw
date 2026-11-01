package com.parametricals.technodaw;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Arrays;

@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    private Uri uri;
    private OutputStream output;
    private MessageDigest digest;
    private long written;
    private boolean busy;

    @PluginMethod
    public synchronized void begin(PluginCall call) {
        if (busy) { call.reject("Another file save is in progress", "SAVE_BUSY"); return; }
        String filename = call.getString("filename");
        if (filename == null || filename.trim().isEmpty()) { call.reject("Filename required", "SAVE_NAME"); return; }
        busy = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[\\\\/\\p{Cntrl}]", "_"));
        try { startActivityForResult(call, intent, "destinationSelected"); }
        catch (Exception e) { cleanup(true); call.reject("Cannot open document picker", "SAVE_PICKER", e); }
    }

    @ActivityCallback
    private synchronized void destinationSelected(PluginCall call, ActivityResult result) {
        if (call == null) { cleanup(true); return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            cleanup(true); call.reject("Save cancelled", "SAVE_CANCELLED"); return;
        }
        try {
            busy = true;
            uri = result.getData().getData();
            if (uri == null) throw new Exception("No destination URI returned");
            output = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (output == null) throw new Exception("Destination is not writable");
            digest = MessageDigest.getInstance("SHA-256"); written = 0;
            call.resolve();
        } catch (Exception e) { cleanup(true); call.reject("Cannot open destination", "SAVE_OPEN", e); }
    }

    @PluginMethod
    public synchronized void append(PluginCall call) {
        if (output == null) { call.reject("No open destination", "SAVE_SESSION"); return; }
        try {
            String encoded = call.getString("base64");
            if (encoded == null || encoded.length() > 262144) throw new Exception("Invalid chunk size");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            output.write(bytes); digest.update(bytes); written += bytes.length;
            call.resolve();
        } catch (Exception e) { cleanup(true); call.reject("File write failed", "SAVE_WRITE", e); }
    }

    @PluginMethod
    public synchronized void finish(PluginCall call) {
        if (output == null) { call.reject("No open destination", "SAVE_SESSION"); return; }
        try {
            Integer expected = call.getInt("sizeBytes");
            if (expected == null || expected != written || written == 0) throw new Exception("Output byte count mismatch");
            output.flush(); output.close(); output = null;
            byte[] expectedHash = digest.digest();
            MessageDigest readHash = MessageDigest.getInstance("SHA-256");
            long read = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("Cannot reopen saved document");
                byte[] block = new byte[65536]; int count;
                while ((count = input.read(block)) != -1) { readHash.update(block, 0, count); read += count; }
            }
            if (read != written || !Arrays.equals(expectedHash, readHash.digest())) throw new Exception("Saved document verification failed");
            StringBuilder hex = new StringBuilder();
            for (byte b : expectedHash) hex.append(String.format("%02x", b & 255));
            JSObject res = new JSObject(); res.put("uri", uri.toString());
            res.put("sizeBytes", written); res.put("sha256", hex.toString());
            cleanup(false); call.resolve(res);
        } catch (Exception e) { cleanup(true); call.reject("Cannot verify saved document", "SAVE_VERIFY", e); }
    }

    @PluginMethod
    public synchronized void abort(PluginCall call) { cleanup(true); call.resolve(); }

    private void cleanup(boolean delete) {
        if (output != null) try { output.close(); } catch (Exception ignored) { }
        if (delete && uri != null) try { DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { }
        uri = null; output = null; digest = null; written = 0; busy = false;
    }

    @Override
    protected synchronized void handleOnDestroy() { cleanup(true); }
}
