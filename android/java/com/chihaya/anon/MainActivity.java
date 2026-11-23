package com.chihaya.anon;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Dialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * 千早爱音的AI站 · 安卓客户端
 *
 * - 用 WebView 承载已部署的公网站点，与网页端共用同一套账号与数据
 * - 启动时先做健康自检，连不上时显示爱音风格的重试页
 * - 启动 / 回到前台时检查远端版本，旧版本弹出更新提示
 * - 更新走应用内下载 + 系统安装器，不依赖浏览器，装完就是新版本
 */
public class MainActivity extends Activity {
    private static final String BASE_URL = "https://your-domain.example/";
    private static final String API_PREFIX = BASE_URL + "api/index.php?p=";
    private static final int LOCAL_VERSION_CODE = 2;
    private static final String LOCAL_VERSION_NAME = "1.1.0";
    private static final long UPDATE_CHECK_INTERVAL = 30 * 60 * 1000L;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int AUDIO_PERMISSION_REQUEST = 1002;
    private static final String APK_MIME = "application/vnd.android.package-archive";

    private WebView webView;
    private View loadingView;
    private View errorView;
    private TextView errorDetail;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingPermission;
    private Dialog updateDialog;
    private boolean updateMandatory = false;
    private long lastUpdateCheck = 0;

