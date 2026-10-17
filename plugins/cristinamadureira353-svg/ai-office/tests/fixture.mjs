import { mkdtemp, writeFile, chmod, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

export async function fixture({relocate=false,client=false,resting=false,conflict=false,initialSave=''}={}) {
  let pluginRoot = resolve(process.env.AI_OFFICE_TEST_PLUGIN);
  const python = process.env.AI_OFFICE_TEST_PYTHON;
  if (!python) throw new Error('Set AI_OFFICE_TEST_PYTHON to the existing venv interpreter');
  const scratch = await mkdtemp(join(tmpdir(), 'ai-office-miniapp-test-'));
  if (relocate) {
    const relocated = join(scratch, 'New Player Installed App');
    await cp(pluginRoot, relocated, {recursive:true});
    pluginRoot = relocated;
  }
  const dataDir = join(scratch, 'private');
  await mkdir(dataDir);
  const pythonPath = join(scratch, 'python'), envFile = join(scratch, 'empty.env');
  await writeFile(envFile, '# isolated fake API configuration\n');
  await writeFile(pythonPath, `#!${python}
import json, os, pathlib, runpy, sys
if sys.argv[1:2] == ['-c']:
    exec(sys.argv[2])
    raise SystemExit(0)
bridge = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(bridge.parent))
data = pathlib.Path(sys.argv[sys.argv.index('--data-dir') + 1])
os.environ['AI_OFFICE_ENV_PATH'] = sys.argv[sys.argv.index('--env-file') + 1]
os.environ['AI_OFFICE_SAVE_DIR'] = str(data / 'saves')
os.environ['OPENROUTER_API_KEY'] = ''
import providers as P
for item in P.PROVIDERS.values(): os.environ[item['key_env']] = 'fake-test-key'
import requests
def denied(*args, **kwargs):
    (data / 'network-attempt').write_text('blocked')
    raise AssertionError('No paid network requests permitted')
requests.sessions.Session.request = denied
def fake(who, text, **kwargs):
    with (data / 'calls.jsonl').open('a') as log:
        log.write(json.dumps({'who':who, 'text':text}, ensure_ascii=False) + '\\n')
    if who == 'kimi' and not (data / 'quota-restored').exists():
        yield P.error_event(who, 429, {'error':{'type':'exceeded_current_quota_error'}})
        return
    for text in ['在', '的，', '老板找我啥事']:
        yield {'type':'delta', 'who':who, 'text':text}
    yield {'type':'done', 'who':who}
P.stream_chat = fake
import game as G, game_app as API
API.boot = lambda: None
if ${resting ? 'True' : 'False'}:
    for who, spot in G.REST_SPOTS['slack'].items():
        employee = G.GAME.workers[who]
        employee.pos, employee.acting = spot, '在摸鱼'
        employee.path, employee.order = [], None
if ${client ? 'True' : 'False'}:
    customer = G.Client('帮我整理一份测试文档', 96, 200, 'document', 'normal')
    customer.status, customer.served_by, customer.slot = '服务中', 'm3', 0
    G.GAME.clients.append(customer)
    G.GAME.slots[0] = customer
    G.GAME.workers['m3'].job = customer.id
if ${conflict ? 'True' : 'False'}:
    def seed_conflict():
        with G.GAME._lock:
            G.GAME.clients.clear()
            G.GAME.conflicts.clear()
            for slot in G.GAME.slots: G.GAME.slots[slot] = None
            for employee in G.GAME.workers.values():
                employee.job, employee.order, employee.mood = None, None, 70
            customer = G.Client('帮我把这套流程跑通', 96, 200, 'document', 'normal')
            customer.status, customer.slot = '冲突中', 0
            G.GAME.clients.append(customer)
            G.GAME.slots[0] = customer
            G.GAME.conflicts[customer.id] = {
                'a':'m3', 'b':'flash', 'task':customer.task, 'client':customer.id, 'judged':False,
                'lines':[{'who':'m3','text':'我有现成模板，今晚就能跑通。'},
                         {'who':'flash','text':'我比他更合适，这单给我。'}]}
            for who in ('m3', 'flash'):
                employee = G.GAME.workers[who]
                employee.job, employee.acting = customer.id, '去理论'
    # 裁决仍走真实 Game.judge；仅隔离获胜后的付费交付线程。
    G.GAME._serve_client_thread = lambda *args: None
    seed_conflict()
    @API.app.before_request
    def fixture_requests():
        marker = data / 'reset-conflict'
        if marker.exists():
            marker.unlink()
            seed_conflict()
        if API.request.path == '/api/command':
            with (data / 'commands.jsonl').open('a') as log:
                log.write(json.dumps(API.request.get_json(silent=True), ensure_ascii=False) + '\\n')
(data / 'fixture-pid').write_text(str(os.getpid()))
sys.argv = [str(bridge)] + sys.argv[3:]
runpy.run_path(str(bridge), run_name='__main__')
`);
  await chmod(pythonPath, 0o700);
  const listen = { host:'127.0.0.1', port:await new Promise((resolvePort, reject) => {
    const socket = createServer(); socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolvePort(port)); });
  }) };
  const logs = [], signal = new AbortController();
  const logger = Object.fromEntries(['info','debug','warn','error'].map(level => [level, message => logs.push(message)]));
  const module = await import(pathToFileURL(process.env.AI_OFFICE_TEST_SERVER || join(pluginRoot, 'miniapp/node/server.mjs')));
  const context = { pluginId:'ai-office', pluginRoot, dataDir, listen, logger, signal:signal.signal };
  let runtime = await module.start(context);
  const base = 'http://' + listen.host + ':' + listen.port;
  const settings = { pythonPath, envFile, initialSave };
  const get = async path => (await fetch(base + path)).json();
  const post = (path, body) => fetch(base + path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
  return { pluginRoot, scratch, dataDir, base, settings, get, post, logs,
    async resetConflict() {
      if (!conflict) throw new Error('Conflict fixture is required');
      await writeFile(join(dataDir, 'reset-conflict'), 'reset');
      return (await get('/api/state')).conflicts[0];
    },
    async dispose() { await runtime.dispose(); },
    async restart() { runtime = await module.start(context); }
  };
}
