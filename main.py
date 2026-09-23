#!/usr/bin/env python3
"""GrandMaster64 — bolalar uchun shaxmat mashq platformasi.

Ishga tushirish:  python main.py
Barcha xizmatlar (frontend, API, ma'lumotlar bazasi, Lichess integratsiyasi)
shu bitta fayl orqali ishlaydi.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app
from app.lichess import warmup_async
import app.config as cfg


def main():
    app = create_app()
    warmup_async()  # fallback masalalar + Lichess'dan fon rejimida yangilash
    print('=' * 62)
    print('  GrandMaster64 ishga tushdi:  http://%s:%d' % (cfg.HOST, cfg.PORT))
    print('  Admin:      admin / admin123')
    print('  Oqituvchi:  teacher1 / teacher123')
    print('  Ota-ona:    parent1 / parent123')
    print('  Oquvchi:    child1 / child123')
    print('=' * 62)
    app.run(host=cfg.HOST, port=cfg.PORT, threaded=True, debug=False)


if __name__ == '__main__':
    main()