    /** 更新下载状态 */
    private long downloadId = -1L;
    private File downloadTarget;
    private boolean receiverRegistered = false;
    private File pendingInstall;
    private TextView progressView;
    private Button updateButton;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id != downloadId || id < 0) return;
            int status = downloadStatus(id);
            if (status == DownloadManager.STATUS_SUCCESSFUL && downloadTarget != null && downloadTarget.isFile()) {
                setProgress("下载完成，正在打开安装程序…");
                installApk(downloadTarget);
            } else if (status == DownloadManager.STATUS_FAILED) {
                resetUpdateButton("重新下载");
                setProgress("下载失败了，检查一下网络再点一次～");
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        getWindow().setStatusBarColor(Color.parseColor("#C8507D"));
        if (Build.VERSION.SDK_INT >= 26) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        webView = findViewById(R.id.web_view);
        loadingView = findViewById(R.id.loading_view);
        errorView = findViewById(R.id.error_view);
        errorDetail = findViewById(R.id.error_detail);

        configureWebView();
        findViewById(R.id.retry_btn).setOnClickListener(v -> loadSite());
        findViewById(R.id.browser_btn).setOnClickListener(v -> openExternal(BASE_URL));

        registerDownloadReceiver();
        loadSite();
        checkUpdate(false);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " AnonApp/" + LOCAL_VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cookies.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isInternal(uri)) return false;
                openExternal(uri.toString());
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isInternal(uri)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith(BASE_URL)) {
                    loadingView.setVisibility(View.GONE);
                    errorView.setVisibility(View.GONE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError(error.getDescription() == null ? "网络请求失败" : error.getDescription().toString());
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showError(description == null ? "网络请求失败" : description);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean needAudio = false;
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needAudio = true;
                }
                if (needAudio && Build.VERSION.SDK_INT >= 23
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    pendingPermission = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
                    return;
                }
                request.grant(request.getResources());
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                if (isApkUrl(url)) {
                    startApkDownload(url, null, true);
                    return;
                }
                Toast.makeText(MainActivity.this, "已交给浏览器下载…", Toast.LENGTH_SHORT).show();
                openExternal(url);
            }
        });
    }

    private boolean isInternal(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) return false;
        String host = uri.getHost();
        return host != null && host.equalsIgnoreCase(android.net.Uri.parse(BASE_URL).getHost());
    }

    private boolean isApkUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.ROOT);
        int cut = lower.indexOf('?');
        if (cut >= 0) lower = lower.substring(0, cut);
        return lower.endsWith(".apk");
    }

    private void loadSite() {
        loadingView.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        new Thread(() -> {
            boolean ok = ping(API_PREFIX + encode("/api/health"));
            runOnUiThread(() -> {
                if (ok) {
                    webView.loadUrl(BASE_URL);
                } else {
                    showError("网络不通，或者站点正在维护。");
                }
            });
        }).start();
    }

    private void showError(String detail) {
        loadingView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
        if (detail != null && !detail.isEmpty()) {
            errorDetail.setText(getString(R.string.offline_hint) + "\n\n" + detail);
        } else {
            errorDetail.setText(R.string.offline_hint);
        }
    }

    private boolean ping(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(7000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code != 200) return false;
            InputStream in = conn.getInputStream();
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            String line = reader.readLine();
            reader.close();
            return line != null && line.contains("\"ok\":true");
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String httpGet(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "AnonApp/" + LOCAL_VERSION_NAME);
            if (conn.getResponseCode() != 200) return null;
            InputStream in = conn.getInputStream();
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void checkUpdate(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastUpdateCheck < UPDATE_CHECK_INTERVAL) return;
        lastUpdateCheck = now;
        new Thread(() -> {
            String body = httpGet(API_PREFIX + encode("/api/app/version"));
            if (body == null) return;
            try {
                JSONObject json = new JSONObject(body);
                JSONObject latest = json.optJSONObject("latest");
                if (latest == null) return;
                int code = latest.optInt("versionCode", 0);
                if (code <= LOCAL_VERSION_CODE) return;
                String name = latest.optString("versionName", String.valueOf(code));
                String notes = latest.optString("notes", "爱音修了一些小问题，也加了新功能～");
                String url = latest.optString("url", BASE_URL + "downloads/anno-ai.apk");
                if (url.startsWith("/")) url = BASE_URL.substring(0, BASE_URL.length() - 1) + url;
                boolean mandatory = latest.optBoolean("mandatory", true);
                final String fName = name;
                final String fNotes = notes;
                final String fUrl = url;
                final boolean fMandatory = mandatory;
                final int fCode = code;
                runOnUiThread(() -> showUpdateDialog(fCode, fName, fNotes, fUrl, fMandatory));
            } catch (Exception ignored) {
            }
        }).start();
    }

    private void showUpdateDialog(int code, String versionName, String notes, String downloadUrl, boolean mandatory) {
        if (isFinishing() || (updateDialog != null && updateDialog.isShowing())) return;
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_update);
        dialog.setCancelable(!mandatory);
        dialog.setCanceledOnTouchOutside(false);

        TextView title = dialog.findViewById(R.id.update_title);
        TextView version = dialog.findViewById(R.id.update_version);
        TextView notesView = dialog.findViewById(R.id.update_notes);
        TextView later = dialog.findViewById(R.id.update_later);
        TextView hint = dialog.findViewById(R.id.update_hint);
        Button go = dialog.findViewById(R.id.update_go);
        ImageView icon = dialog.findViewById(R.id.update_icon);
        progressView = dialog.findViewById(R.id.update_progress);
        updateButton = go;
        if (icon != null) icon.setImageResource(R.mipmap.ic_launcher);

        title.setText("新版本 v" + versionName + " 来啦～");
        version.setText("当前版本 v" + LOCAL_VERSION_NAME + " · 最新版本号 " + code);
        notesView.setText(notes);
        later.setVisibility(mandatory ? View.GONE : View.VISIBLE);
        hint.setText(mandatory ? R.string.update_must : R.string.update_optional);
        if (progressView != null) {
            progressView.setVisibility(View.GONE);
            progressView.setText("");
        }

        go.setOnClickListener(v -> {
            if (downloadTarget != null && downloadTarget.isFile()) {
                installApk(downloadTarget);
                return;
            }
            startApkDownload(downloadUrl, versionName, false);
        });
        later.setOnClickListener(v -> {
            if (!mandatory) dialog.dismiss();
        });

        updateMandatory = mandatory;
        dialog.setOnDismissListener(d -> {
            updateDialog = null;
            updateMandatory = false;
            progressView = null;
            updateButton = null;
        });
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.dimAmount = 0.55f;
            lp.width = (int) (getResources().getDisplayMetrics().widthPixels * 0.90);
            lp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
            window.setAttributes(lp);
        }
        updateDialog = dialog;
    }

    /* ── 应用内下载 + 安装 ─────────────────────────────── */

    private void startApkDownload(String url, String versionName, boolean silent) {
        if (downloadId > 0) {
            toast("更新已经在下载啦，稍等一下～");
            return;
        }
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = new File(getFilesDir(), "downloads");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建下载目录");
            String name = "anno-ai" + (versionName == null ? "" : "-" + versionName.replaceAll("[^0-9A-Za-z._-]", "_")) + ".apk";
            File target = new File(dir, name);
            if (target.exists() && !target.delete()) {
                target = new File(dir, "anno-ai-" + System.currentTimeMillis() + ".apk");
            }
            downloadTarget = target;

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) throw new IllegalStateException("系统下载服务不可用");
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("千早爱音的AI站" + (versionName == null ? "" : " v" + versionName));
            req.setDescription("正在下载新版本，装好就能继续聊天啦～");
            req.setMimeType(APK_MIME);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            downloadId = dm.enqueue(req);

            setProgress("正在下载…");
            if (updateButton != null) {
                updateButton.setEnabled(false);
                updateButton.setText("正在下载…");
            }
            if (silent) toast("开始下载安装包…");
            ui.post(progressTick);
        } catch (Exception e) {
            downloadId = -1L;
            resetUpdateButton("重新下载");
            setProgress("下载没开始，检查网络后再试一次吧。");
            toast("下载失败：" + e.getMessage());
        }
    }

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            if (downloadId <= 0) return;
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            Cursor cur = null;
            try {
                cur = dm.query(new DownloadManager.Query().setFilterById(downloadId));
                if (cur != null && cur.moveToFirst()) {
                    int status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status == DownloadManager.STATUS_RUNNING) {
                        long done = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        if (total > 0) {
                            setProgress(String.format(Locale.CHINA, "正在下载 %d%%（%.1f / %.1f MB）",
                                    done * 100 / total, done / 1048576.0, total / 1048576.0));
                        } else {
                            setProgress("正在下载…");
                        }
                    } else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        setProgress("下载完成，正在打开安装程序…");
                        return;
                    } else if (status == DownloadManager.STATUS_FAILED) {
                        int reason = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        resetUpdateButton("重新下载");
                        setProgress("下载失败了（" + reason + "），再试一次吧。");
                        downloadId = -1L;
                        return;
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (cur != null) cur.close();
            }
            ui.postDelayed(this, 700);
        }
    };

    private int downloadStatus(long id) {
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return DownloadManager.STATUS_FAILED;
        Cursor cur = null;
        try {
            cur = dm.query(new DownloadManager.Query().setFilterById(id));
            if (cur != null && cur.moveToFirst()) {
                return cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            }
        } catch (Exception ignored) {
        } finally {
            if (cur != null) cur.close();
        }
        return DownloadManager.STATUS_FAILED;
    }

    private void installApk(File file) {
        if (file == null || !file.isFile()) {
            setProgress("安装包不见了，点「重新下载」再来一次吧。");
            resetUpdateButton("重新下载");
            downloadId = -1L;
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingInstall = file;
            toast("请允许「安装未知应用」，返回后会自动继续安装～");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception e) {
                openExternal(BASE_URL + "downloads/anno-ai.apk");
            }
            return;
        }
        try {
            Uri uri = ApkProvider.uriFor(this, file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            setProgress("已打开安装程序，按提示完成安装就可以啦～");
        } catch (Exception e) {
            setProgress("打不开安装程序，可以用浏览器下载安装：" + BASE_URL + "downloads/anno-ai.apk");
            openExternal(BASE_URL + "downloads/anno-ai.apk");
        }
    }

    private void registerDownloadReceiver() {
        if (receiverRegistered) return;
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(downloadReceiver, filter);
            }
            receiverRegistered = true;
        } catch (Exception ignored) {
        }
    }

    private void setProgress(String text) {
        if (progressView == null) return;
        progressView.setText(text);
        progressView.setVisibility(View.VISIBLE);
    }

    private void resetUpdateButton(String label) {
        if (updateButton == null) return;
        updateButton.setEnabled(true);
        updateButton.setText(label);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private String encode(String path) {
        try {
            return URLEncoder.encode(path, "UTF-8");
        } catch (Exception e) {
            return path;
        }
    }

    private void openExternal(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "没有可以打开这个链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == AUDIO_PERMISSION_REQUEST && pendingPermission != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermission.grant(pendingPermission.getResources());
            } else {
                pendingPermission.deny();
                Toast.makeText(this, "没有麦克风权限，语音功能用不了哦", Toast.LENGTH_SHORT).show();
            }
            pendingPermission = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (pendingInstall != null && pendingInstall.isFile()) {
            if (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls()) {
                File file = pendingInstall;
                pendingInstall = null;
                installApk(file);
            }
        }
        checkUpdate(false);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        // 把 Cookie 落到磁盘，下次启动仍是登录状态
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (updateDialog != null && updateDialog.isShowing() && updateMandatory) return;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (receiverRegistered) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            receiverRegistered = false;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
