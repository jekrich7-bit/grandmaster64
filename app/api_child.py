import json
import random
import time
import uuid as uuidlib
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request, jsonify

import app.db as db
from app.auth import require
from app import chessbox

bp = Blueprint('child', __name__)

# in-memory puzzle sessions: token -> dict
SESSIONS = {}


def _st():
    return db.get_settings()


def _pick_puzzle(user, task_id=None):
    st = _st()
    rmin = int(st.get('rating_min', 400))
    rmax = int(st.get('rating_max', 1600))
    if task_id:
        t = db.q1('SELECT * FROM tasks WHERE id=?', (task_id,))
        if not t:
            return None, 'task_missing'
        ids = [p['id'] for p in db.q('SELECT * FROM puzzles WHERE enabled=1 AND id IN (%s)' %
                                     ','.join('?' * max(1, len(json.loads(t['puzzle_ids'] or '[]')))),
                                     json.loads(t['puzzle_ids'] or '[]'))]
        solved = {e['data'].get('puzzle') for e in db.child_events(user['id'], 1000)
                  if e['type'] == 'puzzle_solved' and e['data'].get('task_id') == task_id}
        ids = [i for i in ids if i not in solved]
        if not ids:
            return None, 'task_complete'
        p = db.q1('SELECT * FROM puzzles WHERE id=?', (random.choice(ids),))
    else:
        rows = db.q('SELECT * FROM puzzles WHERE enabled=1 AND rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 25', (rmin, rmax))
        if not rows:
            rows = db.q('SELECT * FROM puzzles WHERE enabled=1 ORDER BY RANDOM() LIMIT 25')
        if not rows:
            return None, 'no_puzzles'
        last = SESSIONS.get('last_%s' % user['id'], -1)
        rows = [r for r in rows if r['id'] != last] or rows
        p = rows[0]
    return p, None


@bp.post('/api/puzzle/start')
@require('child')
def puzzle_start():
    d = request.get_json(silent=True) or {}
    task_id = d.get('task_id')
    p, err = _pick_puzzle(request.auth_user, task_id)
    if p is None:
        return jsonify(ok=0, error=err), 400
    token = uuidlib.uuid4().hex
    SESSIONS[token] = {
        'user_id': request.auth_user['id'],
        'puzzle_id': p['id'],
        'fen': p['fen'],
        'moves': p['solution'].split(','),
        'ply': 0,
        'hints': 0,
        'mistakes': 0,
        'task_id': task_id,
        'start_ts': time.time(),
        'done': False,
    }
    SESSIONS['last_%s' % request.auth_user['id']] = p['id']
    db.log_event(request.auth_user['id'], 'puzzle_start', {'puzzle': p['id'], 'rating': p['rating'], 'task_id': task_id})
    return jsonify(ok=1, token=token, puzzle={
        'id': p['id'], 'fen': p['fen'], 'rating': p['rating'],
        'themes': [t for t in (p['themes'] or '').split(',') if t],
        'side': chessbox.to_move(p['fen']),
        'length': len(p['solution'].split(',')),
        'task_id': task_id,
    })


def _session(token):
    s = SESSIONS.get(token)
    if not s:
        return None
    return s


@bp.post('/api/puzzle/move')
@require('child')
def puzzle_move():
    d = request.get_json(silent=True) or {}
    s = _session(d.get('token'))
    if not s:
        return jsonify(ok=0, error='session'), 400
    st = _st()
    status, info = chessbox.play(s['fen'], d.get('uci', ''), s['moves'], s['ply'])
    if status == 'illegal':
        return jsonify(ok=1, bad='illegal', fen=s['fen'])
    if status == 'wrong':
        s['mistakes'] += 1
        db.log_event(s['user_id'], 'puzzle_mistake', {'puzzle': s['puzzle_id'], 'uci': d.get('uci'), 'mistakes': s['mistakes']})
        return jsonify(ok=1, bad='wrong', mistakes=s['mistakes'], fen=s['fen'])
    s['fen'] = info['fen']
    s['ply'] += 2  # user move + auto opponent reply
    if status == 'solved':
        s['done'] = True
        secs = int(time.time() - s['start_ts'])
        score = max(5, 100 - s['hints'] * int(st.get('hint_penalty', 20)) - s['mistakes'] * int(st.get('mistake_penalty', 5)))
        data = {'puzzle': s['puzzle_id'], 'rating': info.get('rating'), 'secs': secs,
                'hints': s['hints'], 'mistakes': s['mistakes'], 'score': score, 'task_id': s['task_id']}
        pz = db.q1('SELECT * FROM puzzles WHERE id=?', (s['puzzle_id'],))
        data['rating'] = pz['rating'] if pz else None
        data['theme'] = (pz['themes'] or '').split(',')[0] if pz else ''
        db.log_event(s['user_id'], 'puzzle_solved', data)
        if s['task_id']:
            _bump_task(s)
        return jsonify(ok=1, solved=1, fen=s['fen'], my_uci=info['my_uci'],
                       score=score, secs=secs, hints=s['hints'], mistakes=s['mistakes'])
    return jsonify(ok=1, good=1, fen=s['fen'], my_uci=info['my_uci'], opp_uci=info.get('opp_uci'),
                   side=chessbox.to_move(s['fen']))


