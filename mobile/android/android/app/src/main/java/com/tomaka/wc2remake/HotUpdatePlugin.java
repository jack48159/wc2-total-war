package com.tomaka.wc2remake;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.HashSet;

@CapacitorPlugin(name = "Wc2Updater")
public class HotUpdatePlugin extends Plugin {
    private static final String ORIGIN = "https://208.87.207.49";
    private static final String BUCKET = "https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com";
    private static final String KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtwfLjT9ZSRBF0haS4Kl6H8VsYtecwjFp6xC1WkpHYxBRiPCWWOBATugSDK6Y/nIMb+6wdt60i2xkYbN8E6I7MOBGzvTquoqMLwQ7vTgTRktMU3MaDq4zeSWfXGqkJiVuvBMJjQ0R5x/6SknPsIwW/HolFAkiRgRyLx4LF5e9JpRlQg9pTw3pfLOMtnAFq6X4zfN4b9Ut+crd+wCz72VZwZ4kDEa+SVbkY/mj05hPJR5WxVzQKY9Py/vUvIKIwxLQGpHBkwqOWp/7ON2r4GM2HUspULeTw/ItQqCalKFt8MSAu2Lww/wVhL2zKbQZNKZq3DOVx0hgJ7cRRU+MgddTWQIDAQAB";
    private volatile boolean running;
    private volatile int done, total;
    private volatile long downloaded;
    private volatile String error;
    private SharedPreferences prefs() { return getContext().getSharedPreferences("wc2-updates", 0); }
    private File root() { return new File(getContext().getFilesDir(), "wc2-updates"); }
    private String value(String key) { return prefs().getString(key, ""); }
    private boolean valid(String path) { return path.matches("[A-Za-z0-9_@.\\-/\\u0080-\\uFFFF]+") && !path.startsWith("/") && !path.contains("\\") && java.util.Arrays.stream(path.split("/", -1)).noneMatch(p -> p.isEmpty() || p.equals(".") || p.equals("..")); }
    private InputStream network(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(60000);
        if (c.getResponseCode() != 200) { c.disconnect(); throw new IOException("下载失败"); }
        return new FilterInputStream(c.getInputStream()) { public void close() throws IOException { super.close(); c.disconnect(); } };
    }
    private byte[] readSmall(String url) throws Exception {
        try (InputStream in = network(url); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[8192]; int n; while ((n = in.read(b)) != -1) { if (out.size() + n > 4000000) throw new IOException("清单过大"); out.write(b,0,n); } return out.toByteArray();
        }
    }
    private String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte v:b) s.append(String.format("%02x",v & 255)); return s.toString(); }
    private boolean copyVerified(InputStream in, File out, long size, String hash) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256"); long bytes = 0;
        try (InputStream source = in; OutputStream dest = new FileOutputStream(out)) {
            byte[] b = new byte[65536]; int n; while ((n = source.read(b)) != -1) { bytes += n; if (bytes > size) return false; md.update(b,0,n); dest.write(b,0,n); }
        }
        return bytes == size && hex(md.digest()).equals(hash);
    }
    private void remove(File f) { if (f.isDirectory()) { File[] kids = f.listFiles(); if (kids != null) for (File child:kids) remove(child); } if (f.exists() && !f.delete()) throw new RuntimeException("无法清理旧更新"); }
    @Override public void load() {
        root().mkdirs();
    }
    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject(); result.put("running",running);result.put("done",done);result.put("total",total);result.put("downloaded",downloaded);result.put("ready",value("ready"));result.put("active",value("active"));result.put("shell",1);if(error != null)result.put("error",error);call.resolve(result);
    }
    @PluginMethod public synchronized void prepare(PluginCall call) {
        if (running) { call.resolve(); return; } running=true;done=0;total=0;downloaded=0;error=null;
        new Thread(() -> {
            File staging=null;
            try {
                JSONObject envelope=new JSONObject(new String(readSmall(BUCKET + "/updates/stable.json"),"UTF-8"));
                byte[] payload=Base64.decode(envelope.getString("payload"),Base64.DEFAULT);
                Signature signature=Signature.getInstance("SHA256withRSA");signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.decode(KEY,Base64.DEFAULT))));signature.update(payload);
                if(!signature.verify(Base64.decode(envelope.getString("signature"),Base64.DEFAULT)))throw new IOException("更新签名无效");
                JSONObject m=new JSONObject(new String(payload,"UTF-8"));String release=m.getString("release"),base=m.getString("base");
                if(!release.matches("\\d{14}") || m.getInt("shell")>1 || !m.getString("protocol").equals("wc2-1") || !base.equals(BUCKET + "/web/releases/" + release + "/"))throw new IOException("需要安装新版程序");
                JSONArray files=m.getJSONArray("files");total=files.length();if(total>10000)throw new IOException("清单过大");
                HashSet<String> names=new HashSet<>();long sum=0;
                for(int i=0;i<total;i++){JSONObject f=files.getJSONObject(i);String p=f.getString("path");long size=f.getLong("size");if(!valid(p)||!names.add(p)||size<0||size>100000000||!f.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("更新文件无效");sum+=size;}
                if(sum>2000000000L||!names.contains("index.html")||!names.contains("runtime-config.js"))throw new IOException("更新不完整");
                if(release.equals(value("active")))return;
                staging=new File(root(),release+".staging");remove(staging);if(!staging.mkdirs())throw new IOException("空间不足");
                for(int i=0;i<total;i++) {
                    JSONObject f=files.getJSONObject(i);String p=f.getString("path"),hash=f.getString("sha256");long size=f.getLong("size");File dest=new File(staging,p);dest.getParentFile().mkdirs();boolean reused=false;
                    File old=new File(new File(root(),value("active")),p);
                    if(!value("active").isEmpty()&&old.isFile()&&old.length()==size)reused=copyVerified(new FileInputStream(old),dest,size,hash);
                    if(!reused)try{reused=copyVerified(getContext().getAssets().open("public/"+p),dest,size,hash);}catch(FileNotFoundException ignored){}
                    if(!reused) { StringBuilder encoded=new StringBuilder();for(String part:p.split("/")){if(encoded.length()>0)encoded.append('/');encoded.append(URLEncoder.encode(part,"UTF-8").replace("+","%20"));}
                        if(!copyVerified(network(base+encoded),dest,size,hash))throw new IOException("文件校验失败："+p);downloaded+=size; }
                    done++;
                }
                File target=new File(root(),release);remove(target);if(!staging.renameTo(target))throw new IOException("无法完成更新");prefs().edit().putString("ready",release).commit();
            }catch(Exception e){error=e.getMessage();if(staging!=null)try{remove(staging);}catch(Exception ignored){}}finally{running=false;}
        },"wc2-update").start();call.resolve();
    }
    @PluginMethod public void activate(PluginCall call) {
        String ready=value("ready");if(running||!ready.matches("\\d{14}")){call.reject("更新尚未准备完成");return;}
        prefs().edit().putString("previous",value("active")).putString("active",ready).putBoolean("trial",true).remove("ready").commit();
        call.resolve();getActivity().runOnUiThread(()->bridge.setServerBasePath(new File(root(),ready).getAbsolutePath()));
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(()->{if(prefs().getBoolean("trial",false)){String previous=value("previous");prefs().edit().putString("active",previous).putBoolean("trial",false).commit();if(previous.matches("\\d{14}"))bridge.setServerBasePath(new File(root(),previous).getAbsolutePath());else bridge.setServerAssetPath("public");}},120000);
    }
    @PluginMethod public void ready(PluginCall call) {
        prefs().edit().putBoolean("trial",false).commit();
        File[] dirs=root().listFiles();if(dirs!=null)for(File dir:dirs)if(dir.getName().matches("\\d{14}")&&!dir.getName().equals(value("active"))&&!dir.getName().equals(value("previous"))&&!dir.getName().equals(value("ready")))try{remove(dir);}catch(Exception ignored){}
        call.resolve();
    }
}
