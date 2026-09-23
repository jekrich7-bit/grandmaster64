"""Generate a verified offline puzzle dataset (mate-in-1 + mate-in-2).

Every position is validated with python-chess: the solution line is legal
and ends in checkmate. Run:  python3 tools/make_fallback.py  [count]
"""
import chess
import json
import os
import random
import sys

random.seed(20260923)

FILES = 'abcdefgh'


def sq(f, r):
    return chess.square_name(chess.square(f, r))


def corner_squares(corner):
    f, r = corner
    nbrs = set()
    for df in (-1, 0, 1):
        for dr in (-1, 0, 1):
            if df == 0 and dr == 0:
                continue
            nf, nr = f + df, r + dr
            if 0 <= nf <= 7 and 0 <= nr <= 7:
                nbrs.add((nf, nr))
    return nbrs


def build_base(mate_color, dead_color, dead_corner, cage=True):
    """Place dead king in corner + caging pieces + mating-side king far away."""
    board = chess.Board()
    board.clear()
    df, dr = dead_corner
    board.set_piece_at(chess.square(df, dr), chess.Piece(chess.KING, dead_color))
    # mating side king on the far opposite corner side
    mf, mr = (7 - df) % 8, (7 - dr) % 8
    board.set_piece_at(chess.square(mf, mr), chess.Piece(chess.KING, mate_color))
    if cage:
        nbrs = [n for n in corner_squares(dead_corner) if n != (df, dr)]
        random.shuffle(nbrs)
        how_many = random.choice([2, 3, 3])
        piece_types = [chess.PAWN, chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.KNIGHT, chess.PAWN]
        placed = 0
        for n in nbrs:
            if placed >= how_many:
                break
            pt = random.choice(piece_types)
            if pt == chess.PAWN:
                # pawns must sit so they attack the king square (pawns can't stand on the king's own square line)
                pass
            board.set_piece_at(chess.square(*n), chess.Piece(pt, mate_color))
            placed += 1
    # turn: the mating side moves
    board.turn = mate_color
    return board


def add_material(board, mate_color, dead_color, dead_corner):
    dead = {chess.square(*dead_corner)}
    for _ in range(random.randint(0, 3)):
        s = chess.square(random.randint(0, 7), random.randint(0, 7))
        if board.piece_at(s) or s in dead:
            continue
        color = random.choice([mate_color, dead_color])
        pt = random.choice([chess.PAWN, chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK])
        board.set_piece_at(s, chess.Piece(pt, color))


def valid_base(board, mate_color, dead_color, dead_corner):
    dk = board.king(chess.WHITE if dead_color == chess.WHITE else chess.BLACK)
    mk = board.king(chess.WHITE if mate_color == chess.WHITE else chess.BLACK)
    if dk is None or mk is None:
        return False
    if not board.is_valid():
        return False
    if board.is_check():
        return False
    # dead king must not be in check either
    board.turn = dead_color
    if board.is_check():
        return False
    board.turn = mate_color
    return True


def mates_in_1(board):
    out = []
    for m in board.legal_moves:
        board.push(m)
        if board.is_checkmate():
            out.append(m.uci())
        board.pop()
    return out


# Templates for corner a8, WHITE to move; mirrored for other corners.
# (cage squares, mating-piece source squares, piece kinds)
A8_TEMPLATES = [
    # rook/queen on the b-file sliding to b8# (king a8; cage a7+b8)
    {'cage': ['a7', 'b8'], 'src': ['b2', 'b3', 'b4', 'b5', 'b6'], 'kinds': [chess.ROOK, chess.QUEEN, chess.QUEEN], 'kind': 'rook'},
    # knight hop to b6# / c7#
    {'cage': ['a7', 'b8'], 'src': None, 'kinds': [chess.KNIGHT], 'kind': 'knight'},
    # pawn push b6b7#
    {'cage': ['a7', 'b8'], 'src': ['b6'], 'kinds': [chess.PAWN], 'kind': 'pawn'},
    # queen step to b7#
    {'cage': ['a7', 'b8'], 'src': ['b6'], 'kinds': [chess.QUEEN], 'kind': 'queen'},
]

KNIGHT_SOURCES = {
    'a8': ['a4', 'c4', 'd5', 'd7', 'a6', 'b5', 'e6', 'c8'],
    'h8': ['f4', 'e5', 'e7', 'h4', 'h5', 'd6', 'g5'],
    'a1': ['c1', 'd2', 'd4', 'a5', 'c5', 'a3', 'b4', 'e3', 'e1'],
    'h1': ['f1', 'e2', 'e4', 'f5', 'h5', 'h3', 'd1', 'd3', 'g4'],
}


def mirror_sq(name, flip_file=False, flip_rank=False):
    f = FILES.index(name[0])
    r = int(name[1]) - 1
    if flip_file:
        f = 7 - f
    if flip_rank:
        r = 7 - r
    return chess.square_name(chess.square(f, r))


def corner_templates(king_name):
    """Return (king_square_name, mating_color, templates) for a corner king."""
    f = FILES.index(king_name[0])
    r = int(king_name[1]) - 1
    flip_file = (f == 7)
    flip_rank = (r == 0)
    color = chess.WHITE if r == 7 else chess.BLACK
    tpls = []
    for t in A8_TEMPLATES:
        src = t['src']
        if t['kind'] == 'knight':
            src = list(KNIGHT_SOURCES[king_name])
        elif src is not None:
            src = [mirror_sq(s, flip_file, flip_rank) for s in src]
        tpls.append({
            'cage': [mirror_sq(s, flip_file, flip_rank) for s in t['cage']],
            'src': src,
            'kinds': list(t['kinds']),
        })
    return king_name, color, tpls


