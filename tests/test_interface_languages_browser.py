"""三语界面的跨平台浏览器验收，只使用临时账本与合成条目。"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

from peach import settings_file
from support.conditions import missing_prerequisite
from support.ledger import fresh_ledger
from test_web_e2e import chrome_executable, e2e_command, free_port

ROOT = Path(__file__).resolve().parents[1]


class InterfaceLanguagesBrowserTests(unittest.TestCase):
    def test_languages_persist_on_desktop_and_mobile(self):
        self._check_languages(('e2e/interface-languages.test.ts', 'e2e/follow-player-languages.test.ts'))

    def test_dashboard_languages_on_desktop_and_mobile(self):
        self._check_languages(('e2e/dashboard-languages.test.ts',))

    def test_management_languages_on_desktop_and_mobile(self):
        self._check_languages(('e2e/management-languages.test.ts',))

    def test_whole_app_languages_on_desktop_and_mobile(self):
        self._check_languages(('e2e/whole-app-languages.test.ts',))

    def _check_languages(self, files: tuple[str, ...]):
        node, chrome, ffmpeg = shutil.which('node'), chrome_executable(), shutil.which('ffmpeg')
        if not node or not chrome or not ffmpeg or not (ROOT / 'frontend/node_modules/playwright-core').is_dir():
            missing_prerequisite('三语浏览器验收需要 Node、Chrome、FFmpeg 与前端依赖')
        with tempfile.TemporaryDirectory(prefix='peach-languages-') as directory:
            root = Path(directory).resolve()
            data, media = root / 'data', root / 'media'
            (data / 'database').mkdir(parents=True)
            media.mkdir()
            clip = media / 'Private 中文 ไทย.mp4'
            subprocess.run([ffmpeg, '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=12',
                            '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', str(clip)],
                           check=True, capture_output=True, timeout=30)
            db = fresh_ledger(data / 'database')
            with sqlite3.connect(db) as connection:
                connection.execute(
                    'INSERT INTO asset(id,medium,location,path,name,size) VALUES(1,?,?,?,?,?)',
                    ('video', 'local', r'R:\media\Private 中文 ไทย.mp4', 'Private 中文 ไทย.mp4', clip.stat().st_size))
            port = free_port()
            settings_file.write(settings_file.PeachConfig(
                data, data / settings_file.SETTINGS_FILENAME, present=True, data_root_found=True,
                locations={'local': (str(media) if os.name == 'nt' else r'R:\media',)},
                mounts={'local': (str(media),)} if os.name != 'nt' else {},
                server=settings_file.ServerSettings(port=port)))
            origin = f'http://127.0.0.1:{port}'
            with (root / 'server.log').open('w', encoding='utf-8') as log:
                server = subprocess.Popen(
                    [sys.executable, '-X', 'utf8', '-m', 'peach', 'serve', '--host', '127.0.0.1',
                     '--port', str(port), '--db', str(db), '--no-auth', '--no-mdns', '--no-ledger-sync'],
                    cwd=ROOT, env=dict(os.environ, PEACH_DATA_ROOT=str(data)), stdout=log, stderr=subprocess.STDOUT)
                try:
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    deadline = time.monotonic() + 60
                    while time.monotonic() < deadline:
                        self.assertIsNone(server.poll(), (root / 'server.log').read_text(encoding='utf-8'))
                        try:
                            with opener.open(origin + '/healthz', timeout=2) as response:
                                if response.status == 200:
                                    break
                        except (urllib.error.URLError, OSError):
                            time.sleep(0.2)
                    else:
                        self.fail('临时服务未就绪')
                    result = subprocess.run(
                        e2e_command(node, 1, files), cwd=ROOT / 'frontend',
                        env=dict(os.environ, PEACH_E2E_ORIGIN=origin, PEACH_E2E_CHROME=chrome),
                        # 一批包含桌面与手机各 240 秒的用例，外层沿用浏览器批次 600 秒预算。
                        capture_output=True, text=True, encoding='utf-8', timeout=600)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                finally:
                    server.terminate()
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=10)
