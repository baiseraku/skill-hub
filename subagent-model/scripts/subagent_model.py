#!/usr/bin/env python3
"""读写 ZCode 的子代理模型覆盖项。

ZCode 把子代理（subagent）的模型选择存在 <storageRoot>/v2/agents-state.json，
也就是客户端「Settings → Subagents」写的那份文件。结构：

    {
      "builtInModelSelectionOverrides": {
        "general-purpose": {"providerId": "...", "modelId": "...", "options": {"reasoningLevel": "max"}},
        "Explore":         {...}
      },
      "pluginAgentModelSelectionOverrides": {
        "plugin:<插件id>:<agent名小写>": {...}
      },
      "disabledAgentIds": [...]
    }

本脚本只改上面两处，其余键原样保留。写入前留一份 <file>.bak。

用法：
    subagent_model.py where
    subagent_model.py status
    subagent_model.py set <providerId>/<modelId> --level <low|high|max>
    subagent_model.py set-plugin <插件id> <agent名> <providerId>/<modelId> --level <low|high|max>
    subagent_model.py off
    subagent_model.py off-plugin <插件id> <agent名>

模型 id 可以照抄 CreateWorkflow 的 subagent_model 写法带上 `$级别` 后缀
（如 account:bigmodel-start-plan/GLM-5.3-Flash$max），脚本会把 `$max` 剥成
options.reasoningLevel，不会把它留在 modelId 里。

宿主启动子代理时强制要求 reasoningLevel，缺档位的覆盖项会让子代理在启动阶段
硬失败（reason=reasoning-level-missing，2026-10-07 本机实测）。所以 --level 一般
都要给；只有该模型不吃档位时才省略，这种情况脚本会往 stderr 打一句提醒。
"""

import json
import os
import shutil
import sys

BUILTIN_AGENTS = ("general-purpose", "Explore")
# "off" 只对 --level 有意义：显式表示「不写 reasoningLevel」。
LEVELS = ("off", "low", "high", "max")
# `$` 后缀不允许 off——`$off` 没有语义。
SUFFIX_LEVELS = ("low", "high", "max")


def storage_root():
    """storageRoot 的解析顺序：环境变量 → ~/.zcode/cli/config.json 的 storage.dir → ~/.zcode。"""
    env = os.environ.get("ZCODE_STORAGE_DIR")
    if env and env.strip():
        return os.path.expanduser(env.strip())

    cfg = os.path.expanduser("~/.zcode/cli/config.json")
    try:
        with open(cfg, encoding="utf-8") as handle:
            data = json.load(handle)
        configured = (data.get("storage") or {}).get("dir")
        if isinstance(configured, str) and configured.strip():
            return os.path.expanduser(configured.strip())
    except (OSError, ValueError):
        pass
    return os.path.expanduser("~/.zcode")


def state_path():
    return os.path.join(storage_root(), "v2", "agents-state.json")


