# -*- coding: utf-8 -*-
"""Create a reproducible preview ZIP, then verify its entries and SHA-256 hashes."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / '.minimax-plugin/plugin.json').read_text(encoding='utf-8'))
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
app = json.loads((root / 'miniapp/miniapp.json').read_text(encoding='utf-8'))

assert manifest['schemaVersion'] == 1
assert re.fullmatch(r'[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*', manifest['name'])
assert len(manifest['name']) <= 80
assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', manifest['version'])
for key in ['description', 'author', 'category', 'icon']:
    assert isinstance(manifest[key], str) and manifest[key].strip(), key
assert manifest['exampleQueries'] and all(isinstance(s, str) and s.strip() for s in manifest['exampleQueries'])
for key in ['apps', 'mcpServers', 'skills']:
    assert isinstance(manifest[key], list), key
assert package['mcode'] == {'schemaVersion': 2, 'miniApp': './miniapp/miniapp.json'}
assert manifest['version'] == package['version']
assert set(app) == {'schemaVersion', 'artifacts', 'runtime', 'surface', 'mcpEndpoints', 'agentAccess'}
assert app['schemaVersion'] == 1
assert app['runtime']['kind'] == 'process'
assert app['runtime']['lifecycle'] == 'on-demand'
assert app['mcpEndpoints'] == [{'server':'retouch-images','path':'/mcp/retouch-images'}]
assert app['agentAccess'] == ['session.run']
assert manifest['mcpServers'] == ['servers.mcp.json']
assert app['surface'] == {'path': '/'}

def inside(relative):
    assert isinstance(relative, str) and '\\' not in relative
    parts = Path(relative).parts
    assert not Path(relative).is_absolute() and '..' not in parts
    path = root / relative
    assert path.exists() and not path.is_symlink(), relative
    assert path.resolve().is_relative_to(root), relative
    return path

inside(manifest['icon'])
for skill in manifest['skills']:
    assert skill.startswith('skills/') and skill.endswith('/SKILL.md'), skill
    inside(skill)
for role in ['client', 'node']:
    paths = app['artifacts'][role]
    assert paths and len(paths) == len(set(paths))
    for path in paths:
        assert path.startswith('./miniapp/'), path
        inside(path)
entry = inside(app['runtime']['entry'])
assert entry.suffix in ['.mjs', '.js', '.cjs']
assert any(entry.is_relative_to(inside(p)) for p in app['artifacts']['node'])

subprocess.run(['node', 'scripts/check.mjs'], cwd=root, check=True)
subprocess.run(['node', 'scripts/check-ptc.mjs'], cwd=root, check=True)
subprocess.run(['node', 'scripts/check-draw.mjs'], cwd=root, check=True)
allowed = ['.minimax-plugin', 'miniapp', 'package.json', 'icon.png', 'servers.mcp.json', 'licenses', 'skills']
files = []
for relative in allowed:
    path = inside(relative)
    candidates = path.rglob('*') if path.is_dir() else [path]
    for candidate in candidates:
        if '__pycache__' in candidate.parts or 'node_modules' in candidate.parts or (candidate.parent.name == 'showcase' and candidate.suffix == '.png'):
            continue
        assert not candidate.is_symlink(), str(candidate)
        if candidate.is_file():
            files.append(candidate)
files.sort(key=lambda p: p.relative_to(root).as_posix())
name = manifest['name']
out = root / 'releases'
out.mkdir(exist_ok=True)
archive = out / (name + '-' + manifest['version'] + '-preview.zip')
entries = []
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for path in files:
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        if relative == 'package.json':
            runtime_package = json.loads(data)
            runtime_package.pop('scripts', None)
            data = (json.dumps(runtime_package, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        info = zipfile.ZipInfo(name + '/' + relative, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        target.writestr(info, data)
        entries.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
    assert len(check.namelist()) == len(entries)
    for item in entries:
        assert hashlib.sha256(check.read(name + '/' + item['path'])).hexdigest() == item['sha256']
report = {
    'status': 'preview-host-unverified',
    'pluginId': name,
    'version': manifest['version'],
    'archive': archive.name,
    'bytes': archive.stat().st_size,
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'files': entries,
}
(out / 'package-integrity.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
# Source and acceptance evidence remain available separately from the install payload.
source_archive = out / (name + '-' + manifest['version'] + '-source.zip')
with zipfile.ZipFile(source_archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for folder in ['ui-src', 'ptc-src', 'scripts', 'docs', 'evidence', 'sdk', 'examples']:
        for path in sorted((root / folder).rglob('*')):
            if path.is_file() and 'node_modules' not in path.parts and '__pycache__' not in path.parts:
                target.write(path, name + '/' + path.relative_to(root).as_posix())
print(json.dumps({key: report[key] for key in ['status', 'archive', 'bytes', 'sha256']}, indent=2))