def gen_mate_in_1(max_positions=140):
    out = []
    seen = set()
    tries = 0
    while len(out) < max_positions and tries < 40000:
        tries += 1
        king_name = random.choice(['a8', 'h8', 'a1', 'h1'])
        king_name, color, tpls = corner_templates(king_name)
        dead_color = chess.BLACK if color == chess.WHITE else chess.WHITE
        tpl = random.choice(tpls)
        board = build_base(color, dead_color, (FILES.index(king_name[0]), int(king_name[1]) - 1), cage=False)
        # place cage pieces
        cage_kinds = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK] if color == chess.WHITE else [chess.KNIGHT, chess.BISHOP, chess.ROOK]
        ok = True
        for c in tpl['cage']:
            board.set_piece_at(chess.parse_square(c), chess.Piece(random.choice(cage_kinds), color))
        # place the designated mating piece
        src = random.choice(tpl['src'])
        kind = random.choice(tpl['kinds'])
        board.set_piece_at(chess.parse_square(src), chess.Piece(kind, color))
        if random.random() < 0.65:
            add_material(board, color, dead_color, (FILES.index(king_name[0]), int(king_name[1]) - 1))
        if not valid_base(board, color, dead_color, (FILES.index(king_name[0]), int(king_name[1]) - 1)):
            continue
        mates = mates_in_1(board)
        if not mates:
            continue
        fen = board.fen()
        if fen in seen:
            continue
        seen.add(fen)
        m = random.choice(mates)
        b2 = chess.Board(fen)
        b2.push_uci(m)
        if not b2.is_checkmate():
            continue
        out.append(mk_puzzle(fen, m, 'mate-in-1', 350 + random.randint(0, 450)))
    return out


def gen_mate_in_2(max_positions=120):
    out = []
    seen = set()
    tries = 0
    while len(out) < max_positions and tries < 60000:
        tries += 1
        mate_color = random.choice([chess.WHITE, chess.BLACK])
        dead_color = chess.BLACK if mate_color == chess.WHITE else chess.WHITE
        dead_corner = random.choice([(0, 7), (7, 7), (0, 0), (7, 0)])
        board = build_base(mate_color, dead_color, dead_corner)
        if random.random() < 0.6:
            add_material(board, mate_color, dead_color, dead_corner)
        if not valid_base(board, mate_color, dead_color, dead_corner):
            continue
        # search: m1 (prefer check) -> r (black reply) -> f (mate)
        best = None
        cands = list(board.legal_moves)
        random.shuffle(cands)
        # prefer checking moves first for natural puzzles
        flagged = []
        for mm in cands:
            board.push(mm)
            isch = board.is_check()
            board.pop()
            flagged.append((0 if isch else 1, mm))
        flagged.sort(key=lambda t: t[0])
        cands = [t[1] for t in flagged]
        for m1 in cands:
            b1 = board.copy()
            b1.push(m1)
            if b1.is_checkmate():
                continue
            replies = list(b1.legal_moves)
            random.shuffle(replies)
            for r in replies[:12]:
                b2 = b1.copy()
                b2.push(r)
                if b2.is_check():
                    continue  # we would be in check, skip
                fm = None
                for f in b2.legal_moves:
                    b2.push(f)
                    if b2.is_checkmate():
                        fm = f
                        break
                    b2.pop()
                if fm is not None:
                    best = (m1.uci(), r.uci(), fm.uci())
                    break
            if best:
                break
        if not best:
            continue
        fen = board.fen()
        if fen in seen:
            continue
        seen.add(fen)
        m1u, ru, fu = best
        b3 = chess.Board(fen)
        b3.push_uci(m1u)
        b3.push_uci(ru)
        b3.push_uci(fu)
        if not b3.is_checkmate():
            continue
        out.append(mk_puzzle(fen, '%s,%s,%s' % (m1u, ru, fu), 'mate-in-2', 700 + random.randint(0, 500)))
    return out


def mk_puzzle(fen, solution, theme, rating):
    theme_list = [theme]
    last = solution.split(',')[-1]
    if last[1] in '18':
        theme_list.append('back-rank')
    return {
        'fen': chess.Board(fen).fen(),
        'rating': int(rating),
        'themes': ','.join(theme_list),
        'solution': solution,
    }


def main():
    n1 = int(sys.argv[1]) if len(sys.argv) > 1 else 140
    n2 = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    p1 = gen_mate_in_1(n1)
    p2 = gen_mate_in_2(n2)
    allp = p1 + p2
    # final verification pass
    good = []
    for i, p in enumerate(allp):
        b = chess.Board(p['fen'])
        for u in p['solution'].split(','):
            b.push_uci(u)
        if not b.is_checkmate():
            continue
        p['uuid'] = 'fb-%04d' % (i + 1)
        good.append(p)
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fallback_puzzles.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(good, f, ensure_ascii=False)
    print('mate-in-1:', len(p1), 'mate-in-2:', len(p2), 'total verified:', len(good), '->', out)


if __name__ == '__main__':
    main()
