"""显式启用的 macOS WebKit 实证；使用公开短片，不访问私人网页。"""
import os
import sys
import time
import unittest
from unittest.mock import patch


@unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('PEACH_WEB_WATCH_NATIVE') == '1',
                     '需要显式启用 macOS WebKit 实证')
class NativeWebWatchTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('PEACH_WEB_WATCH_YOUTUBE') == '1',
                         '需要显式启用 YouTube 联网实证')
    def test_youtube_playback(self):
        import json
        import Foundation
        from peach.web_watch_macos import create_window

        app, window, view, delegate = create_window({
            'url': 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'language': 'en',
        })

        def pump(seconds):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                Foundation.NSRunLoop.currentRunLoop().runUntilDate_(
                    Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.05))

        def evaluate(script):
            result = []
            view.evaluateJavaScript_completionHandler_(script, lambda value, error: result.append((value, error)))
            deadline = time.monotonic() + 5
            while not result and time.monotonic() < deadline:
                pump(0.05)
            self.assertTrue(result, 'JavaScript 实证超时')
            self.assertIsNone(result[0][1])
            return result[0][0]

        try:
            pump(20)
            print('YouTube page:', evaluate('JSON.stringify({title:document.title,video:!!document.querySelector("video"),message:document.querySelector(".ytp-error-content-wrap")?.innerText})'))
            evaluate('document.querySelector(".ytp-large-play-button")?.click(); const v=document.querySelector("video"); if(v){v.muted=true;v.play().catch(()=>{});} true')
            pump(20)
            state = json.loads(evaluate('JSON.stringify({time:document.querySelector("video")?.currentTime || 0,duration:document.querySelector("video")?.duration || 0,paused:document.querySelector("video")?.paused,error:document.querySelector(".ytp-error-content-wrap")?.innerText,ad:!!document.querySelector(".ad-showing"),status:window.ytInitialPlayerResponse?.playabilityStatus?.status})'))
            print('YouTube playback:', json.dumps(state))
            self.assertGreater(state['time'], 2, state)
            self.assertGreater(state['duration'], 600, state)
            self.assertFalse(state['ad'], state)
            start = state['time']
            pump(3)
            self.assertGreater(evaluate('document.querySelector("video").currentTime'), start + 1)
            self.assertEqual(evaluate('document.querySelector("#movie_player").getVideoData().video_id'), 'aqz-KE-bpKQ')
            snapshots = []
            view.takeSnapshotWithConfiguration_completionHandler_(None, lambda image, error: snapshots.append((image, error)))
            deadline = time.monotonic() + 5
            while not snapshots and time.monotonic() < deadline:
                pump(0.05)
            self.assertTrue(snapshots)
            self.assertIsNone(snapshots[0][1])
            import AppKit
            image = AppKit.NSBitmapImageRep.imageRepWithData_(snapshots[0][0].TIFFRepresentation())
            image.representationUsingType_properties_(AppKit.NSBitmapImageFileTypePNG, {}).writeToFile_atomically_(
                '/tmp/peach-youtube-test.png', True)
            evaluate('document.querySelector("video").pause(); true')
            self._check_youtube_fixture(view, pump, evaluate, delegate)
        finally:
            view.stopLoading()
            window.close()
            _ = app, delegate

    def _check_youtube_fixture(self, view, pump, evaluate, delegate):
        """同一原生 WebKit 注入管线处理带广告元数据的受控页面。"""
        from Foundation import NSURL
        fixture = '''<script>
ytInitialPlayerResponse = {adPlacements:[{ad:1}],playerAds:[{}],adSlots:[{}],
  streamingData:{formats:[{url:'https://example.org/media'}]},videoDetails:{videoId:'fixture'}};
window.parsed = JSON.parse('{"adPlacements":[{}],"playerAds":[{}],"adSlots":[{}],"playabilityStatus":{"status":"OK"}}');
new Response('{"adSlots":[{}],"streamingData":{"formats":[1]}}').json().then(value=>{
 window.responseFixture=value;document.title='fixture-ready';
});
</script>'''
        view.setNavigationDelegate_(None)
        try:
            view.loadHTMLString_baseURL_(fixture, NSURL.URLWithString_('https://www.youtube.com/'))
            deadline = time.monotonic() + 10
            while evaluate('document.title') != 'fixture-ready' and time.monotonic() < deadline:
                pump(0.1)
            self.assertEqual(evaluate('document.title'), 'fixture-ready')
            self.assertTrue(evaluate('[ytInitialPlayerResponse,parsed,responseFixture].every(p=>!p.adSlots&&!p.adPlacements&&!p.playerAds)'))
            self.assertEqual(evaluate('ytInitialPlayerResponse.streamingData.formats[0].url'), 'https://example.org/media')
            self.assertEqual(evaluate('parsed.playabilityStatus.status'), 'OK')
            self.assertEqual(evaluate('responseFixture.streamingData.formats[0]'), 1)
            import WebKit
            from unittest.mock import Mock
            action = Mock()
            action.shouldPerformDownload.return_value = True
            decisions = []
            delegate.webView_decidePolicyForNavigationAction_decisionHandler_(view, action, decisions.append)
            self.assertEqual(decisions, [WebKit.WKNavigationActionPolicyCancel])
            action.targetFrame.assert_not_called()
        finally:
            view.setNavigationDelegate_(delegate)

    def test_public_video_and_popup_rejection(self):
        import Foundation
        from peach.web_watch_macos import create_window

        app, window, view, delegate = create_window({
            'url': 'https://media.w3.org/2010/05/sintel/trailer.mp4', 'language': 'en',
        })

        def pump(until, seconds=30):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                Foundation.NSRunLoop.currentRunLoop().runUntilDate_(
                    Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.05))
                if until():
                    return
            self.fail('WebKit 实证超时')

        def evaluate(script):
            result = []
            view.evaluateJavaScript_completionHandler_(script, lambda value, error: result.append((value, error)))
            pump(lambda: bool(result), 5)
            self.assertIsNone(result[0][1])
            return result[0][0]

        try:
            pump(lambda: view.URL() is not None and not view.isLoading())
            readiness = []
            def ready():
                value = evaluate('document.querySelector("video")?.readyState || 0')
                readiness.append(value)
                return value >= 2
            pump(ready, 40)
            self.assertGreater(evaluate('document.querySelector("video").duration'), 0)
            evaluate('document.querySelector("video").muted = true; document.querySelector("video").play(); true')
            pump(lambda: evaluate('document.querySelector("video").currentTime') > 0.2, 10)
            evaluate('document.querySelector("video").pause(); true')
            count = len(app.windows())
            self.assertTrue(evaluate('window.open("https://example.org/", "_blank") === null'))
            self.assertEqual(len(app.windows()), count)
            self.assertTrue(view.URL().host() == 'media.w3.org')
            self.assertFalse(view.configuration().websiteDataStore().isPersistent())
            self.assertFalse(view.configuration().preferences().javaScriptCanOpenWindowsAutomatically())
            self.assertTrue(evaluate('JSON.parse(\'{"adSlots":[1]}\').adSlots[0] === 1'))
            self._check_network_filter(view, pump, evaluate, delegate)
        finally:
            view.stopLoading()
            window.close()
            _ = delegate

    def _check_network_filter(self, view, pump, evaluate, delegate):
        """同一合成请求先命中本机服务器，再由实际 WebKit 规则阻断。"""
        import base64
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        import WebKit
        from peach.web_watch import content_rules

        requests = []
        class Pixel(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                body = base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')
                self.send_response(200)
                self.send_header('Content-Type', 'image/gif')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Pixel) as server:
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            base = f'http://127.0.0.1:{server.server_port}'
            from Foundation import NSURL
            view.setNavigationDelegate_(None)
            try:
                view.loadHTMLString_baseURL_(f'<img src="{base}/control.gif">', NSURL.URLWithString_(base))
                pump(lambda: len(requests) == 1)
                compiled = []
                with patch('peach.web_watch.AD_DOMAINS', ('127.0.0.1',)):
                    import json
                    WebKit.WKContentRuleListStore.defaultStore().compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler_(
                        'peach-web-watch-test', json.dumps(content_rules()), lambda rules, error: compiled.append((rules, error)))
                pump(lambda: bool(compiled))
                self.assertIsNone(compiled[0][1])
                view.configuration().userContentController().addContentRuleList_(compiled[0][0])
                view.loadHTMLString_baseURL_(f'<img src="{base}/blocked.gif" onerror="document.title=\'blocked\'">', NSURL.URLWithString_(base))
                pump(lambda: evaluate('document.title') == 'blocked')
                self.assertEqual(requests, ['/control.gif'])
            finally:
                view.setNavigationDelegate_(delegate)
                server.shutdown()
                worker.join(timeout=3)
