import json

from flask import Blueprint, request, jsonify

import app.db as db
from app.auth import require, hash_pw, _pub
from app.lichess import refresh_async

bp = Blueprint('admin', __name__)

SETTINGS_EDITABLE = ('app_name', 'tagline', 'default_lang', 'max_hints', 'rating_min', 'rating_max',
                     'hint_penalty', 'mistake_penalty', 'allow_signup', 'lichess_limit')


@bp.get('/api/admin/dashboard')
@require('admin')
def dashboard():
    users = db.q1('SELECT COUNT(*) c FROM users')['c']
    kids = db.q1('SELECT COUNT(*) c FROM users WHERE role="child" AND active=1')['c']
    puzzles = db.q1('SELECT COUNT(*) c FROM puzzles WHERE enabled=1')['c']
    videos = db.q1('SELECT COUNT(*) c FROM videos')['c']
    today = db.today()
    solved_today = db.q1("SELECT COUNT(*) c FROM events WHERE type='puzzle_solved' AND ts LIKE ?", (today + '%',))['c']
    hints_today = db.q1("SELECT COUNT(*) c FROM events WHERE type='hint_used' AND ts LIKE ?", (today + '%',))['c']
    events_today = db.q1("SELECT COUNT(*) c FROM events WHERE ts LIKE ?", (today + '%',))['c']
    per_child = []
    for r in db.q('SELECT id,name FROM users WHERE role="child" AND active=1 ORDER BY id'):
        s = db.q1("SELECT COUNT(*) c FROM events WHERE type='puzzle_solved' AND user_id=?", (r['id'],))
        h = db.q1("SELECT COUNT(*) c FROM events WHERE type='hint_used' AND user_id=?", (r['id'],))
        per_child.append({'id': r['id'], 'name': r['name'], 'solved': s['c'], 'hints': h['c']})
    per_child.sort(key=lambda x: -x['solved'])
    return jsonify(ok=1, dashboard={
        'users': users, 'children': kids, 'puzzles': puzzles, 'videos': videos,
        'solved_today': solved_today, 'hints_today': hints_today, 'events_today': events_today,
        'per_child': per_child,
        'refresh': json.loads(db.get_settings().get('puzzle_refresh_status') or '{}'),
        'events': db.all_events(30),
    })


# ---------------- users ----------------

@bp.get('/api/admin/users')
@require('admin')
def users_list():
    rows = db.q('SELECT id,username,name,role,lang,active,parent_id,created_at FROM users ORDER BY id')
    for r in rows:
        par = db.q1('SELECT name FROM users WHERE id=?', (r['parent_id'],)) if r['parent_id'] else None
        r['parent_name'] = par['name'] if par else None
    return jsonify(ok=1, users=rows)


@bp.post('/api/admin/users')
@require('admin')
def user_create():
    d = request.get_json(silent=True) or {}
    username = (d.get('username') or '').strip()
    name = (d.get('name') or '').strip() or username
    pw = d.get('password') or '123456'
    role = d.get('role') if d.get('role') in ('admin', 'teacher', 'parent', 'child') else 'child'
    lang = d.get('lang') if d.get('lang') in ('en', 'ru', 'uz', 'tr', 'ar') else 'uz'
    parent_id = d.get('parent_id') or None
    if len(username) < 3 or len(pw) < 4:
        return jsonify(ok=0, error='weak'), 400
    if db.q1('SELECT id FROM users WHERE username=?', (username,)):
        return jsonify(ok=0, error='taken'), 400
    uid = db.run('INSERT INTO users(username,pass,name,role,lang,active,parent_id,created_at) VALUES(?,?,?,?,?,1,?,?)',
                 (username, hash_pw(pw), name, role, lang, parent_id, db.now()))
    db.log_event(request.auth_user['id'], 'user_created', {'username': username, 'role': role})
    return jsonify(ok=1, id=uid)


@bp.post('/api/admin/users/<int:uid>')
@require('admin')
def user_update(uid):
    u = request.auth_user
    if uid == u['id']:
        return jsonify(ok=0, error='self'), 400
    d = request.get_json(silent=True) or {}
    cur = db.q1('SELECT * FROM users WHERE id=?', (uid,))
    if not cur:
        return jsonify(ok=0, error='notfound'), 404
    name = (d.get('name') or cur['name']).strip() or cur['name']
    role = d.get('role') if d.get('role') in ('admin', 'teacher', 'parent', 'child') else cur['role']
    lang = d.get('lang') if d.get('lang') in ('en', 'ru', 'uz', 'tr', 'ar') else cur['lang']
    active = 1 if d.get('active', bool(cur['active'])) else 0
    parent_id = d.get('parent_id') or None
    db.run('UPDATE users SET name=?, role=?, lang=?, active=?, parent_id=? WHERE id=?',
           (name, role, lang, active, parent_id, uid))
    return jsonify(ok=1)


