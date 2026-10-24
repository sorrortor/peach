"""网页观看的地址、拦截边界与生命周期。"""
import json
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from peach.web_watch import (AD_DOMAINS, WatchSession, blocked_host, clean_url,
                             content_rules, navigation_allowed, w_web_watch)


class WebWatchTests(unittest.TestCase):
    def test_general_snapshot_is_verified_and_has_network_cosmetic_and_exception_rules(self):
        from peach.web_watch_filters import bundled_rules
        rules = bundled_rules()
        self.assertGreater(len(rules), 10_000)
        self.assertEqual({r['action']['type'] for r in rules},
                         {'block', 'css-display-none', 'ignore-previous-rules'})

    def test_general_snapshot_rejects_unsafe_actions_and_bounds_decompression(self):
        import gzip
        from peach import web_watch_filters as filters
        for value in ([], {}, [{'trigger': {'url-filter': '.*'}, 'action': {'type': 'redirect'}}],
                      [{'trigger': {}, 'action': {'type': 'block'}}]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                filters.validate_rules(value)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / 'rules.json.gz'
            path.write_bytes(gzip.compress(b'x' * 101))
            with patch.object(filters, 'MAX_JSON', 100), self.assertRaises(ValueError):
                filters.read_snapshot(path)

    def test_general_cache_falls_back_and_never_executes_unverified_tools(self):
        from peach import web_watch_filters as filters
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary).resolve()
            (cache / 'rules.json.gz').write_bytes(b'bad gzip')
            rules, cached = filters.load_rules(cache)
            self.assertFalse(cached)
            self.assertGreater(len(rules), 10_000)
            (cache / 'rules.json.gz').write_bytes(filters.encode_snapshot(rules[:1]))
            self.assertEqual(filters.load_rules(cache), (rules[:1], True))
            with self.assertRaisesRegex(ValueError, '校验失败'):
                filters.ensure_converter(cache, fetch=lambda _url: b'untrusted tool')
            self.assertFalse((cache / f'converter-{filters.VERSION}' / 'ConverterTool').exists())

    def test_general_updates_use_fixed_sources_and_preserve_good_cache_on_failure(self):
        from peach import web_watch_filters as filters
        rule = {'trigger': {'url-filter': '/ads/'}, 'action': {'type': 'block'}}
        fetch = Mock(return_value=b'! Title: fixture\n/ads/')
        converter = Mock(return_value=[rule])
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(filters.sys, 'platform', 'darwin'), \
                patch.object(filters.platform, 'machine', return_value='arm64'), \
                patch.object(filters, 'ensure_converter', return_value=Path('/fixture/tool')):
            cache = Path(temporary).resolve()
            self.assertTrue(filters.refresh_cache(cache, fetch=fetch, converter=converter, now=lambda: 100_000))
            self.assertEqual([call.args[0] for call in fetch.call_args_list], list(filters.SOURCES))
            self.assertEqual(filters.load_rules(cache), ([rule], True))
            self.assertFalse(filters.refresh_cache(cache, fetch=fetch, now=lambda: 100_005))
            self.assertEqual(fetch.call_count, 2)
            converter.return_value = []
            before = (cache / 'rules.json.gz').read_bytes()
            with self.assertRaises(ValueError):
                filters.refresh_cache(cache, force=True, fetch=fetch, converter=converter, now=lambda: 200_000)
            self.assertEqual((cache / 'rules.json.gz').read_bytes(), before)
            fetch.side_effect = OSError('offline')
            with self.assertRaises(OSError):
                filters.refresh_cache(cache, force=True, fetch=fetch, now=lambda: 300_000)
            self.assertEqual((cache / 'rules.json.gz').read_bytes(), before)

    def test_fwip_filter_removes_ad_gates_before_player_boot_and_handles_late_ads(self):
        from peach.settings_file import PROJECT_ROOT
        from peach.web_watch_fwip import user_script
        harness = r'''
import {Window} from 'happy-dom';
import assert from 'node:assert/strict';
const script=SCRIPT;
for(const host of ['fwip-tv.com','www.fwip-tv.com','example.org','fwip-tv.com.example.org']) {
  const window=new Window({url:`https://${host}/episode`});
  const doc=window.document;
  window.eval(script);
  doc.body.innerHTML='<div id="movie-ads-header">ad</div><div id="moive_pop">ad</div>'+
    '<section data-movie-player data-embed-url="https://example.org/player">'+
    '<button data-player-play disabled aria-label="Play episode">Play</button>'+
    '<div data-player-ad><div data-player-side-ads>ad</div></div>'+
    '<div data-player-preroll data-preroll-ads=\'[{"mp4_url":"https://example.org/ad.mp4"}]\'></div>'+
    '<div data-player-frame></div></section>';
  await window.happyDOM.waitUntilComplete();
  const filtered=['fwip-tv.com','www.fwip-tv.com'].includes(host);
  const player=doc.querySelector('[data-movie-player]');
  assert.equal(player.querySelector('[data-player-preroll]')===null,filtered);
  assert.equal(player.querySelector('[data-player-ad]')===null,filtered);
  assert.equal(doc.querySelector('#moive_pop')===null,filtered);
  assert.equal(doc.querySelector('#movie-ads-header')===null,filtered);
  assert.equal(player.querySelector('button').disabled,!filtered);
  assert.equal(player.dataset.embedUrl,'https://example.org/player');
  assert.equal(player.querySelector('button').getAttribute('aria-label'),'Play episode');
  if(filtered) {
    const adRequests=[];
    const ads=JSON.parse(player.querySelector('[data-player-preroll]')?.dataset.prerollAds || '[]');
    player.querySelector('button').addEventListener('click',()=>{
      for(const ad of ads)adRequests.push(ad.mp4_url);
      const frame=doc.createElement('iframe');
      frame.src='about:blank'; player.querySelector('[data-player-frame]').append(frame);
    });
    player.querySelector('button').click();
    assert.equal(player.querySelectorAll('iframe').length,1);
    assert.equal(adRequests.length,0);
    // 广告过滤不能重新启用播放器自身的加载锁。
    player.querySelector('button').disabled=true;
    doc.body.insertAdjacentHTML('beforeend','<div class="movie-floating-ad">late ad</div>');
    await window.happyDOM.waitUntilComplete();
    assert.equal(doc.querySelector('.movie-floating-ad'),null);
    assert.equal(player.querySelector('button').disabled,true);
    assert.equal(player.querySelectorAll('iframe').length,1);
  }
  await window.happyDOM.close();
}
'''.replace('SCRIPT', json.dumps(user_script()))
        result = subprocess.run(['node', '--input-type=module', '-'], input=harness,
                                cwd=PROJECT_ROOT / 'frontend', capture_output=True, text=True,
                                encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fwip_cosmetic_rules_are_scoped_to_exact_site_hosts(self):
        from peach.web_watch_fwip import HOSTS, AD_SELECTOR
        rule = content_rules()[-1]
        self.assertEqual(rule['trigger']['if-domain'], list(HOSTS))
        self.assertEqual(rule['action'], {'type': 'css-display-none', 'selector': AD_SELECTOR})

    def test_bundle_failure_is_reported_without_starting_a_viewer(self):
        session = WatchSession()
        with patch.object(session, 'snapshot', return_value={'available': True}), \
                patch('peach.web_watch_bundle.launch_command', side_effect=OSError('fixture failure')), \
                patch('peach.web_watch.subprocess.Popen') as popen, \
                self.assertLogs('peach.web_watch', level='ERROR'), self.assertRaises(ValueError):
            session.open('https://example.org/')
        self.assertEqual(session.state, 'error')
        self.assertIsNone(session.process)
        popen.assert_not_called()

    def test_viewer_bundle_identity_signature_and_venv_are_preserved(self):
        import plistlib
        from peach.web_watch_bundle import BUNDLE_ID, launch_command
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            framework = root / 'framework'
            source = framework / 'Resources/Python.app/Contents/MacOS/Python'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'native-host-fixture')
            with patch('peach.web_watch_bundle.subprocess.run') as run:
                command, env = launch_command(root / 'cache', executable='/test/venv/bin/python', prefix=str(framework))
                binary = Path(command[0])
                info = plistlib.loads((binary.parent.parent / 'Info.plist').read_bytes())
                self.assertEqual(info['CFBundleIdentifier'], BUNDLE_ID)
                self.assertEqual(info['CFBundleName'], 'Peach Web')
                self.assertEqual(info['CFBundleExecutable'], binary.name)
                self.assertFalse(info['LSUIElement'])
                self.assertEqual(env['__PYVENV_LAUNCHER__'], '/test/venv/bin/python')
                self.assertEqual(command[1:], ['-m', 'peach.web_watch_macos'])
                self.assertEqual(source.read_bytes(), b'native-host-fixture')
                self.assertEqual(run.call_count, 2)
                self.assertIn('--sign', run.call_args_list[0].args[0])
                self.assertIn('--verify', run.call_args_list[1].args[0])
                again, _ = launch_command(root / 'cache', executable='/test/venv/bin/python', prefix=str(framework))
                self.assertEqual(again, command)
                self.assertEqual(run.call_count, 3)
                (binary.parent.parent / 'Info.plist').write_bytes(b'corrupt')
                with self.assertRaises(ValueError):
                    launch_command(root / 'cache', executable='/test/venv/bin/python', prefix=str(framework))

    def test_viewer_bundle_signing_failure_does_not_publish_an_app(self):
        from peach.web_watch_bundle import launch_command
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / 'framework/Resources/Python.app/Contents/MacOS/Python'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'native-host-fixture')
            with patch('peach.web_watch_bundle.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'codesign')):
                with self.assertRaises(subprocess.CalledProcessError):
                    launch_command(root / 'cache', prefix=str(root / 'framework'))
            self.assertEqual(list((root / 'cache').glob('*/Peach Web.app')), [])
            with self.assertRaises(ValueError):
                launch_command(root / 'other', prefix=str(root / 'missing'))

    def test_youtube_filters_prune_ads_and_preserve_media_and_other_sites(self):
        from peach.web_watch_youtube import user_script
        script = user_script()
        harness = r'''
import vm from 'node:vm';
import assert from 'node:assert/strict';
const script = SCRIPT;
const payload = {adPlacements:[{ad:'fixture'}], playerAds:[{}], adSlots:[{}],
  streamingData:{formats:[{url:'https://example.org/media'}]},
  videoDetails:{videoId:'fixture',lengthSeconds:'635'},
  playabilityStatus:{status:'OK'}};
for (const host of ['www.youtube.com','youtube.com','m.youtube.com','example.org','youtube.com.example.org']) {
  const requests=[];
  class IsolatedResponse extends Response {
    json(){ return super.json(); }
    clone(){ const r=super.clone();return new IsolatedResponse(r.body,{status:r.status,headers:r.headers}); }
  }
  const context = vm.createContext({console, Response:IsolatedResponse, Request, Proxy, URL, URLSearchParams,
    location:{hostname:host}, document:{readyState:'loading'},
    fetch:async (...args)=>{ requests.push(args);return new IsolatedResponse(JSON.stringify(payload),{status:200}); },
  });
  vm.runInContext('window=globalThis; Window=function Window(){};',context);
  vm.runInContext(script,context);
  context.fixture=JSON.stringify(payload);
  const parsed = vm.runInContext('JSON.parse(fixture)',context);
  const initial = vm.runInContext('ytInitialPlayerResponse={...JSON.parse(fixture)}; ytInitialPlayerResponse',context);
  const fetched = await vm.runInContext('fetch("https://www.youtube.com/youtubei/v1/player").then(r=>r.json())',context);
  const other = await vm.runInContext('fetch("https://example.org/other.json").then(r=>r.text())',context);
  const filtered = ['www.youtube.com','youtube.com','m.youtube.com'].includes(host);
  for (const result of [parsed, initial, fetched]) {
    for (const key of ['adPlacements','playerAds','adSlots']) assert.equal(result[key] === undefined,filtered);
    assert.equal(result.streamingData.formats[0].url,'https://example.org/media');
    assert.equal(result.playabilityStatus.status,'OK');
    assert.equal(result.videoDetails.lengthSeconds,'635');
  }
  assert.equal(JSON.parse(other).adSlots.length,1);
  assert.equal(requests.length,2);
}
'''.replace('SCRIPT', json.dumps(script))
        result = subprocess.run(['node', '--input-type=module', '-'], input=harness,
                                capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_public_https_and_private_addresses(self):
        url = 'https://media.w3.org/2010/05/sintel/trailer.mp4'
        self.assertEqual(clean_url(url), url)
        for bad in (None, '', 'http://example.com', 'javascript:alert(1)',
                    'file:///etc/passwd', 'https://user:pass@example.com',
                    'https://127.0.0.1', 'https://[::1]', 'https://peach.local',
                    'https://example.com:8443', 'https://example.com/\n',
                    'https://localhost.', 'https://192.0.2.1'):
            with self.subTest(url=bad), self.assertRaises(ValueError):
                clean_url(bad)

    def test_ad_domain_boundaries(self):
        for domain in AD_DOMAINS:
            self.assertTrue(blocked_host(domain))
            self.assertTrue(blocked_host('a.' + domain))
            self.assertFalse(blocked_host(domain + '.example.org'))
        self.assertFalse(blocked_host('media.w3.org'))

    def test_content_rules_are_serializable_and_blocking(self):
        import re
        rules = json.loads(json.dumps(content_rules()))
        for rule, domain in zip(rules, AD_DOMAINS):
            self.assertEqual(rule['action']['type'], 'block')
            pattern = re.compile(rule['trigger']['url-filter'])
            self.assertTrue(pattern.search('https://a.' + domain + '/ad.js'))
            self.assertFalse(pattern.search('https://' + domain + '.example.org/ad.js'))

    def test_navigation_stays_on_site_but_media_cdn_is_allowed(self):
        self.assertTrue(navigation_allowed('https://example.org/video', 'example.org', main=True, clicked=False))
        self.assertFalse(navigation_allowed('https://other.org/', 'example.org', main=True, clicked=True))
        self.assertTrue(navigation_allowed('https://media.w3.org/video.mp4', 'example.org', main=False, clicked=False))
        self.assertFalse(navigation_allowed('https://doubleclick.net/ad', 'example.org', main=False, clicked=False))
        self.assertFalse(navigation_allowed('custom:launch', 'example.org', main=False, clicked=False))

    def test_close_only_owned_process_and_waits(self):
        session = WatchSession()
        process = session.process = Mock()
        process.poll.return_value = None
        result = session.close()
        self.assertEqual(result['state'], 'closed')
        self.assertIsNone(session.process)
        process.terminate.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=5)

    def test_invalid_action_and_language_do_not_launch(self):
        for body in ({'action': 'download'}, {'action': 'open', 'language': 'xx'}):
            with self.subTest(body=body), self.assertRaises(ValueError):
                w_web_watch(None, body)
