"""MiniApp 的私有 Python 子进程；JSON 行协议，不监听端口。"""
import argparse
import json
import os
from pathlib import Path
import signal
import sys
import threading

ROUTES = {'/api/state': 'GET', '/api/saves': 'GET', '/api/command': 'POST',
          '/api/chat': 'POST', '/api/save': 'POST', '/api/load': 'POST',
          '/api/newday': 'POST', '/api/accept': 'POST'}


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--initial-save', type=Path)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    saves = args.data_dir / 'saves'
    saves.mkdir(exist_ok=True)
    os.environ['AI_OFFICE_SAVE_DIR'] = str(saves)
    os.environ['AI_OFFICE_ENV_PATH'] = str(args.env_file)
    from dotenv import load_dotenv
    load_dotenv(args.env_file)
    # stdout 只输出协议帧；依赖和业务模块的诊断不会污染 Host 通道。
    output = sys.stdout
    sys.stdout = sys.stderr
    import game as G
    import game_app as API
    import save as SAVE
    valid_saves = [SAVE.load_game(s['id']) for s in SAVE.list_saves() if s.get('ok')]
    latest = max(valid_saves, key=lambda s: s.get('saved_at', 0), default=None)
    if latest:
        if not SAVE.restore(G.GAME, latest).get('ok'):
            raise RuntimeError('Private save could not be restored')
    elif args.initial_save:
        loaded = json.loads(args.initial_save.read_text())
        if not SAVE.restore(G.GAME, loaded).get('ok'):
            raise RuntimeError('Initial save could not be restored')
        SAVE.save_game(G.GAME, '从原游戏继承的进度', why='首次打开 MiniApp 时只读继承')
    write_lock = threading.Lock()
    jobs = {}
    stopped = threading.Event()

    def emit(frame):
        with write_lock:
            output.write(json.dumps(frame, ensure_ascii=False) + '\n')
            output.flush()

    def stop(*_args):
        if stopped.is_set():
            return
        stopped.set()
        G.GAME.running = False
        G.GAME.bump_gen()
        for cancel in list(jobs.values()):
            cancel.set()
        SAVE.save_game(G.GAME, 'MiniApp关闭前进度', why='MiniApp 生命周期结束时保存')

    def dispatch(frame, cancelled):
        rid = frame['id']
        response = None
        try:
            path, method = frame.get('path'), frame.get('method')
            if ROUTES.get(path) != method:
                emit({'id': rid, 'type': 'error', 'message': '不支持这个操作'})
                return
            response = API.app.test_client().open(path, method=method,
                                                  json=frame.get('body') or {}, buffered=False)
            emit({'id': rid, 'type': 'head', 'status': response.status_code,
                  'contentType': response.content_type})
            for chunk in response.response:
                if cancelled.is_set() or stopped.is_set():
                    break
                emit({'id': rid, 'type': 'data',
                      'body': chunk.decode('utf-8') if isinstance(chunk, bytes) else chunk})
            emit({'id': rid, 'type': 'end'})
        except Exception:
            emit({'id': rid, 'type': 'error', 'message': '本次操作未完成，请稍后再试'})
        finally:
            if response is not None:
                response.close()
            jobs.pop(rid, None)

    def stop_signal(*_args):
        stop()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    API.boot()
    emit({'type': 'ready', 'gameplayVersion': 5})
    try:
        for line in sys.stdin:
            if stopped.is_set():
                break
            try:
                frame = json.loads(line)
            except (ValueError, TypeError):
                continue
            if frame.get('type') == 'shutdown':
                stop()
                emit({'type': 'stopped'})
                break
            rid = frame.get('id')
            if frame.get('type') == 'cancel':
                if rid in jobs:
                    jobs[rid].set()
                continue
            if not isinstance(rid, int) or rid in jobs or len(jobs) >= 32:
                continue
            cancelled = threading.Event()
            jobs[rid] = cancelled
            threading.Thread(target=dispatch, args=(frame, cancelled), daemon=True).start()
    finally:
        stop()


if __name__ == '__main__':
    run()
