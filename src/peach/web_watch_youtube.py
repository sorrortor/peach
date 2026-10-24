"""固定版本的 YouTube 页面过滤；只改变广告元数据，不提取媒体地址。"""
from __future__ import annotations

import json

from .settings_file import PROJECT_ROOT

VERSION = "2.5.1"
HOSTS = frozenset({"www.youtube.com", "youtube.com", "m.youtube.com"})
PRUNE_PATHS = " ".join(
    prefix + key
    for prefix in ("", "playerResponse.", "2.playerResponse.")
    for key in ("adPlacements", "playerAds", "adSlots")
)


def user_script() -> str:
    """复用 AdGuard 的 JSON 与属性代理，页面主世界在文档开始时安装。"""
    catalog = json.loads((PROJECT_ROOT / "web" / "vendor" / "adguard-scriptlets"
                          / VERSION / "scriptlets.json").read_text(encoding="utf-8"))
    if catalog["version"] != VERSION:
        raise ValueError("网页过滤脚本版本不匹配")
    entries = {name: entry["scriptlet"] for entry in catalog["scriptlets"]
               for name in entry["names"]}
    rules = [
        ("json-prune", [PRUNE_PATHS]),
        ("json-prune-fetch-response", [PRUNE_PATHS, "", "/youtubei/v1/player"]),
        ("json-prune-xhr-response", [PRUNE_PATHS, "", "/youtubei/v1/player"]),
        *[("set-constant", ["ytInitialPlayerResponse." + key, "undefined"])
          for key in ("adPlacements", "playerAds", "adSlots")],
    ]
    calls = []
    for index, (name, args) in enumerate(rules):
        source = {"name": name, "args": args, "verbose": False,
                  "domainName": "youtube.com", "uniqueId": f"peach-youtube-{index}"}
        calls.append(f"({entries[name]})({json.dumps(source)}, {json.dumps(args)});")
    return ("(() => { 'use strict'; if (!"
            + json.dumps(sorted(HOSTS)) + ".includes(location.hostname)) return;\n"
            + "\n".join(calls) + "\n})();")
