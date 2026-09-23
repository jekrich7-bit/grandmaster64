"""Puzzle game engine: validates user moves against a stored solution line."""
import chess


def board_from_fen(fen):
    try:
        b = chess.Board(fen)
    except (ValueError, chess.InvalidMoveError):
        return None
    if b is None or len(fen.split()) < 2:
        return None
    return b


def legal_moves(fen):
    b = board_from_fen(fen)
    if b is None:
        return []
    return [m.uci() for m in b.legal_moves]


def to_move(fen):
    b = board_from_fen(fen)
    if b is None:
        return None
    return 'w' if b.turn == chess.WHITE else 'b'


def side_name(fen):
    return 'w' if (board_from_fen(fen) or chess.Board()).turn == chess.WHITE else 'b'


def play(fen, uci, solution, ply):
    """Attempt user move `uci` at position `fen`.

    Returns (status, info):
      status: 'solved' | 'good' | 'wrong' | 'illegal'
      info: dict with new_fen, opp_uci, last, ...
    """
    b = board_from_fen(fen)
    if b is None:
        return 'illegal', {}
    try:
        move = chess.Move.from_uci(uci)
    except (ValueError, chess.InvalidMoveError):
        return 'illegal', {}
    if move not in b.legal_moves:
        return 'illegal', {}

    expected = solution[ply] if ply < len(solution) else None
    is_last = ply == len(solution) - 1
    b.push(move)
    matched = (uci == expected) or (is_last and b.is_checkmate())
    if not matched:
        return 'wrong', {'fen': fen}

    info = {'fen': b.fen(), 'my_uci': uci, 'opp_uci': None, 'last': [uci]}
    if is_last:
        info['mated'] = b.is_checkmate()
        return 'solved', info

    # auto-respond with the stored opponent reply
    opp = solution[ply + 1]
    try:
        b.push_uci(opp)
        info['opp_uci'] = opp
        info['last'].append(opp)
        info['fen'] = b.fen()
    except chess.InvalidMoveError:
        pass
    return 'good', info


def is_mate_now(fen):
    b = board_from_fen(fen)
    return bool(b and b.is_checkmate())
