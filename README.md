# GrandMaster64 ♞

Bolalar uchun shaxmat mashq platformasi — **SOFT UI** dizayn (to'q ko'k + och ko'k), chess.com uslubidagi o'yin maydoni, lichess.org masalalari integratsiyasi va to'liq nazorat tizimi (ota-ona / o'qituvchi / admin).

## Ishga tushirish

```bash
pip install -r requirements.txt
python main.py
```

Brauzerda oching: **http://localhost:8000**

Barcha narsa (frontend, API, SQLite bazasi, Lichess integratsiyasi, video yuklash) `main.py` bilan bitta buyruq orqali ishga tushadi.

## Demo hisoblar

| Rol          | Login      | Parol        |
|--------------|------------|--------------|
| Admin        | `admin`    | `admin123`   |
| O'qituvchi   | `teacher1` | `teacher123` |
| Ota-ona      | `parent1`  | `parent123`  |
| O'quvchi     | `child1`   | `child123`   |

## Imkoniyatlar

- **Mashq maydoni** — shaxmat masalalari (mate in 1/2), hint tizimi (har bir hint hisoblanadi va jurnalga tushadi), ball tizimi (maslahat/xato uchun jarima), vaqt taymeri.
- **Lichess integratsiyasi** — admin panelda "Lichess'dan yangilash" tugmasi (yoki avtomatik ishga tushganda) mashinalarni lichess.org dan oladi. Internet bo'lmasa ichki 260 ta tekshirilgan masala bazasi ishlaydi.
- **Vazifalar** — o'qituvchi/admin bolaga masala to'plami (qiyinlik bo'yicha) va muddat belgilab bera oladi; bola o'z vazifalarini bajara boradi, har bir yechim nazorat qilinadi.
- **Videolar** — YouTube havolasi yoki o'z darslik videongizni fayl qilib yuklash (MP4/WebM/MOV...), bo'limlar (kurslar) tizimi.
- **Ota-ona bo'limi** — o'z bolasining statistikasi: nechta masala yechgan, aniqlik, **necha bor hint ishlatgan**, harakati jurnali, vazifalar holati.
- **O'qituvchi bo'limi** — barcha o'quvchilar, har birining to'liq statistikasi va activity log'i, vazifa berish, video/bo'lim boshqaruvi.
- **Admin panel** — foydalanuvchilar (yaratish/tahrirlash/parol/rol/ota-onaga bog'lash), masalalar bazasi, sozlamalar (platforma nomi, standart til, hint limiti, reyting oralig'i, jarimalar, ro'yxatdan o'tish), barcha jurnallar.
- **5 til** — O'zbek, English, Русский, Türkçe, العربية (arab tili uchun RTL interfeys).

## Tuzilma

```
main.py                  # bitta kirish nuqtasi
app/                     # Flask backend (db, auth, api, lichess, chess engine)
templates/               # sahifalar
static/css/soft.css      # SOFT UI dizayn tizimi
static/js/               # frontend (board, i18n, rollar bo'yicha panellar)
tools/make_fallback.py   # ichki masala bazasini qayta generatsiya qilish
fallback_puzzles.json    # tekshirilgan (python-chess) oflayn masalalar
data/ uploads/           # runtime: SQLite bazasi va yuklangan videolar (avtomatik yaratiladi)
```
