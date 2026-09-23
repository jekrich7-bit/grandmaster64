import json
import os
import re
import uuid as uuidlib

from flask import Blueprint, request, jsonify

import app.config as cfg
import app.db as db
from app.auth import require
from app.api_child import build_stats

bp = Blueprint('teacher', __name__)

DIFF_BANDS = {'easy': (400, 850), 'medium': (800, 1250), 'hard': (1150, 1800)}
ALLOWED_EXT = ('.mp4', '.webm', '.m4v', '.ogg', '.mov', '.mkv')


def parse_youtube(url):
    url = (url or '').strip()
    m = re.search(r'(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{6,15})', url)
    if m:
        return m.group(1)
    if re.fullmatch(r'[A-Za-z0-9_-]{6,15}', url):
        return url
    return None


# ---------------- students overview ----------------

@bp.get('/api/students')
@require('teacher', 'admin')
def students():
    rows = db.q('SELECT * FROM users WHERE role="child" ORDER BY id')
    out = []
    for r in rows:
        s = build_stats(r['id'])
        par = db.q1('SELECT id,name FROM users WHERE id=?', (r['parent_id'],)) if r['parent_id'] else None
        out.append({
            'id': r['id'], 'name': r['name'], 'username': r['username'], 'active': r['active'],
            'lang': r['lang'], 'parent': par['name'] if par else None,
            'solved': s['total_solved'], 'hints': s['hints'], 'accuracy': s['accuracy'],
            'solved_today': s['solved_today'], 'streak': s['streak'],
            'tasks_done': s['tasks_done'], 'videos_done': s['videos_done'],
        })
    return jsonify(ok=1, students=out)


@bp.get('/api/students/<int:uid>')
@require('teacher', 'admin', 'parent')
def student_detail(uid):
    u = request.auth_user
    if u['role'] == 'parent':
        c = db.q1('SELECT id FROM users WHERE id=? AND parent_id=? AND role="child"', (uid, u['id']))
        if not c:
            return jsonify(ok=0, error='forbidden'), 403
    else:
        c = db.q1('SELECT id FROM users WHERE id=? AND role="child"', (uid,))
        if not c:
            return jsonify(ok=0, error='notfound'), 404
    items = db.q('SELECT ti.*, t.title AS task_title, t.due_days FROM task_items ti JOIN tasks t ON t.id=ti.task_id WHERE ti.child_id=? ORDER BY t.id DESC', (uid,))
    for it in items:
        t = db.q1('SELECT * FROM tasks WHERE id=?', (it['task_id'],))
        it['total'] = len(json.loads(t['puzzle_ids'] or '[]')) if t else 0
    return jsonify(ok=1, stats=build_stats(uid), child=db.q1('SELECT id,name,username,lang,role,parent_id FROM users WHERE id=?', (uid,)),
                   task_items=items, events=db.child_events(uid, 120))


# ---------------- tasks ----------------

@bp.post('/api/tasks')
@require('teacher', 'admin')
def create_task():
    d = request.get_json(silent=True) or {}
    title = (d.get('title') or '').strip()
    if not title:
        return jsonify(ok=0, error='title'), 400
    diff = d.get('difficulty') if d.get('difficulty') in DIFF_BANDS else 'easy'
    count = max(1, min(int(d.get('count') or 5), 50))
    due = max(1, min(int(d.get('due_days') or 7), 60))
    rmin, rmax = DIFF_BANDS[diff]
    ps = db.q('SELECT * FROM puzzles WHERE enabled=1 AND rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT ?', (rmin, rmax, count * 3))
    ps = ps[:count]
    if not ps:
        ps = db.q('SELECT * FROM puzzles WHERE enabled=1 ORDER BY RANDOM() LIMIT ?', (count,))
    if not ps:
        return jsonify(ok=0, error='no_puzzles'), 400
    child_id = d.get('child_id') or None
    task_id = db.run('INSERT INTO tasks(title,description,created_by,child_id,due_days,puzzle_ids,created_at) VALUES(?,?,?,?,?,?,?)',
                     (title, (d.get('description') or '').strip(), request.auth_user['id'], child_id, due,
                      json.dumps([p['id'] for p in ps]), db.now()))
    if child_id:
        targets = db.q('SELECT id FROM users WHERE id=? AND role="child"', (child_id,))
    else:
        targets = db.q('SELECT id FROM users WHERE role="child" AND active=1')
    for c in targets:
        db.run('INSERT INTO task_items(task_id,child_id,solved_count,status,done_at) VALUES(?,?,0,"pending",NULL)', (task_id, c['id']))
    db.log_event(request.auth_user['id'], 'task_created', {'task_id': task_id, 'title': title, 'count': len(ps)})
    return jsonify(ok=1, task_id=task_id, puzzles=len(ps))


