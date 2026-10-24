"""通用 WebKit 广告规则快照与固定来源后台更新；网页不接触更新通道。"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import logging
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import threading
import time
import zlib

import httpx
from filelock import FileLock, Timeout

from .fsutil import atomic_write_bytes, atomic_write_text
from .settings_file import PROJECT_ROOT

LOGGER = logging.getLogger(__name__)
VERSION = '4.3.1'
TOOL_URL = f'https://github.com/AdguardTeam/SafariConverterLib/releases/download/v{VERSION}/ConverterTool'
TOOL_SHA = '2a02d7fc6adc74198b0572cd7012d0371e608c2330969210c3dc53ecca47d865'
PSL_REVISION = '7ccee9d576d4ca45219440e346f61117f44c816f'
PSL_FILES = {
    'common.bin': '846cfcb325b59596fe4daf1bb35791275d3cc80b7aff3166f51b3c620bf38717',
    'negated.bin': '7bbb0cd0f4bbbf48567726988596e29d740a9575827bb26be1e86c1d6e2298cc',
    'asterisk.bin': '29828cce98558f779cc0d98c30012567453a484df8fc1da84bfef67c52816c02',
}
SOURCES = tuple(f'https://filters.adtidy.org/extension/safari/filters/{number}_optimized.txt'
                for number in (2, 19))
BUNDLE = PROJECT_ROOT / 'web' / 'vendor' / 'adguard-filters'
MAX_JSON = 32 * 1024 * 1024
MAX_DOWNLOAD = 8 * 1024 * 1024
INTERVAL = 24 * 60 * 60


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def validate_rules(rules) -> list[dict]:
    """更新只接受原生网络、隐藏及例外规则，不接收脚本与重定向。"""
    if not isinstance(rules, list) or not 1 <= len(rules) <= 150_000:
        raise ValueError('通用广告规则数量无效')
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {'trigger', 'action'}:
            raise ValueError('通用广告规则结构无效')
        trigger, action = rule['trigger'], rule['action']
        if not isinstance(trigger, dict) or not isinstance(action, dict):
            raise ValueError('通用广告规则字段无效')
        if not isinstance(trigger.get('url-filter'), str) or not trigger['url-filter']:
            raise ValueError('通用广告地址规则无效')
        if action.get('type') not in {'block', 'css-display-none', 'ignore-previous-rules'}:
            raise ValueError('通用广告规则动作无效')
        expected = {'type', 'selector'} if action['type'] == 'css-display-none' else {'type'}
        if set(action) != expected or ('selector' in action and
                (not isinstance(action['selector'], str) or not action['selector'])):
            raise ValueError('通用广告隐藏规则无效')
    return rules


def encode_snapshot(rules: list[dict]) -> bytes:
    validate_rules(rules)
    payload = json.dumps(rules, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(payload) > MAX_JSON:
        raise ValueError('通用广告规则超出大小限制')
    return gzip.compress(payload, mtime=0)


def read_snapshot(path: Path) -> list[dict]:
    if path.stat().st_size > MAX_DOWNLOAD:
        raise ValueError('通用广告快照超出大小限制')
    with gzip.GzipFile(fileobj=io.BytesIO(path.read_bytes())) as stream:
        payload = stream.read(MAX_JSON + 1)
    if len(payload) > MAX_JSON:
        raise ValueError('通用广告规则超出大小限制')
    return validate_rules(json.loads(payload))


def bundled_rules() -> list[dict]:
    manifest = json.loads((BUNDLE / 'manifest.json').read_text(encoding='utf-8'))
    snapshot = BUNDLE / 'rules.json.gz'
    if digest(snapshot.read_bytes()) != manifest['snapshot_sha256']:
        raise ValueError('通用广告快照校验失败')
    return read_snapshot(snapshot)


def load_rules(cache: Path | None = None) -> tuple[list[dict], bool]:
    if cache is not None:
        try:
            return read_snapshot(cache / 'rules.json.gz'), True
        except (OSError, EOFError, ValueError, zlib.error):
            LOGGER.info('通用广告规则使用随包快照')
    return bundled_rules(), False


def download(url: str) -> bytes:
    # 只有固定的订阅和校验过的工具使用此通道；不传入正在观看的网页地址。
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        with client.stream('GET', url) as response:
            response.raise_for_status()
            payload = bytearray()
            deadline = time.monotonic() + 30
            for chunk in response.iter_bytes():
                payload.extend(chunk)
                if len(payload) > MAX_DOWNLOAD or time.monotonic() > deadline:
                    raise ValueError('广告过滤资源超出大小限制')
            return bytes(payload)


def ensure_converter(cache: Path, fetch=download) -> Path:
    folder = cache / f'converter-{VERSION}'
    resources = folder / 'swift-psl_PublicSuffixList.bundle'
    resources.mkdir(parents=True, exist_ok=True)
    files = [(folder / 'ConverterTool', TOOL_URL, TOOL_SHA)]
    files.extend((resources / name,
                  f'https://raw.githubusercontent.com/ameshkov/swift-psl/{PSL_REVISION}/Sources/PublicSuffixList/Resources/{name}',
                  sha) for name, sha in PSL_FILES.items())
    for destination, url, sha in files:
        if destination.is_file() and destination.stat().st_size <= MAX_DOWNLOAD and digest(destination.read_bytes()) == sha:
            continue
        payload = fetch(url)
        if digest(payload) != sha:
            raise ValueError('广告过滤工具校验失败')
        atomic_write_bytes(destination, payload, mode=0o600)
    tool = folder / 'ConverterTool'
    tool.chmod(0o700)
    return tool


def convert(tool: Path, text: str) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix='peach-ad-filter-') as temporary:
        root = Path(temporary).resolve()
        source, output = root / 'input.txt', root / 'rules.json'
        source.write_text(text, encoding='utf-8')
        subprocess.run([str(tool), 'convert', '--safari-version', '15', '--advanced-blocking', 'false',
                        '--input-path', str(source), '--safari-rules-json-path', str(output)],
                       check=True, timeout=45, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if output.stat().st_size > MAX_JSON:
            raise ValueError('广告过滤转换结果超出大小限制')
        return validate_rules(json.loads(output.read_text(encoding='utf-8')))


def refresh_cache(cache: Path, *, force=False, fetch=download, converter=convert, now=time.time) -> bool:
    """完整下载并转换成功才发布快照；失败保留当前缓存和随包快照。"""
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        return False
    cache.mkdir(parents=True, exist_ok=True)
    try:
        with FileLock(str(cache / 'update.lock'), timeout=0):
            stamp = cache / 'attempt.json'
            try:
                last = float(json.loads(stamp.read_text(encoding='utf-8'))['time'])
            except (OSError, KeyError, TypeError, ValueError):
                last = 0
            current = now()
            if not force and 0 <= current - last < INTERVAL:
                return False
            atomic_write_text(stamp, json.dumps({'time': current}), mode=0o600)
            tool = ensure_converter(cache, fetch)
            payloads = [fetch(url) for url in SOURCES]
            for payload in payloads:
                if len(payload) > MAX_DOWNLOAD or not payload.startswith(b'!'):
                    raise ValueError('广告订阅格式无效')
            text = '\n'.join(payload.decode('utf-8-sig') for payload in payloads)
            rules = converter(tool, text)
            snapshot = encode_snapshot(rules)
            atomic_write_bytes(cache / 'rules.json.gz', snapshot, mode=0o600)
            atomic_write_text(cache / 'metadata.json', json.dumps({
                'updated': current, 'converter': VERSION, 'rules': len(rules),
                'sources': [{'url': url, 'sha256': digest(payload)}
                            for url, payload in zip(SOURCES, payloads)],
            }), mode=0o600)
            return True
    except Timeout:
        return False


def start_update(cache: Path | None) -> None:
    if cache is None:
        return

    def update():
        try:
            refresh_cache(cache)
        except (OSError, EOFError, ValueError, zlib.error, httpx.HTTPError, subprocess.SubprocessError):
            LOGGER.warning('通用广告订阅更新失败，保留可用快照', exc_info=True)

    threading.Thread(target=update, name='web-ad-filter-update', daemon=True).start()


def main():
    """维护入口：固定工具转换完整订阅，生成可离线启动的随包数据。"""
    import argparse
    parser = argparse.ArgumentParser(description='生成通用广告过滤快照')
    parser.add_argument('--bundle-dir', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        parser.error('快照生成工具需要 Apple Silicon Mac；其他 Mac 使用随包快照')
    with tempfile.TemporaryDirectory(prefix='peach-ad-bundle-') as temporary:
        cache = Path(temporary).resolve()
        tool = ensure_converter(cache)
        payloads = [download(url) for url in SOURCES]
        source = b'\n'.join(payloads)
        rules = convert(tool, source.decode('utf-8-sig'))
        snapshot = encode_snapshot(rules)
        destination = args.bundle_dir.resolve()
        destination.mkdir(parents=True, exist_ok=True)
        atomic_write_bytes(destination / 'rules.json.gz', snapshot)
        atomic_write_bytes(destination / 'sources.txt.gz', gzip.compress(source, mtime=0))
        atomic_write_text(destination / 'manifest.json', json.dumps({
            'converter': VERSION, 'converter_sha256': TOOL_SHA, 'psl_revision': PSL_REVISION,
            'psl_sha256': PSL_FILES, 'safari_version': 15,
            'snapshot_sha256': digest(snapshot), 'source_sha256': digest(source),
            'rules': len(rules), 'generated': time.time(),
            'sources': [{'url': url, 'sha256': digest(payload)} for url, payload in zip(SOURCES, payloads)],
        }, indent=2) + '\n')
        for name, url in (
            ('LICENSE', f'https://raw.githubusercontent.com/AdguardTeam/SafariConverterLib/v{VERSION}/LICENSE'),
            ('LICENSE.swift-psl', f'https://raw.githubusercontent.com/ameshkov/swift-psl/{PSL_REVISION}/LICENSE'),
        ):
            atomic_write_bytes(destination / name, download(url))


if __name__ == '__main__':
    main()
