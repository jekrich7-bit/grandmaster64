import json
import os
import sqlite3
import threading
from datetime import datetime, timezone, timedelta

import app.config as cfg

_local = threading.local()


def get_conn():
    c = getattr(_local, 'conn', None)
    if c is None:
        c = sqlite3.connect(cfg.DB_PATH)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA foreign_keys=ON')
        _local.conn = c
    return c


def q(sql, args=()):
    cur = get_conn().execute(sql, args)
    return [dict(r) for r in cur.fetchall()]


def q1(sql, args=()):
    cur = get_conn().execute(sql, args)
    r = cur.fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    c = get_conn()
    cur = c.execute(sql, args)
    c.commit()
    return cur.lastrowid


def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def today():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  lang TEXT DEFAULT 'uz',
  active INTEGER DEFAULT 1,
  parent_id INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS puzzles(
  id INTEGER PRIMARY KEY,
  uuid TEXT UNIQUE,
  fen TEXT NOT NULL,
  rating INTEGER DEFAULT 1000,
  themes TEXT DEFAULT '',
  solution TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  source TEXT DEFAULT 'builtin',
  fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS videos(
  id INTEGER PRIMARY KEY,
  section_id INTEGER,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_by INTEGER,
  child_id INTEGER,
  due_days INTEGER DEFAULT 7,
  puzzle_ids TEXT DEFAULT '[]',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS task_items(
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  child_id INTEGER NOT NULL,
  solved_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_user ON events(user_id, ts);
CREATE INDEX IF NOT EXISTS ix_events_type ON events(type, ts);
"""

DEFAULT_SETTINGS = {
    'app_name': 'GrandMaster64',
    'tagline': "Bolalar uchun shaxmat maktabi",
    'default_lang': 'uz',
    'max_hints': '3',
    'rating_min': '400',
    'rating_max': '1600',
    'hint_penalty': '20',
    'mistake_penalty': '5',
    'allow_signup': '1',
    'lichess_limit': '60',
    'puzzle_refresh_status': json.dumps({'state': 'idle', 'msg': '', 'at': ''}),
}


def init():
    c = get_conn()
    c.executescript(SCHEMA)
    c.commit()
    # settings
    for k, v in DEFAULT_SETTINGS.items():
        c.execute('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', (k, v))
    # seed users (only if empty)
    if q1('SELECT id FROM users LIMIT 1') is None:
        from app.auth import hash_pw
        seed = [
            ('admin', 'admin123', 'Administrator', 'admin', None),
            ('teacher1', 'teacher123', 'Oqituvchi', 'teacher', None),
            ('parent1', 'parent123', "Ota-ona", 'parent', None),
            ('child1', 'child123', 'Bola 1', 'child', None),
            ('child2', 'child123', 'Bola 2', 'child', None),
        ]
        ids = {}
        for u, p, n, r, _ in seed:
            ids[u] = run('INSERT INTO users(username,pass,name,role,lang,active,parent_id,created_at) VALUES(?,?,?,?,?,1,?,?)',
                         (u, hash_pw(p), n, r, 'uz', None, now()))
        # link both children to parent1
        run('UPDATE users SET parent_id=? WHERE username IN ("child1","child2")', (ids['parent1'],))
        run('INSERT OR IGNORE INTO sections(title,description,sort) VALUES(?,?,?)', ("Boshlang'ich", "Asosiy shaxmat qoidalari va oson masalalar", 1))
        run('INSERT OR IGNORE INTO sections(title,description,sort) VALUES(?,?,?)', ("O'rta daraja", "Taktik mashqlar va g'alaba qoidalari", 2))
        run('INSERT OR IGNORE INTO sections(title,description,sort) VALUES(?,?,?)', ("Yuqori daraja", "Mushkul taktika va muammo yechish", 3))
        c.commit()
    # load fallback puzzles if pool empty
    if q1('SELECT id FROM puzzles LIMIT 1') is None:
        from app.lichess import load_fallback
        load_fallback()
    get_conn().commit()


def get_settings():
    rows = q('SELECT key,value FROM settings')
    d = {r['key']: r['value'] for r in rows}
    for k, v in DEFAULT_SETTINGS.items():
        d.setdefault(k, v)
    return d


def set_setting(key, value):
    run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))


def log_event(user_id, etype, data=None):
    run('INSERT INTO events(user_id,type,data,ts) VALUES(?,?,?,?)',
        (user_id, etype, json.dumps(data or {}), now()))


def all_events(limit=500):
    rows = q('SELECT e.*, u.name as uname, u.username, u.role FROM events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT ?', (limit,))
    for r in rows:
        try:
            r['data'] = json.loads(r['data'] or '{}')
        except Exception:
            r['data'] = {}
    return rows


def child_events(user_id, limit=200):
    rows = q('SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT ?', (user_id, limit))
    for r in rows:
        try:
            r['data'] = json.loads(r['data'] or '{}')
        except Exception:
            r['data'] = {}
    return rows