def _bump_task(s):
    item = db.q1('SELECT * FROM task_items WHERE task_id=? AND child_id=?', (s['task_id'], s['user_id']))
    if not item:
        return
    t = db.q1('SELECT * FROM tasks WHERE id=?', (s['task_id'],))
    if not t:
        return
    ids = set(json.loads(t['puzzle_ids'] or '[]'))
    if s['puzzle_id'] not in ids:
        return
    n = item['solved_count'] + 1
    total = len(ids)
    status = 'done' if n >= total else 'pending'
    db.run('UPDATE task_items SET solved_count=?, status=?, done_at=? WHERE id=?',
           (n, status, db.now() if status == 'done' else None, item['id']))
    if status == 'done':
        db.log_event(s['user_id'], 'task_done', {'task_id': s['task_id'], 'title': t['title']})


@bp.post('/api/puzzle/hint')
@require('child')
def puzzle_hint():
    d = request.get_json(silent=True) or {}
    s = _session(d.get('token'))
    if not s:
        return jsonify(ok=0, error='session'), 400
    st = _st()
    if s['hints'] >= int(st.get('max_hints', 3)):
        return jsonify(ok=0, error='no_hints'), 400
    if s['ply'] >= len(s['moves']):
        return jsonify(ok=0, error='done'), 400
    s['hints'] += 1
    uci = s['moves'][s['ply']]
    db.log_event(s['user_id'], 'hint_used', {'puzzle': s['puzzle_id'], 'n': s['hints'], 'task_id': s['task_id']})
    return jsonify(ok=1, hint={'from': uci[:2], 'to': uci[2:4], 'promo': uci[4:] if len(uci) > 4 else None},
                   remaining=int(st.get('max_hints', 3)) - s['hints'])


@bp.post('/api/puzzle/giveup')
@require('child')
def puzzle_giveup():
    d = request.get_json(silent=True) or {}
    s = _session(d.get('token'))
    if s:
        db.log_event(s['user_id'], 'puzzle_giveup', {'puzzle': s['puzzle_id'], 'task_id': s['task_id']})
        SESSIONS.pop(d.get('token'), None)
    return jsonify(ok=1)


@bp.get('/api/puzzle/legal')
@require('child')
def puzzle_legal():
    s = _session(request.args.get('token'))
    if not s:
        return jsonify(ok=0, error='session'), 400
    return jsonify(ok=1, legal=chessbox.legal_moves(s['fen']), side=chessbox.to_move(s['fen']))


@bp.get('/api/tasks')
@require('child')
def my_tasks():
    u = request.auth_user
    tasks = db.q('SELECT * FROM tasks ORDER BY id DESC')
    out = []
    for t in tasks:
        it = db.q1('SELECT * FROM task_items WHERE task_id=? AND child_id=?', (t['id'], u['id']))
        if not it:
            continue
        due = datetime.fromisoformat(t['created_at']) + timedelta(days=int(t['due_days'] or 7))
        ids = json.loads(t['puzzle_ids'] or '[]')
        ratings = [p['rating'] for p in db.q('SELECT rating FROM puzzles WHERE id IN (%s)' % ','.join('?' * len(ids)), ids)] if ids else []
        out.append({
            'id': t['id'], 'title': t['title'], 'description': t['description'],
            'total': len(ids), 'solved': it['solved_count'], 'status': it['status'],
            'due_days': t['due_days'], 'created_at': t['created_at'],
            'avg_rating': int(sum(ratings) / len(ratings)) if ratings else 0,
        })
    out.sort(key=lambda x: (x['status'] != 'pending', -x['id']))
    return jsonify(ok=1, tasks=out)


@bp.get('/api/sections')
@require('child', 'parent')
def sections_list():
    secs = db.q('SELECT * FROM sections ORDER BY sort, id')
    for s in secs:
        s['videos'] = db.q('SELECT * FROM videos WHERE section_id=? ORDER BY id', (s['id'],))
        for v in s['videos']:
            v['done'] = bool(db.q1('SELECT id FROM events WHERE user_id=? AND type="video_complete" AND JSON_EXTRACT(data,\'$.video\')=?',
                                   (request.auth_user['id'], v['id'])))
    return jsonify(ok=1, sections=secs)


