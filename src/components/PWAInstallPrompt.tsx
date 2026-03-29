import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useTranslation } from '../lib/db';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const IOS_BROWSER_PATTERN = /iPad|iPhone|iPod/;
const IOS_ALT_BROWSER_PATTERN = /CriOS|FxiOS|EdgiOS|OPT\/|OPiOS|YaBrowser/;

export function PWAInstallPrompt() {
  const t = useTranslation();
  const isZh = t('lang') === 'zh';
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(isStandaloneMode());

  const platform = useMemo(() => detectPlatform(), []);
  const secureOrigin = useMemo(() => window.isSecureContext, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setGuideOpen(false);
    };

    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', onAppInstalled);

    if (media.addEventListener) media.addEventListener('change', onDisplayModeChange);
    else media.addListener(onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', onAppInstalled);
      if (media.removeEventListener) media.removeEventListener('change', onDisplayModeChange);
      else media.removeListener(onDisplayModeChange);
    };
  }, []);

  const shouldShowBanner =
    !installed &&
    !dismissed &&
    (Boolean(deferredPrompt) || platform.isIOS || platform.isAndroid);

  if (!shouldShowBanner) return null;

  const bannerCopy = getBannerCopy({
    isZh,
    platform,
    hasDeferredPrompt: Boolean(deferredPrompt),
    secureOrigin,
  });

  const handleInstall = async () => {
    if (!secureOrigin) {
      setGuideOpen(true);
      return;
    }

    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome !== 'accepted') {
        setGuideOpen(true);
      }
      setDeferredPrompt(null);
      return;
    }

    setGuideOpen(true);
  };

  return (
    <>
      <div className="fixed inset-x-3 bottom-20 z-50 md:bottom-6 md:left-auto md:right-6 md:w-[24rem]">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur">
          <div className="flex items-start gap-4 p-4">
            <img
              src="/apple-touch-icon.png"
              alt="FSRS Flashcards"
              className="h-14 w-14 rounded-2xl border border-slate-200 object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{bannerCopy.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{bannerCopy.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isZh ? '关闭安装提示' : 'Dismiss install prompt'}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleInstall}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
                >
                  <Download className="h-4 w-4" />
                  {bannerCopy.primaryAction}
                </button>
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                >
                  {bannerCopy.secondaryAction}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {guideOpen && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/45 p-4 md:items-center md:justify-center">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {isZh ? '安装到主屏幕' : 'Install to Home Screen'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                  {getGuideIntro(isZh, platform, Boolean(deferredPrompt), secureOrigin)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setGuideOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isZh ? '关闭说明' : 'Close guide'}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4 px-6 py-5">
              {getGuideSteps(isZh, platform, secureOrigin).map((step, index) => (
                <div key={step} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{step}</p>
                </div>
              ))}

              {!secureOrigin && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
                  {isZh
                    ? '当前页面不是 HTTPS 安全地址。安卓和苹果平板都不会把普通 HTTP 页面当成可安装 PWA。请改用 HTTPS 域名、受信任的隧道地址，或正式部署后的站点。'
                    : 'This page is not being served from a secure HTTPS origin. Android and iPad browsers will not treat a plain HTTP page as an installable PWA. Use HTTPS, a trusted tunnel URL, or a deployed site.'}
                </div>
              )}

              {platform.isIOS && secureOrigin && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  {isZh
                    ? '提示：iPad/iPhone 上的 Safari 不会弹出和安卓一样的安装窗口，这是平台行为。最稳的方式是用 Safari 的“分享 -> 添加到主屏幕”。'
                    : 'Tip: Safari on iPad and iPhone does not show the Android-style install popup. The most reliable path is Share -> Add to Home Screen.'}
                </div>
              )}

              {platform.isAndroid && secureOrigin && !deferredPrompt && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                  {isZh
                    ? '如果当前没有弹出安装对话框，也可以先点浏览器右上角菜单，寻找“安装应用”或“添加到主屏幕”。'
                    : 'If the install dialog did not appear yet, open your browser menu and look for Install app or Add to Home screen.'}
                </div>
              )}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="w-full rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {isZh ? '知道了' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS =
    IOS_BROWSER_PATTERN.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isSafari = isIOS && /Safari/i.test(ua) && !IOS_ALT_BROWSER_PATTERN.test(ua);

  return {
    isIOS,
    isAndroid,
    isSafari,
  };
}

