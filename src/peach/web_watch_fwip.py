"""FWIP 页面广告结构过滤；保留网站自己的播放入口与媒体加载。"""
from __future__ import annotations

import json

HOSTS = ("fwip-tv.com", "www.fwip-tv.com")
AD_SELECTOR = ("#movie-ads-header, #moive_pop, .movie-floating-ad, "
               "[data-player-ad], [data-player-preroll], [data-player-side-ads]")


def cosmetic_rule() -> dict:
    return {"trigger": {"url-filter": ".*", "if-domain": list(HOSTS)},
            "action": {"type": "css-display-none", "selector": AD_SELECTOR}}


def user_script() -> str:
    """文档开始观察广告节点；模块脚本读取配置前移除 preroll。"""
    return """(() => {
      'use strict';
      if (!HOSTS.includes(location.hostname)) return;
      const pending = new WeakSet();
      const clean = () => {
        for (const player of document.querySelectorAll('[data-movie-player]')) {
          const gate = player.querySelector('[data-player-ad]');
          if (gate) { gate.hidden = true; pending.add(player); }
          const play = player.querySelector('button[data-player-play]');
          if (play && pending.has(player)) {
            play.disabled = false;
            pending.delete(player);
          }
        }
        for (const ad of document.querySelectorAll(SELECTOR)) {
          ad.hidden = true;
          ad.remove();
        }
      };
      const observer = new MutationObserver(clean);
      observer.observe(document, {childList: true, subtree: true});
      clean();
      document.addEventListener('DOMContentLoaded', clean, {once: true});
    })();""".replace('HOSTS', json.dumps(HOSTS)).replace('SELECTOR', json.dumps(AD_SELECTOR))
