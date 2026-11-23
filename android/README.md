# 安卓客户端（WebView 壳）

一个自包含的 WebView 客户端：打开即加载你部署的站点，支持文件上传、麦克风录音、SSE 流式聊天，以及应用内更新。

> 客户端本身**不包含任何 API Key**，登录与能力都来自你部署的服务端。

## 编译前

1. 把 `java/com/chihaya/anon/MainActivity.java` 里的常量改成你的站点：

```java
private static final String BASE_URL = "https://your-domain.example/";
```

2. 准备 Android SDK（`ANDROID_HOME`）与 JDK。

## 编译

Windows 下可直接用 `build.ps1`：

```powershell
.\build.ps1
```

脚本会：

- 用 `aapt2` / `javac` / `d8` 编译资源与代码
- 自动生成签名证书（`keystore/anon.keystore`，密码为演示用 `android`）
- 产出已签名的 APK

正式发布请把签名证书换成你自己的，并且**不要提交到仓库**（`.gitignore` 已排除）。

## 功能

- 启动 `/api/health` 自检，失败显示重试页，可改用浏览器打开
- 页面内文件上传、麦克风权限、下载 APK
- 启动/回前台检查 `/api/app/version`，有新版本弹窗，可用 `DownloadManager` 应用内更新
- 退出后台时 `CookieManager.flush()`，保持登录态

## 配置更新接口

服务端的 `/api/app/version` 由后台「应用版本」设置控制；把新 APK 放到站点 `downloads/` 目录并在后台修改 versionCode 即可推送更新。