function isStandaloneMode() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function getBannerCopy({
  isZh,
  platform,
  hasDeferredPrompt,
  secureOrigin,
}: {
  isZh: boolean;
  platform: ReturnType<typeof detectPlatform>;
  hasDeferredPrompt: boolean;
  secureOrigin: boolean;
}) {
  if (!secureOrigin) {
    return {
      title: isZh ? '当前地址还不是可安装的 PWA 来源' : 'This Origin Is Not Installable Yet',
      body: isZh
        ? '如果你是在平板上通过 http://局域网IP 打开的页面，浏览器不会允许 PWA 安装。'
        : 'If you opened this page from an http://LAN-IP address, the browser will not allow PWA installation.',
      primaryAction: isZh ? '查看原因' : 'Why?',
      secondaryAction: isZh ? '安装要求' : 'Requirements',
    };
  }

  if (platform.isIOS && platform.isSafari) {
    return {
      title: isZh ? '把 FSRS 安装到你的 iPad / iPhone' : 'Install FSRS on your iPad / iPhone',
      body: isZh
        ? 'Safari 不会自动弹窗，但你仍然可以通过“分享 -> 添加到主屏幕”安装。'
        : 'Safari does not show an automatic popup, but you can still install via Share -> Add to Home Screen.',
      primaryAction: isZh ? '查看安装步骤' : 'Show Steps',
      secondaryAction: isZh ? '为什么没弹窗？' : 'Why No Popup?',
    };
  }

  if (platform.isIOS && !platform.isSafari) {
    return {
      title: isZh ? '苹果平板请改用 Safari 安装' : 'Use Safari on iPad / iPhone to Install',
      body: isZh
        ? 'iOS 上的 Chrome / Edge 不提供标准 PWA 安装弹窗。请在 Safari 里打开本站后添加到主屏幕。'
        : 'Chrome and Edge on iOS do not expose the standard PWA install prompt. Open this site in Safari, then add it to the Home Screen.',
      primaryAction: isZh ? '查看安装步骤' : 'Show Steps',
      secondaryAction: isZh ? '安装说明' : 'Install Guide',
    };
  }

  if (hasDeferredPrompt) {
    return {
      title: isZh ? '把 FSRS 安装到设备上' : 'Install FSRS on This Device',
      body: isZh
        ? '现在可以直接弹出安装窗口，装好后会像原生应用一样出现在主屏幕。'
        : 'The install dialog is ready. Once installed, it will live on your home screen like a native app.',
      primaryAction: isZh ? '立即安装' : 'Install Now',
      secondaryAction: isZh ? '查看手动方式' : 'Manual Steps',
    };
  }

  return {
    title: isZh ? '安卓设备可安装这个应用' : 'Install This App on Android',
    body: isZh
      ? '如果系统没有自动弹窗，也可以通过浏览器菜单里的“安装应用”或“添加到主屏幕”完成安装。'
      : 'If the browser does not show a popup yet, you can still use Install app or Add to Home screen from the browser menu.',
    primaryAction: isZh ? '查看安装方式' : 'Show Install Options',
    secondaryAction: isZh ? '稍后再说' : 'Maybe Later',
  };
}

function getGuideIntro(
  isZh: boolean,
  platform: ReturnType<typeof detectPlatform>,
  hasDeferredPrompt: boolean,
  secureOrigin: boolean,
) {
  if (!secureOrigin) {
    return isZh
      ? '先把站点放到 HTTPS 地址上，浏览器才会允许安装 PWA。'
      : 'First move this site to an HTTPS origin. Only then will browsers allow PWA installation.';
  }

  if (platform.isIOS && platform.isSafari) {
    return isZh
      ? '在苹果平板和手机上，请按下面步骤手动添加到主屏幕。'
      : 'On iPad and iPhone, add the app manually with the following steps.';
  }

  if (platform.isIOS && !platform.isSafari) {
    return isZh
      ? '先用 Safari 打开本站，再执行添加到主屏幕。'
      : 'Open this site in Safari first, then add it to the Home Screen.';
  }

  if (hasDeferredPrompt) {
    return isZh
      ? '如果弹窗没有继续出现，也可以改用浏览器菜单手动安装。'
      : 'If the install dialog does not continue, you can still install from the browser menu.';
  }

  return isZh
    ? '安卓浏览器通常支持以下两种安装方式。'
    : 'Android browsers usually support one of the following installation paths.';
}

function getGuideSteps(
  isZh: boolean,
  platform: ReturnType<typeof detectPlatform>,
  secureOrigin: boolean,
) {
  if (!secureOrigin) {
    return isZh
      ? [
          '如果你现在访问的是 http://192.168.x.x:3000 这类局域网地址，安卓和 iPad 都不会把它识别成可安装 PWA。',
          '请改用正式部署后的 HTTPS 域名，或者使用受信任的 HTTPS 隧道地址再在平板上打开。',
          '等站点变成 HTTPS 后，安卓会出现安装窗口或菜单项，iPad Safari 则可以通过“分享 -> 添加到主屏幕”安装。',
        ]
      : [
          'If you are visiting an address like http://192.168.x.x:3000, Android and iPad browsers will not treat it as an installable PWA.',
          'Use a deployed HTTPS domain or a trusted HTTPS tunnel URL instead.',
          'Once the site is served over HTTPS, Android can show the install dialog or menu item, and Safari on iPad can use Share -> Add to Home Screen.',
        ];
  }

  if (platform.isIOS && platform.isSafari) {
    return isZh
      ? [
          '点击 Safari 底部或顶部工具栏里的“分享”按钮。',
          '在分享菜单中向下滑动，选择“添加到主屏幕”。',
          '确认应用名称后点击“添加”，图标就会出现在桌面。',
        ]
      : [
          'Tap the Share button in Safari.',
          'Scroll the share sheet and choose Add to Home Screen.',
          'Confirm the app name and tap Add to place it on your home screen.',
        ];
  }

  if (platform.isIOS && !platform.isSafari) {
    return isZh
      ? [
          '先把当前页面复制或通过分享菜单发送到 Safari 中打开。',
          '在 Safari 中打开后，点击“分享”按钮。',
          '选择“添加到主屏幕”，再点击“添加”完成安装。',
        ]
      : [
          'Open this page in Safari first.',
          'Tap the Share button in Safari.',
          'Choose Add to Home Screen, then tap Add to finish installation.',
        ];
  }

  return isZh
    ? [
        '优先点击上面的“立即安装”，如果浏览器已准备好会直接弹出安装窗口。',
        '如果没有弹窗，请打开浏览器右上角菜单，寻找“安装应用”或“添加到主屏幕”。',
        '确认安装后，应用会像普通 App 一样出现在桌面，可离线启动。',
      ]
    : [
        'Tap Install Now first. If the browser is ready, it will show the install dialog immediately.',
        'If no dialog appears, open the browser menu and look for Install app or Add to Home screen.',
        'After confirming, the app will appear on your home screen and can launch offline.',
      ];
}
