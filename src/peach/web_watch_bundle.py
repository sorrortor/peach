"""macOS 源码观看宿主的独立应用身份；复用当前 Python Framework。"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import plistlib
import shutil
import sys
import subprocess
import tempfile

from .appid import BUNDLE_PREFIX

BUNDLE_ID = f"{BUNDLE_PREFIX}.web-watch"


def launch_command(root: Path, *, executable: str = sys.executable,
                   prefix: str = sys.base_prefix) -> tuple[list[str], dict[str, str]]:
    """复制框架的原生宿主，不修改系统解释器，也不使用 shell 跳板。"""
    host = Path(prefix) / 'Resources' / 'Python.app' / 'Contents' / 'MacOS' / 'Python'
    if not host.is_file():
        raise ValueError('网页观看需要 Python Framework 应用宿主')
    payload = host.read_bytes()
    info = {
        'CFBundleName': 'Peach Web', 'CFBundleDisplayName': 'Peach Web',
        'CFBundleIdentifier': BUNDLE_ID, 'CFBundleExecutable': 'Peach Web',
        'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1',
        'NSHighResolutionCapable': True, 'LSUIElement': False,
    }
    expected = plistlib.dumps(info)
    digest = hashlib.sha256(payload + executable.encode('utf-8') + expected).hexdigest()[:20]
    directory = root / digest
    directory.mkdir(parents=True, exist_ok=True)
    app = directory / 'Peach Web.app'
    binary = app / 'Contents' / 'MacOS' / 'Peach Web'
    if not app.exists():
        with tempfile.TemporaryDirectory(prefix='host-', dir=directory) as temporary:
            staging = Path(temporary) / 'Peach Web.app'
            target = staging / 'Contents' / 'MacOS' / 'Peach Web'
            target.parent.mkdir(parents=True)
            shutil.copyfile(host, target)
            target.chmod(0o700)
            (staging / 'Contents' / 'Info.plist').write_bytes(expected)
            subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(staging)],
                           check=True, capture_output=True, text=True, encoding='utf-8', timeout=15)
            try:
                staging.rename(app)
            except OSError:
                if not app.exists():
                    raise
    if (not binary.is_file()
            or (app / 'Contents' / 'Info.plist').read_bytes() != expected):
        raise ValueError('网页观看应用宿主校验失败')
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(app)],
                   check=True, capture_output=True, text=True, encoding='utf-8', timeout=15)
    environment = dict(os.environ)
    environment['__PYVENV_LAUNCHER__'] = executable
    return [str(binary), '-m', 'peach.web_watch_macos'], environment
