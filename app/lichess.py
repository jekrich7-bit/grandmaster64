"""Lichess.org puzzle integration.

Primary flow (needs internet):
  1. GET https://lichess.org/api/pool/puzzles?daily=true  -> uuid/fen/rating/themes
  2. GET https://lichess.org/training/{uuid}              -> embedded puzzle JSON with solution moves

If the network is unavailable the app keeps working on the bundled,
python-chess-verified fallback dataset (fallback_puzzles.json).
"""
import json
import os
import re
import threading
import urllib.request

import app.db as db

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FALLBACK = os.path.join(BASE, 'fallback_puzzles.json')
UA = 'Mozilla/5.0 (GrandMaster64/1.0; +chess-training-app)'
LOCK = threading.Lock()


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json, text/html,*/*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def _status(**kw):
    st = db.get_settings().get('puzzle_refresh_status')
    try:
        cur = json.loads(st)
    except Exception:
        cur = {}
    cur.update(kw)
    cur['at'] = db.now()
    db.set_setting('puzzle_refresh_status', json.dumps(cur))


def load_fallback():
    if not os.path.exists(FALLBACK):
        return 0
    try:
        rows = json.load(open(FALLBACK, encoding='utf-8'))
    except Exception:
        return 0
    n = 0
    for r in rows:
        try:
            db.run(
                'INSERT OR IGNORE INTO puzzles(uuid,fen,rating,themes,solution,enabled,source,fetched_at) VALUES(?,?,?,?,?,1,?,?)',
                (r['uuid'], r['fen'], int(r.get('rating', 1000)), r.get('themes', ''),
                 r['solution'], 'builtin', db.now()))
            n += 1
        except Exception:
            continue
    db.get_conn().commit()
    return n


def _parse_training_html(html):
    """Extract fen/moves/rating/themes from a lichess training page."""
    m = re.search(r'var puzzle\s*=\s*(\{.*?\});', html, re.S)
    if m:
        try:
            p = json.loads(m.group(1))
            return p
        except Exception:
            pass
    # generic field scraping
    fen = re.search(r'"fen"\s*:\s*"([^"]+)"', html)
    moves = re.search(r'"moves"\s*:\s*"([^"]+)"', html)
    rating = re.search(r'"rating"\s*:\s*(\d+)', html)
    themes = re.search(r'"themes"\s*:\s*\[([^\]]*)\]', html)
    if fen and moves:
        t = ''
        if themes:
            t = ','.join(x.strip().strip('"') for x in themes.group(1).split(',') if x.strip())
        return {'fen': fen.group(1), 'moves': moves.group(1),
                'rating': int(rating.group(1)) if rating else 1000, 'themes': t}
    return None


def refresh(limit=None):
    """Fetch fresh puzzles from Lichess. Runs in a thread; safe to call concurrently (locked)."""
    if not LOCK.acquire(blocking=False):
        return {'ok': 0, 'error': 'busy'}
    try:
        _status(state='running', msg='', ok=0, added=0)
        st = db.get_settings()
        if limit is None:
            limit = int(st.get('lichess_limit', '60'))
        try:
            pool_raw = _get('https://lichess.org/api/pool/puzzles?daily=true&per_page=%d' % max(5, min(int(limit), 200)))
            pool = json.loads(pool_raw).get('puzzles', [])
        except Exception as e:
            _status(state='error', msg='Network: %s' % str(e)[:120])
            return {'ok': 0, 'error': 'network'}
        added = 0
        for i, pz in enumerate(pool):
            uuid = pz.get('uuid')
            fen = pz.get('fen')
            if not uuid or not fen:
                continue
            try:
                html = _get('https://lichess.org/training/%s' % uuid, timeout=10)
                parsed = _parse_training_html(html)
                if not parsed or not parsed.get('moves'):
                    continue
                solution = parsed['moves'].strip().replace(' ', ',')
                themes = parsed.get('themes') or ''
                if isinstance(themes, list):
                    themes = ','.join(themes)
                rating = int(parsed.get('rating') or pz.get('ratings', {}).get('chesscom', {}).get('value', 1000) or 1000)
                db.run(
                    'INSERT INTO puzzles(uuid,fen,rating,themes,solution,enabled,source,fetched_at) VALUES(?,?,?,?,?,1,?,?) '
                    'ON CONFLICT(uuid) DO UPDATE SET fen=excluded.fen, rating=excluded.rating, themes=excluded.themes, '
                    'solution=excluded.solution, source=excluded.source, fetched_at=excluded.fetched_at',
                    (uuid, fen, rating, themes, solution, 'lichess', db.now()))
                added += 1
                if i % 10 == 0:
                    _status(state='running', msg='%d/%d' % (i, len(pool)))
            except Exception:
                continue
        db.get_conn().commit()
        _status(state='done', msg='', ok=1, added=added)
        return {'ok': 1, 'added': added}
    finally:
        LOCK.release()


def refresh_async(limit=None):
    t = threading.Thread(target=refresh, args=(limit,), daemon=True)
    t.start()
    return t


def warmup_async():
    """Startup: ensure a pool exists, then try a Lichess refresh in background."""
    n = db.q1('SELECT COUNT(*) AS c FROM puzzles WHERE enabled=1')['c']
    if n == 0:
        load_fallback()
    st = db.get_settings()
    if st.get('lichess_limit', '60') != '0':
        threading.Thread(target=refresh, kwargs={'limit': int(st.get('lichess_limit', '60'))}, daemon=True).start()