@bp.get('/api/tasks')
@require('teacher', 'admin')
def list_tasks():
    tasks = db.q('SELECT * FROM tasks ORDER BY id DESC')
    out = []
    for t in tasks:
        ids = json.loads(t['puzzle_ids'] or '[]')
        items = db.q('SELECT ti.*, u.name FROM task_items ti LEFT JOIN users u ON u.id=ti.child_id WHERE ti.task_id=?', (t['id'],))
        creator = db.q1('SELECT name FROM users WHERE id=?', (t['created_by'],))
        out.append({
            'id': t['id'], 'title': t['title'], 'description': t['description'],
            'child_id': t['child_id'], 'child_name': (db.q1('SELECT name FROM users WHERE id=?', (t['child_id'],)) or {}).get('name') if t['child_id'] else None,
            'due_days': t['due_days'], 'created_at': t['created_at'],
            'total': len(ids), 'creator': creator['name'] if creator else '',
            'items': [{'child_id': i['child_id'], 'name': i['name'] or '?', 'solved': i['solved_count'], 'status': i['status']} for i in items],
        })
    return jsonify(ok=1, tasks=out)


@bp.delete('/api/tasks/<int:tid>')
@require('teacher', 'admin')
def delete_task(tid):
    db.run('DELETE FROM task_items WHERE task_id=?', (tid,))
    db.run('DELETE FROM tasks WHERE id=?', (tid,))
    return jsonify(ok=1)


@bp.post('/api/link')
@require('teacher', 'admin')
def link_parent():
    d = request.get_json(silent=True) or {}
    child_id = d.get('child_id')
    parent_id = d.get('parent_id') or None
    if not db.q1('SELECT id FROM users WHERE id=? AND role="child"', (child_id,)):
        return jsonify(ok=0, error='notfound'), 404
    if parent_id and not db.q1('SELECT id FROM users WHERE id=? AND role="parent"', (parent_id,)):
        return jsonify(ok=0, error='notfound'), 404
    db.run('UPDATE users SET parent_id=? WHERE id=?', (parent_id, child_id))
    return jsonify(ok=1)


# ---------------- videos & sections ----------------

@bp.get('/api/content')
@require('teacher', 'admin')
def content():
    secs = db.q('SELECT * FROM sections ORDER BY sort, id')
    vids = db.q('SELECT * FROM videos ORDER BY id DESC')
    for v in vids:
        v['path'] = ('https://youtube.com/embed/%s' % v['ref']) if v['kind'] == 'youtube' else ('/uploads/%s' % v['ref'])
    return jsonify(ok=1, sections=secs, videos=vids)


@bp.post('/api/sections')
@require('teacher', 'admin')
def add_section():
    d = request.get_json(silent=True) or {}
    title = (d.get('title') or '').strip()
    if not title:
        return jsonify(ok=0, error='title'), 400
    sid = db.run('INSERT INTO sections(title,description,sort) VALUES(?,?,?)',
                 (title, (d.get('description') or '').strip(), int(d.get('sort') or 99)))
    return jsonify(ok=1, id=sid)


@bp.delete('/api/sections/<int:sid>')
@require('teacher', 'admin')
def del_section(sid):
    db.run('UPDATE videos SET section_id=NULL WHERE section_id=?', (sid,))
    db.run('DELETE FROM sections WHERE id=?', (sid,))
    return jsonify(ok=1)


@bp.post('/api/videos')
@require('teacher', 'admin')
def add_video():
    d = request.get_json(silent=True) or {}
    kind = d.get('kind')
    if not kind:
        kind = 'file' if request.files.get('file') else 'youtube'
    title = (d.get('title') or '').strip() or (request.form.get('title') or '').strip() or 'Video'
    section_id = d.get('section_id') or request.form.get('section_id') or None
    if section_id in ('', None):
        section_id = None
    else:
        try:
            section_id = int(section_id)
        except ValueError:
            section_id = None
    if kind == 'youtube':
        yt = parse_youtube(d.get('url') or '')
        if not yt:
            return jsonify(ok=0, error='bad_url'), 400
        vid = db.run('INSERT INTO videos(section_id,kind,ref,title,description,created_at) VALUES(?,?,?,?,?,?)',
                     (section_id, 'youtube', yt, title, (d.get('description') or '').strip(), db.now()))
    elif kind == 'file':
        f = request.files.get('file')
        if not f or not f.filename:
            return jsonify(ok=0, error='no_file'), 400
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            return jsonify(ok=0, error='bad_ext'), 400
        name = uuidlib.uuid4().hex + ext
        f.save(os.path.join(cfg.UPLOADS, name))
        vid = db.run('INSERT INTO videos(section_id,kind,ref,title,description,created_at) VALUES(?,?,?,?,?,?)',
                     (section_id, 'file', name, title, (d.get('description') or '').strip(), db.now()))
    else:
        return jsonify(ok=0, error='bad'), 400
    db.log_event(request.auth_user['id'], 'video_added', {'video': vid, 'title': title})
    return jsonify(ok=1, id=vid)


@bp.delete('/api/videos/<int:vid>')
@require('teacher', 'admin')
def del_video(vid):
    v = db.q1('SELECT * FROM videos WHERE id=?', (vid,))
    if v and v['kind'] == 'file':
        try:
            os.remove(os.path.join(cfg.UPLOADS, v['ref']))
        except OSError:
            pass
    db.run('DELETE FROM videos WHERE id=?', (vid,))
    return jsonify(ok=1)