@bp.post('/api/video/event')
@require('child')
def video_event():
    d = request.get_json(silent=True) or {}
    vid = d.get('video_id')
    ev = d.get('event')
    if ev not in ('start', 'complete') or not vid:
        return jsonify(ok=0, error='bad'), 400
    v = db.q1('SELECT * FROM videos WHERE id=?', (vid,))
    if not v:
        return jsonify(ok=0, error='bad'), 400
    if ev == 'start':
        db.log_event(request.auth_user['id'], 'video_start', {'video': vid, 'title': v['title']})
    else:
        if not db.q1('SELECT id FROM events WHERE user_id=? AND type="video_complete" AND JSON_EXTRACT(data,\'$.video\')=?',
                     (request.auth_user['id'], vid)):
            db.log_event(request.auth_user['id'], 'video_complete', {'video': vid, 'title': v['title']})
    return jsonify(ok=1)


@bp.get('/api/stats')
def my_stats():
    from app.auth import current_user
    u = current_user()
    if not u:
        return jsonify(ok=0, error='auth'), 401
    uid = request.args.get('user_id', type=int) or u['id']
    if uid != u['id'] and u['role'] == 'child':
        return jsonify(ok=0, error='forbidden'), 403
    if u['role'] == 'parent' and uid != u['id']:
        c = db.q1('SELECT id FROM users WHERE id=? AND parent_id=?', (uid, u['id']))
        if not c:
            return jsonify(ok=0, error='forbidden'), 403
    target = db.q1('SELECT id,name,username,role,lang FROM users WHERE id=?', (uid,))
    if not target or target['role'] != 'child':
        return jsonify(ok=0, error='forbidden'), 403
    return jsonify(ok=1, stats=build_stats(uid), child=target)


def build_stats(uid, days=14):
    ev = db.child_events(uid, 2000)
    solved = [e for e in ev if e['type'] == 'puzzle_solved']
    started = [e for e in ev if e['type'] == 'puzzle_start']
    hints = [e for e in ev if e['type'] == 'hint_used']
    mistakes = [e for e in ev if e['type'] == 'puzzle_mistake']
    vdone = [e for e in ev if e['type'] == 'video_complete']
    tdone = [e for e in ev if e['type'] == 'task_done']
    times = [e['data'].get('secs', 0) for e in solved]
    scores = [e['data'].get('score', 0) for e in solved]
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    today_solved = sum(1 for e in solved if (e['ts'] or '')[:10] == today)
    today_hints = sum(1 for e in hints if (e['ts'] or '')[:10] == today)
    # last N days series
    series = []
    d0 = datetime.now(timezone.utc) - timedelta(days=days - 1)
    for i in range(days):
        ds = (d0 + timedelta(days=i)).strftime('%Y-%m-%d')
        day_s = sum(1 for e in solved if (e['ts'] or '')[:10] == ds)
        day_h = sum(1 for e in hints if (e['ts'] or '')[:10] == ds)
        day_t = sum(int(e['data'].get('secs', 0)) for e in solved if (e['ts'] or '')[:10] == ds)
        series.append({'date': ds, 'solved': day_s, 'hints': day_h, 'secs': day_t})
    # streak
    streak = 0
    for i in range(days, -1, -1):
        ds = (datetime.now(timezone.utc) - timedelta(days=i)).strftime('%Y-%m-%d')
        if any((e['ts'] or '')[:10] == ds for e in solved):
            streak += 1
        else:
            if i == days:
                continue
            break
    by_theme = {}
    for e in solved:
        th = e['data'].get('theme') or 'others'
        by_theme[th] = by_theme.get(th, 0) + 1
    ratings = [e['data'].get('rating') or 0 for e in solved]
    return {
        'total_solved': len(solved),
        'total_started': len(started),
        'accuracy': round(100 * len(solved) / len(started)) if started else 0,
        'hints': len(hints),
        'mistakes': len(mistakes),
        'avg_secs': int(sum(times) / len(times)) if times else 0,
        'best_score': max(scores) if scores else 0,
        'streak': streak,
        'solved_today': today_solved,
        'hints_today': today_hints,
        'videos_done': len(vdone),
        'tasks_done': len(tdone),
        'avg_rating': int(sum(ratings) / len(ratings)) if ratings else 0,
        'series': series,
        'by_theme': by_theme,
        'recent': ev[:40],
    }
