"""本机网页观看窗口：隔离会话、内容过滤与单窗口生命周期。"""
from __future__ import annotations

import atexit
import importlib.util
import ipaddress
import json
import logging
import subprocess
import sys
import threading
from urllib.parse import urlsplit

LOGGER = logging.getLogger(__name__)
AD_DOMAINS = (
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "adservice.google.com", "ads.pubmatic.com", "adsrvr.org", "adnxs.com",
    "advertising.com", "amazon-adsystem.com", "criteo.com", "criteo.net",
    "outbrain.com", "taboola.com", "popads.net", "popcash.net",
)


def clean_url(raw: str) -> str:
    """只接收公开 HTTPS 地址；地址不进入日志或账本。"""
    if not isinstance(raw, str) or len(raw) > 4096 or any(ord(c) < 33 for c in raw):
        raise ValueError("请输入公开 HTTPS 网页地址")
    try:
        parsed = urlsplit(raw)
        host = (parsed.hostname or "").rstrip(".").lower()
        port = parsed.port
    except ValueError as exc:
        raise ValueError("请输入公开 HTTPS 网页地址") from exc
    if (parsed.scheme != "https" or not host or parsed.username is not None
            or parsed.password is not None or port not in (None, 443)
            or host.endswith((".local", ".localhost", ".internal"))
            or "." not in host or "\\" in raw):
        raise ValueError("请输入公开 HTTPS 网页地址")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("请输入公开 HTTPS 网页地址")
    if address is None and (not host.rsplit('.', 1)[-1].isalpha()
                            or any(not label or not label.replace('-', '').isalnum()
                                   for label in host.split('.'))):
        raise ValueError("请输入公开 HTTPS 网页地址")
    if blocked_host(host):
        raise ValueError("请输入公开 HTTPS 网页地址")
    return raw


def blocked_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in AD_DOMAINS)


def content_rules() -> list[dict]:
    """WebKit 编译域名边界规则；不按视频扩展名拦截。"""
    import re
    return [{"trigger": {"url-filter": r"^https?://([^/]+\.)?" + re.escape(domain) + r"[:/]",
                         "url-filter-is-case-sensitive": False},
             "action": {"type": "block"}} for domain in AD_DOMAINS]


def navigation_allowed(url: str, origin: str, *, main: bool, clicked: bool) -> bool:
    if url == "about:blank":
        return not main
    try:
        clean_url(url)
    except ValueError:
        return False
    host = urlsplit(url).hostname or ""
    if blocked_host(host):
        return False
    return not main or host == origin


class WatchSession:
    """只持有本入口创建的子进程；关闭操作不碰用户浏览器。"""

    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.state = "closed"
        self.popups = 0

    def snapshot(self):
        with self.lock:
            if self.process is not None and self.process.poll() is not None:
                self.state = "closed" if self.process.returncode == 0 else "error"
            available = (sys.platform == "darwin" and not getattr(sys, "frozen", False)
                         and importlib.util.find_spec("WebKit") is not None)
            return {"available": available, "state": self.state, "popups": self.popups,
                    "platform": "macOS", "ad_domains": len(AD_DOMAINS)}

    def open(self, url, language="en"):
        url = clean_url(url)
        with self.lock:
            if not self.snapshot()["available"]:
                raise ValueError("网页观看需要 macOS WebKit 组件")
            if self.process is not None and self.process.poll() is None:
                raise ValueError("请先关闭当前网页观看窗口")
            from .config import STATE_DIR
            from .web_watch_bundle import launch_command
            try:
                command, environment = launch_command(STATE_DIR / 'web-watch')
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                self.state = 'error'
                LOGGER.exception('网页观看应用宿主准备失败')
                raise ValueError('网页观看窗口加载失败，请关闭后重试') from exc
            self.state, self.popups = "opening", 0
            self.process = subprocess.Popen(
                command, env=environment,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8",
            )
            self.process.stdin.write(json.dumps({"url": url, "language": language}) + "\n")
            self.process.stdin.close()
            threading.Thread(target=self._observe, args=(self.process,), daemon=True).start()
            return self.snapshot()

    def _observe(self, process):
        try:
            for line in process.stdout:
                message = json.loads(line)
                with self.lock:
                    if process is not self.process:
                        return
                    if message.get("event") in {"ready", "error", "loading"}:
                        self.state = message["event"]
                    elif message.get("event") == "popup":
                        self.popups += 1
        except (OSError, ValueError):
            LOGGER.warning("网页观看状态通道关闭")
            with self.lock:
                if process is self.process:
                    self.state = "error"
        finally:
            process.stdout.close()

    def close(self):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
            self.process = None
            self.state = "closed"
            return self.snapshot()


SESSION = WatchSession()
atexit.register(SESSION.close)


def q_web_watch(_contract, _args=None):
    return SESSION.snapshot()


def w_web_watch(_contract, body):
    if body.get("action") == "close":
        return SESSION.close()
    if body.get("action") != "open":
        raise ValueError("网页观看操作无效")
    language = body.get("language", "en")
    if language not in {"zh", "en", "th"}:
        raise ValueError("网页观看语言无效")
    return SESSION.open(body.get("url"), language)
