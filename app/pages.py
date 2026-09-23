from flask import Blueprint, render_template, session, send_from_directory, abort

import app.config as cfg
import app.db as db
from app.auth import current_user

bp = Blueprint('pages', __name__)


def _home_for(u):
    return {'admin': '/admin', 'teacher': '/teacher', 'parent': '/parent', 'child': '/play'}.get(u['role'], '/login')


@bp.get('/')
def index():
    u = current_user()
    if not u:
        return render_template('login.html')
    return _redirect(_home_for(u))


def _redirect(to):
    from flask import redirect
    return redirect(to)


@bp.get('/login')
def login_page():
    return render_template('login.html')


@bp.get('/play')
def play_page():
    u = current_user()
    if not u:
        return render_template('login.html')
    if u['role'] != 'child':
        return _redirect(_home_for(u))
    return render_template('child.html', user=u)


@bp.get('/teacher')
def teacher_page():
    u = current_user()
    if not u:
        return render_template('login.html')
    if u['role'] not in ('teacher', 'admin'):
        return _redirect(_home_for(u))
    return render_template('teacher.html', user=u)


@bp.get('/parent')
def parent_page():
    u = current_user()
    if not u:
        return render_template('login.html')
    if u['role'] not in ('parent', 'admin'):
        return _redirect(_home_for(u))
    return render_template('parent.html', user=u)


@bp.get('/admin')
def admin_page():
    u = current_user()
    if not u:
        return render_template('login.html')
    if u['role'] != 'admin':
        return _redirect(_home_for(u))
    return render_template('admin.html', user=u)


@bp.get('/uploads/<path:name>')
def uploads(name):
    return send_from_directory(cfg.UPLOADS, name, conditional=True)
