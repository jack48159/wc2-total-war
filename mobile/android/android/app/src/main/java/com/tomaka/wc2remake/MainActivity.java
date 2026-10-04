package com.tomaka.wc2remake;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        android.content.SharedPreferences updates = getSharedPreferences("wc2-updates", 0);
        if (updates.getBoolean("trial", false)) updates.edit().putString("active", updates.getString("previous", "")).putBoolean("trial", false).remove("ready").commit();
        String active = updates.getString("active", "");
        java.io.File folder = new java.io.File(getFilesDir(), "wc2-updates/" + active);
        if (active.matches("\\d{14}") && new java.io.File(folder, "index.html").isFile()) bridgeBuilder.setServerPath(new com.getcapacitor.ServerPath(com.getcapacitor.ServerPath.PathType.BASE_PATH, folder.getAbsolutePath()));
        registerPlugin(HotUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) getWindow().getDecorView().setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            android.view.View.SYSTEM_UI_FLAG_FULLSCREEN |
            android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
