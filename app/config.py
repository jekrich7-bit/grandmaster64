import os
import secrets

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, 'data')
DB_PATH = os.path.join(DATA, 'app.db')
UPLOADS = os.path.join(BASE, 'uploads', 'videos')
os.makedirs(DATA, exist_ok=True)
os.makedirs(UPLOADS, exist_ok=True)


def _secret():
    p = os.path.join(DATA, 'secret')
    try:
        if os.path.exists(p):
            return open(p).read().strip()
    except OSError:
        pass
    s = secrets.token_hex(32)
    try:
        with open(p, 'w') as f:
            f.write(s)
    except OSError:
        pass
    return s


SECRET = _secret()
HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '8000'))
