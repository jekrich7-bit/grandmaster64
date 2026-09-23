import hashlib
import secrets
import functools

from flask import session, jsonify, request

import app.db as db


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.scrypt(pw.encode('utf-8'), salt=salt.encode(), n=2 ** 14, r=8, p=1, dklen=32).hex()
    return f'{salt}${h}'


def check_pw(pw, stored):
    try:
        salt, h = stored.split('$', 1)
    except ValueError:
        return False
    c = hashlib.scrypt(pw.encode('utf-8'), salt=salt.encode(), n=2 ** 14, r=8, p=1, dklen=32).hex()
    return secrets.compare_digest(c, h)


def current_user():
    uid = session.get('uid')
    if not uid:
        return None
    u = db.q1('SELECT * FROM users WHERE id=? AND active=1', (uid,))
    return u


def require(*roles):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            u = current_user()
            if u is None:
                return jsonify(ok=0, error='auth'), 401
            if roles and u['role'] not in roles:
                return jsonify(ok=0, error='forbidden'), 403
            request.auth_user = u
            return fn(*a, **kw)
        return wrapper
    return deco


def api_login():
    d = request.get_json(silent=True) or {}
    username = (d.get('username') or '').strip()
    pw = d.get('password') or ''
    u = db.q1('SELECT * FROM users WHERE username=?', (username,))
    if not u or not check_pw(pw, u['pass']):
        return jsonify(ok=0, error='wrong'), 400
    if not u['active']:
        return jsonify(ok=0, error='disabled'), 403
    session['uid'] = u['id']
    db.log_event(u['id'], 'login', {})
    return jsonify(ok=1, user=_pub(u))


def api_register():
    d = request.get_json(silent=True) or {}
    st = db.get_settings()
    if st.get('allow_signup') != '1':
        return jsonify(ok=0, error='closed'), 403
    username = (d.get('username') or '').strip()
    name = (d.get('name') or '').strip() or username
    pw = d.get('password') or ''
    role = d.get('role') if d.get('role') in ('child', 'parent') else 'child'
    lang = d.get('lang') if d.get('lang') in ('en', 'ru', 'uz', 'tr', 'ar') else st.get('default_lang', 'uz')
    if len(username) < 3 or len(pw) < 4:
        return jsonify(ok=0, error='weak'), 400
    if db.q1('SELECT id FROM users WHERE username=?', (username,)) is not None:
        return jsonify(ok=0, error='taken'), 400
    uid = db.run('INSERT INTO users(username,pass,name,role,lang,active,parent_id,created_at) VALUES(?,?,?,?,?,1,?,?)',
                 (username, hash_pw(pw), name, role, lang, None, db.now()))
    db.log_event(uid, 'login', {})
    session['uid'] = uid
    return jsonify(ok=1, user=_pub(db.q1('SELECT * FROM users WHERE id=?', (uid,))))


def api_logout():
    session.clear()
    return jsonify(ok=1)


def api_set_lang():
    u = current_user()
    if not u:
        return jsonify(ok=0, error='auth'), 401
    d = request.get_json(silent=True) or {}
    lang = d.get('lang')
    if lang in ('en', 'ru', 'uz', 'tr', 'ar'):
        db.run('UPDATE users SET lang=? WHERE id=?', (lang, u['id']))
    return jsonify(ok=1)


def api_me():
    u = current_user()
    if not u:
        return jsonify(ok=0, error='auth'), 401
    st = db.get_settings()
    kids = []
    if u['role'] in ('admin', 'teacher'):
        kids = db.q('SELECT id,name,username,lang,active,role FROM users WHERE role="child" AND active=1 ORDER BY id')
    elif u['role'] == 'parent':
        kids = db.q('SELECT id,name,username,lang,active,role FROM users WHERE role="child" AND active=1 AND (parent_id=? OR parent_id IS NULL) ORDER BY id', (u['id'],))
    return jsonify(ok=1, user=_pub(u), settings=st, children=kids)


def _pub(u):
    return {
        'id': u['id'], 'username': u['username'], 'name': u['name'],
        'role': u['role'], 'lang': u['lang'], 'parent_id': u['parent_id'],
    }
