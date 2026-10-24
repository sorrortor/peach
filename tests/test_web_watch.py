"""网页观看的地址、拦截边界与生命周期。"""
import json
import unittest
from unittest.mock import Mock

from peach.web_watch import (AD_DOMAINS, WatchSession, blocked_host, clean_url,
                             content_rules, navigation_allowed, w_web_watch)


class WebWatchTests(unittest.TestCase):
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
