"""由 Peach 启动的单窗口 WebKit 宿主，无本机脚本桥。"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from urllib.parse import urlsplit

from .web_watch import clean_url, content_rules, navigation_allowed


def emit(event):
    print(json.dumps({"event": event}), flush=True)


@lru_cache(maxsize=1)
def _delegate_class():
    import Foundation
    import WebKit

    class WatchDelegate(Foundation.NSObject):
        def applicationShouldTerminateAfterLastWindowClosed_(self, _application):
            return True

        def webView_createWebViewWithConfiguration_forNavigationAction_windowFeatures_(self, _view, _config, _action, _features):
            self.status.setStringValue_(self.labels[6])
            emit("popup")
            return None

        def webView_decidePolicyForNavigationAction_decisionHandler_(self, _view, action, decide):
            if action.shouldPerformDownload():
                decide(WebKit.WKNavigationActionPolicyCancel)
                return
            target = action.targetFrame()
            if target is None:
                emit("popup")
                decide(WebKit.WKNavigationActionPolicyCancel)
                return
            allowed = navigation_allowed(str(action.request().URL().absoluteString()), self.origin,
                                         main=bool(target.isMainFrame()), clicked=False)
            if not allowed and target.isMainFrame():
                self.status.setStringValue_(self.labels[5])
                emit("error")
            decide(WebKit.WKNavigationActionPolicyAllow if allowed else WebKit.WKNavigationActionPolicyCancel)

        def webView_decidePolicyForNavigationResponse_decisionHandler_(self, _view, response, decide):
            media = str(response.response().MIMEType() or '').startswith(('video/', 'audio/'))
            decide(WebKit.WKNavigationResponsePolicyAllow if response.canShowMIMEType() or media else WebKit.WKNavigationResponsePolicyCancel)

        def webView_didStartProvisionalNavigation_(self, _view, _navigation):
            self.status.setStringValue_(self.labels[3])
            emit("loading")

        def webView_didFinishNavigation_(self, _view, _navigation):
            self.status.setStringValue_(self.labels[4])
            emit("ready")

        def webView_didFailProvisionalNavigation_withError_(self, _view, _navigation, error):
            # WebKit 204 表示媒体插件已接管加载，视频仍在当前窗口中播放。
            if str(error.domain()) == 'WebKitErrorDomain' and error.code() == 204:
                self.webView_didFinishNavigation_(_view, _navigation)
                return
            if error.code() != -999:
                self.status.setStringValue_(self.labels[5])
                print(json.dumps({"event": "error", "code": error.code(),
                                  "domain": str(error.domain())}), flush=True)

        def webView_didFailNavigation_withError_(self, view, navigation, error):
            self.webView_didFailProvisionalNavigation_withError_(view, navigation, error)

        def webViewWebContentProcessDidTerminate_(self, _view):
            self.status.setStringValue_(self.labels[5])
            emit("error")

        def back_(self, _sender):
            self.view.goBack()

        def reload_(self, _sender):
            self.view.reload()

    return WatchDelegate


def create_window(options):
    import AppKit
    import Foundation
    import WebKit
    from .web_watch_youtube import user_script

    url = clean_url(options["url"])
    origin = urlsplit(url).hostname
    language = options.get("language", "en")
    labels = {
        "en": ("Peach · Watch the web", "Back", "Reload", "Loading…", "Ready · Ad filter on · New windows blocked", "Unable to load this page", "Pop-up blocked"),
        "th": ("Peach · ดูจากเว็บ", "ย้อนกลับ", "โหลดใหม่", "กำลังโหลด…", "พร้อม · เปิดตัวกรองโฆษณา · บล็อกหน้าต่างใหม่", "โหลดหน้านี้ไม่สำเร็จ", "บล็อกป๊อปอัปแล้ว"),
        "zh": ("Peach · 网页观看", "后退", "刷新", "正在加载…", "就绪 · 广告过滤已启用 · 新窗口已阻止", "网页加载失败", "已拦截弹窗"),
    }[language]

    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyRegular)
    delegate = _delegate_class().alloc().init()
    delegate.origin = origin
    delegate.labels = labels
    app.setDelegate_(delegate)
    window = AppKit.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
        Foundation.NSMakeRect(100, 100, 1080, 760),
        AppKit.NSWindowStyleMaskTitled | AppKit.NSWindowStyleMaskClosable
        | AppKit.NSWindowStyleMaskMiniaturizable | AppKit.NSWindowStyleMaskResizable,
        AppKit.NSBackingStoreBuffered, False)
    window.setTitle_(labels[0])
    window.setMinSize_(Foundation.NSMakeSize(420, 320))
    window.setReleasedWhenClosed_(False)
    root = window.contentView()
    config = WebKit.WKWebViewConfiguration.alloc().init()
    config.setWebsiteDataStore_(WebKit.WKWebsiteDataStore.nonPersistentDataStore())
    config.preferences().setJavaScriptCanOpenWindowsAutomatically_(False)
    config.setMediaTypesRequiringUserActionForPlayback_(WebKit.WKAudiovisualMediaTypeAll)
    config.userContentController().addUserScript_(
        WebKit.WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(
            user_script(), WebKit.WKUserScriptInjectionTimeAtDocumentStart, False))
    view = WebKit.WKWebView.alloc().initWithFrame_configuration_(Foundation.NSMakeRect(0, 0, 1080, 674), config)
    view.setAutoresizingMask_(AppKit.NSViewWidthSizable | AppKit.NSViewHeightSizable)
    view.setNavigationDelegate_(delegate)
    view.setUIDelegate_(delegate)
    delegate.view = view
    root.addSubview_(view)
    for index, selector in enumerate(("back:", "reload:")):
        button = AppKit.NSButton.alloc().initWithFrame_(Foundation.NSMakeRect(12 + index * 100, 718, 94, 30))
        button.setTitle_(labels[index + 1])
        button.setBezelStyle_(AppKit.NSBezelStyleRounded)
        button.setTarget_(delegate)
        button.setAction_(selector)
        button.setAutoresizingMask_(AppKit.NSViewMinYMargin)
        root.addSubview_(button)
    address = AppKit.NSTextField.labelWithString_(urlsplit(url).netloc)
    address.setFrame_(Foundation.NSMakeRect(224, 724, 800, 22))
    address.setSelectable_(True)
    address.setAutoresizingMask_(AppKit.NSViewMinYMargin | AppKit.NSViewWidthSizable)
    root.addSubview_(address)
    status = AppKit.NSTextField.labelWithString_(labels[3])
    status.setFrame_(Foundation.NSMakeRect(16, 682, 1030, 22))
    status.setAutoresizingMask_(AppKit.NSViewMinYMargin | AppKit.NSViewWidthSizable)
    root.addSubview_(status)
    delegate.status = status

    def compiled(rules, error):
        if error is not None or rules is None:
            status.setStringValue_(labels[5])
            emit("error")
            return
        view.configuration().userContentController().addContentRuleList_(rules)
        view.loadRequest_(Foundation.NSURLRequest.requestWithURL_(Foundation.NSURL.URLWithString_(url)))

    WebKit.WKContentRuleListStore.defaultStore().compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler_(
        "peach-web-watch-v1", json.dumps(content_rules()), compiled)
    window.makeKeyAndOrderFront_(None)
    app.activateIgnoringOtherApps_(True)
    return app, window, view, delegate


def main():
    import objc
    from PyObjCTools import AppHelper

    options = json.loads(sys.stdin.readline())
    retained = create_window(options)
    with objc.autorelease_pool():
        AppHelper.runEventLoop()
    return retained


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit("error")
        raise
