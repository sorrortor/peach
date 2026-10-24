"""空账本上的网页观看入口，跨平台运行，不依赖媒体盘符。"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from peach import settings_file
from support.ledger import fresh_ledger
import test_web_e2e as e2e


class WebWatchUITests(unittest.TestCase):
    _start_server = classmethod(e2e.WebE2ESmokeTests._start_server.__func__)
    _server_log = classmethod(e2e.WebE2ESmokeTests._server_log.__func__)
    tearDownClass = classmethod(e2e.WebE2ESmokeTests.tearDownClass.__func__)

    @classmethod
    def setUpClass(cls):
        cls.node, cls.chrome = shutil.which('node'), e2e.chrome_executable()
        if not cls.node or not cls.chrome:
            raise unittest.SkipTest('需要 Node 与本机 Chrome')
        cls.root = Path(tempfile.mkdtemp(prefix='peach-web-watch-ui-')).resolve()
        cls.data = cls.root / 'data'
        (cls.data / 'database').mkdir(parents=True)
        cls.db = fresh_ledger(cls.data / 'database')
        cls.port = e2e.free_port()
        media = cls.root / 'media'
        media.mkdir()
        config = settings_file.PeachConfig(
            cls.data, cls.data / settings_file.SETTINGS_FILENAME,
            present=True, data_root_found=True,
            locations={'local': ('R:\\media',)}, mounts={'local': (str(media),)},
            server=settings_file.ServerSettings(port=cls.port),
        )
        settings_file.write(config)
        cls.server = None
        try:
            cls._start_server()
        except BaseException:
            cls.tearDownClass()
            raise

    def test_explicit_viewing_actions_on_desktop_and_mobile(self):
        env = dict(os.environ, PEACH_E2E_ORIGIN=self.origin, PEACH_E2E_CHROME=self.chrome)
        result = subprocess.run(e2e.e2e_command(self.node, 1, ('e2e/web-watch.test.ts',)),
                                cwd=e2e.FRONTEND, env=env, capture_output=True, text=True,
                                encoding='utf-8', timeout=150)
        e2e.BROWSER_LOGS.mkdir(parents=True, exist_ok=True)
        (e2e.BROWSER_LOGS / 'web-watch.tap').write_text(result.stdout + result.stderr, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