@bp.post('/api/admin/users/<int:uid>/reset')
@require('admin')
def user_reset(uid):
    d = request.get_json(silent=True) or {}
    pw = d.get('password') or '123456'
    if len(pw) < 4:
        return jsonify(ok=0, error='weak'), 400
    db.run('UPDATE users SET pass=? WHERE id=?', (hash_pw(pw), uid))
    return jsonify(ok=1)


@bp.delete('/api/admin/users/<int:uid>')
@require('admin')
def user_delete(uid):
    u = request.auth_user
    if uid == u['id']:
        return jsonify(ok=0, error='self'), 400
    db.run('UPDATE users SET parent_id=NULL WHERE parent_id=?', (uid,))
    db.run('DELETE FROM users WHERE id=?', (uid,))
    return jsonify(ok=1)


# ---------------- settings ----------------

@bp.get('/api/admin/settings')
@require('admin')
def settings_get():
    st = db.get_settings()
    return jsonify(ok=1, settings={k: st.get(k) for k in SETTINGS_EDITABLE},
                   refresh=json.loads(st.get('puzzle_refresh_status') or '{}'))


@bp.post('/api/admin/settings')
@require('admin')
def settings_set():
    d = request.get_json(silent=True) or {}
    for k in SETTINGS_EDITABLE:
        if k in d:
            db.set_setting(k, d[k])
    db.log_event(request.auth_user['id'], 'settings', {k: str(d[k])[:80] for k in SETTINGS_EDITABLE if k in d})
    return jsonify(ok=1, settings=db.get_settings())


# ---------------- puzzles ----------------

@bp.get('/api/admin/puzzles')
@require('admin')
def puzzles_list():
    rmin = request.args.get('rating_min', type=int)
    rmax = request.args.get('rating_max', type=int)
    rows = db.q('SELECT * FROM puzzles ORDER BY rating LIMIT 2000')
    if rmin:
        rows = [r for r in rows if r['rating'] >= rmin]
    if rmax:
        rows = [r for r in rows if r['rating'] <= rmax]
    return jsonify(ok=1, puzzles=rows[:800], total=len(db.q('SELECT id FROM puzzles')))


@bp.post('/api/admin/puzzles/refresh')
@require('admin')
def puzzles_refresh():
    d = request.get_json(silent=True) or {}
    refresh_async(limit=int(d.get('limit') or 60) or None)
    return jsonify(ok=1)


@bp.post('/api/admin/puzzles/<int:pid>/toggle')
@require('admin')
def puzzle_toggle(pid):
    db.run('UPDATE puzzles SET enabled=1-enabled WHERE id=?', (pid,))
    return jsonify(ok=1)


@bp.delete('/api/admin/puzzles/<int:pid>')
@require('admin')
def puzzle_delete(pid):
    db.run('DELETE FROM puzzles WHERE id=?', (pid,))
    return jsonify(ok=1)


# ---------------- global log ----------------

@bp.get('/api/admin/events')
@require('admin')
def events_log():
    user_id = request.args.get('user_id', type=int)
    etype = request.args.get('type')
    limit = min(int(request.args.get('limit') or 300), 1000)
    sql = 'SELECT e.*, u.name AS uname, u.username, u.role FROM events e LEFT JOIN users u ON u.id=e.user_id'
    cond, args = [], []
    if user_id:
        cond.append('e.user_id=?')
        args.append(user_id)
    if etype:
        cond.append('e.type=?')
        args.append(etype)
    if cond:
        sql += ' WHERE ' + ' AND '.join(cond)
    sql += ' ORDER BY e.id DESC LIMIT ?'
    args.append(limit)
    rows = db.q(sql, args)
    for r in rows:
        try:
            r['data'] = json.loads(r['data'] or '{}')
        except Exception:
            r['data'] = {}
    return jsonify(ok=1, events=rows, types=sorted({r['type'] for r in rows}) if rows else [])