def load_state(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            raw = handle.read().strip()
    except OSError as err:
        raise SystemExit(f"错误：读不到 {path}：{err}")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError as err:
        raise SystemExit(f"错误：{path} 不是合法 JSON（{err}）。已中止，未做任何修改。")
    if not isinstance(data, dict):
        raise SystemExit(f"错误：{path} 的顶层不是 JSON 对象。已中止，未做任何修改。")
    return data


def save_state(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        shutil.copy2(path, path + ".bak")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def parse_model_id(model_id):
    """拆 'provider/model'，并剥掉可选的 '$级别' 后缀。

    providerId 里不含 '/'，所以按第一个 '/' 切。
    CreateWorkflow 的 subagent_model 写作 provider/model$level，而 agents-state.json
    的 modelId 必须是纯模型名——这里统一剥掉后缀，避免 `$max` 被写进 modelId。
    返回 (providerId, modelId, 后缀级别或 None)。
    """
    text = model_id.strip()
    suffix_level = None
    if "$" in text:
        text, _, suffix_level = text.partition("$")
        text = text.strip()
        suffix_level = suffix_level.strip() or None
        if suffix_level is not None and suffix_level not in SUFFIX_LEVELS:
            raise SystemExit(
                f"错误：'$' 后缀只能是 {'/'.join(SUFFIX_LEVELS)}，收到 ${suffix_level}。"
            )
    if "/" not in text:
        raise SystemExit(
            f"错误：模型 id 需要写成 <providerId>/<modelId> 形式，收到的是 {model_id!r}。"
        )
    provider, model = text.split("/", 1)
    provider, model = provider.strip(), model.strip()
    if not provider or not model:
        raise SystemExit(f"错误：模型 id 的 provider 或 model 段为空：{model_id!r}。")
    return provider, model, suffix_level


def make_selection(provider, model, level):
    selection = {"providerId": provider, "modelId": model}
    if level and level != "off":
        if level not in LEVELS:
            raise SystemExit(f"错误：--level 只能是 {'/'.join(LEVELS)}，收到 {level!r}。")
        selection["options"] = {"reasoningLevel": level}
    else:
        # 实测：宿主启动子代理时强制要求档位，缺档位的覆盖项会直接硬失败。
        print(
            "警告：这次没写 reasoningLevel，写出的覆盖项会让子代理在启动阶段硬失败"
            "（reason=reasoning-level-missing）。只有确认该模型不吃档位时才这样写，"
            "否则请补 --level（该模型的可用档位见 ListModels）。",
            file=sys.stderr,
        )
    return selection


def plugin_key(plugin_id, agent_name):
    """键格式与 ZCode 内部一致：plugin:<插件id>:<agent名小写>。"""
    return f"plugin:{plugin_id.strip()}:{agent_name.strip().lower()}"


def fmt_selection(selection):
    if not selection:
        return "(未设置，跟随会话模型)"
    provider = selection.get("providerId", "?")
    model = selection.get("modelId", "?")
    level = (selection.get("options") or {}).get("reasoningLevel")
    return f"{provider}/{model}" + (f"  reasoningLevel={level}" if level else "")


def print_status(data):
    print(f"状态文件: {state_path()}")
    if not os.path.exists(state_path()):
        print("  (文件不存在)")
    builtin = data.get("builtInModelSelectionOverrides") or {}
    print("内置子代理 (general-purpose / Explore):")
    for name in BUILTIN_AGENTS:
        print(f"  {name:<18} {fmt_selection(builtin.get(name))}")
    plugin = data.get("pluginAgentModelSelectionOverrides") or {}
    print("插件子代理:")
    if not plugin:
        print("  (无覆盖)")
    for key in sorted(plugin):
        print(f"  {key}  {fmt_selection(plugin.get(key))}")


def take_level(argv):
    """取出 --level X，返回 (剩余参数, level)。"""
    level = None
    rest = []
    index = 0
    while index < len(argv):
        if argv[index] == "--level":
            if index + 1 >= len(argv):
                raise SystemExit("错误：--level 后面要跟一个值。")
            level = argv[index + 1].strip()
            index += 2
            continue
        rest.append(argv[index])
        index += 1
    if level is not None and level not in LEVELS:
        raise SystemExit(f"错误：--level 只能是 {'/'.join(LEVELS)}，收到 {level!r}。")
    return rest, level


def main(argv):
    if not argv:
        print(__doc__.strip())
        return 1

    command, rest = argv[0], argv[1:]

    if command == "where":
        print(state_path())
        return 0

    path = state_path()
    data = load_state(path)

    if command == "status":
        print_status(data)
        return 0

    if command == "set":
        rest, level = take_level(rest)
        if len(rest) != 1:
            raise SystemExit("用法：subagent_model.py set <providerId>/<modelId> [--level low|high|max]")
        provider, model, suffix = parse_model_id(rest[0])
        selection = make_selection(provider, model, level or suffix)
        data["builtInModelSelectionOverrides"] = {name: dict(selection) for name in BUILTIN_AGENTS}
        save_state(path, data)
        print_status(data)
        return 0

    if command == "set-plugin":
        rest, level = take_level(rest)
        if len(rest) != 3:
            raise SystemExit(
                "用法：subagent_model.py set-plugin <插件id> <agent名> <providerId>/<modelId> [--level ...]"
            )
        plugin_id, agent_name, model_id = rest
        provider, model, suffix = parse_model_id(model_id)
        overrides = data.setdefault("pluginAgentModelSelectionOverrides", {})
        overrides[plugin_key(plugin_id, agent_name)] = make_selection(provider, model, level or suffix)
        save_state(path, data)
        print_status(data)
        return 0

    if command == "off":
        # 写成空对象而不是删键：这样 ZCode 走新键路径，不会回落到旧的 builtInModelOverrides。
        data["builtInModelSelectionOverrides"] = {}
        save_state(path, data)
        print_status(data)
        return 0

    if command == "off-plugin":
        if len(rest) != 2:
            raise SystemExit("用法：subagent_model.py off-plugin <插件id> <agent名>")
        key = plugin_key(rest[0], rest[1])
        overrides = data.get("pluginAgentModelSelectionOverrides")
        if not isinstance(overrides, dict) or key not in overrides:
            # 不新建这个键：凭空建一个空的 pluginAgentModelSelectionOverrides 会让
            # ZCode 走新键路径，从而静默丢掉文件里可能存在的旧键 pluginAgentModelOverrides。
            print(f"没有 {key} 这条覆盖，未改动。")
            print_status(data)
            return 0
        del overrides[key]
        data["pluginAgentModelSelectionOverrides"] = overrides
        save_state(path, data)
        print_status(data)
        return 0

    raise SystemExit(f"未知命令：{command}\n\n{__doc__.strip()}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
