#!/usr/bin/env python3
"""Install pinned, dependency-free MIT transport. No credentials or defaults changed."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
target = root / '.tools/venice-web/upstream'
revision = '6928f8a231931f10bda63c31e6a24ad14fcbeb72'
if not target.exists():
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'clone', 'https://github.com/CanArslanDev/opencode-venice-web.git', str(target)], check=True)
subprocess.run(['git', '-C', str(target), 'checkout', '--detach', revision], check=True)
# Content, arguments, raw errors and reasoning must never enter the service logs.
(target / 'src/lib/log.mjs').write_text('''export const log = () => {};
export const warn = () => {};
export const fail = () => {};
export const debugRaw = () => {};
export const preview = () => '[redacted]';
''')
# Heart accepts only exact declared names/aliases, never guessed shell/file tools.
p = target / 'src/lib/emulate.mjs'
source = p.read_text()
old = "  const target = TOOL_ALIASES[name]\n  return target && available?.has(target) ? target : name"
if old not in source and '  return name // Heart: exact names only' not in source:
    raise RuntimeError('Pinned tool normalizer changed')
p.write_text(source.replace(old, '  return name // Heart: exact names only'))
p = target / 'src/lib/config.mjs'
source = p.read_text().replace("export const judgeEnabled = process.env.VENICE_WEB_JUDGE !== '0'", 'export const judgeEnabled = false')
source = source.replace('export const debug = !!process.env.VENICE_WEB_DEBUG', 'export const debug = false')
source = source.replace('export const dumpFile = process.env.VENICE_WEB_DUMP', 'export const dumpFile = undefined')
p.write_text(source)
print('Pinned MIT bridge installed; no login, inference or API credit spent.')
