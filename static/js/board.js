/* GrandMaster64 — chess board (click-to-move, RTL aware) */
const GLYPHS = {k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'};
const FILES = 'abcdefgh';

class BoardView {
  constructor(el, onMove){
    this.el = el;
    this.onMove = onMove;
    this.fen = null;
    this.legal = [];
    this.side = 'w';
    this.selected = null;
    this.lastMoves = [];
    this.checkSq = null;
    this.el.classList.add('board');
    this.el.addEventListener('click', e => this.onClick(e));
    const shell = el.parentElement;
    this.arrowEl = document.createElement('div');
    this.arrowEl.className = 'arrow-ov';
    this.arrowEl.style.display = 'none';
    shell.appendChild(this.arrowEl);
  }

  isRTL(){ return document.documentElement.dir === 'rtl'; }
  filesOrder(){ return this.isRTL() ? [...FILES].reverse() : [...FILES]; }

  _pieceAt(rowStr, fIdx){
    let ci = 0, col = 0;
    while(ci < rowStr.length){
      const ch = rowStr[ci];
      if(/[1-8]/.test(ch)){ col += parseInt(ch, 10); ci++; }
      else {
        if(col === fIdx) return {type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b'};
        col++; ci++;
      }
    }
    return null;
  }

  render(fen, legal, opts){
    opts = opts || {};
    this.fen = fen;
    this.legal = legal || [];
    this.side = fen.split(' ')[1] || 'w';
    this.selected = null;
    this.lastMoves = opts.lastMoves || [];
    this.checkSq = opts.checkSq || null;
    const flip = opts.flip !== undefined ? opts.flip : (opts.autoFlip && this.side === 'b');
    this.flip = !!flip;
    const files = this.filesOrder();
    const rows = fen.split(' ')[0].split('/');
    let html = '';
    for(let dr = 0; dr < 8; dr++){
      const rank = flip ? dr + 1 : 8 - dr;
      const r = rank - 1;
      const rowStr = rows[8 - rank];
      for(const f of files){
        const fIdx = FILES.indexOf(f);
        const sqName = f + rank;
        const piece = this._pieceAt(rowStr, fIdx);
        const cls = [(fIdx + r) % 2 === 0 ? 'sq l' : 'sq d'];
        let inner = '';
        if(rank === 8) inner += '<span class="coord cf">' + f + '</span>';
        if(f === files[0]) inner += '<span class="coord cr">' + rank + '</span>';
        if(piece) inner += '<span class="piece ' + piece.color + '">' + GLYPHS[piece.type] + '</span>';
        if(this.lastMoves.includes(sqName)) cls.push('last');
        if(this.checkSq === sqName) cls.push('check');
        if(this.selected === sqName) cls.push('sel');
        if(this.selected && this.legal.some(u => u.slice(0, 2) === this.selected && u.slice(2, 4) === sqName)){
          inner += piece ? '<span class="dot-cap"></span>' : '<span class="dot-hint"></span>';
        }
        html += '<div class="' + cls.join(' ') + '" data-sq="' + sqName + '">' + inner + '</div>';
      }
    }
    this.el.innerHTML = html;
    this.clearArrow();
  }

  _targetOf(from, to){
    return this.legal.some(u => u.slice(0, 2) === from && u.slice(2, 4) === to);
  }

  onClick(e){
    const sqEl = e.target.closest('.sq');
    if(!sqEl || !this.fen) return;
    const sq = sqEl.dataset.sq;
    if(this.selected){
      if(sq === this.selected){ this._setSelected(null); return; }
      const from = this.selected;
      this._setSelected(null);
      if(this._targetOf(from, sq)){
        this.onMove && this.onMove(from + sq, from, sq);
      }
      return;
    }
    const r = parseInt(sq[1]) - 1;
    const rowStr = this.fen.split(' ')[0].split('/')[7 - r];
    const piece = this._pieceAt(rowStr, FILES.indexOf(sq[0]));
    if(piece && piece.color === this.side) this._setSelected(sq);
  }

  _setSelected(sq){
    this.selected = sq;
    this.el.querySelectorAll('.dot-hint,.dot-cap').forEach(d => d.remove());
    this.el.querySelectorAll('.sq').forEach(s => s.classList.toggle('sel', s.dataset.sq === sq));
    if(!sq) return;
    this.el.querySelectorAll('.sq').forEach(s => {
      const name = s.dataset.sq;
      if(name !== sq && this._targetOf(sq, name)){
        const d = document.createElement('span');
        d.className = s.querySelector('.piece') ? 'dot-cap' : 'dot-hint';
        s.appendChild(d);
      }
    });
  }

  setLast(ucs, checkSq){
    this.lastMoves = (ucs || []).map(u => u.slice(2, 4));
    this.checkSq = checkSq || null;
    this.el.querySelectorAll('.sq').forEach(s => {
      s.classList.toggle('last', this.lastMoves.includes(s.dataset.sq));
      s.classList.toggle('check', this.checkSq === s.dataset.sq);
    });
  }

  showArrow(from, to, color){
    if(!this.arrowEl || !this.fen) return;
    const b = this.el.getBoundingClientRect();
    const size = b.width / 8;
    const files = this.filesOrder();
    const pos = (sqName) => {
      const col = files.indexOf(sqName[0]);
      const row = this.flip ? (parseInt(sqName[1]) - 1) : (7 - (parseInt(sqName[1]) - 1));
      return {x: col * size + size / 2, y: row * size + size / 2};
    };
    const a = pos(from), c = pos(to);
    const ang = Math.atan2(c.y - a.y, c.x - a.x);
    const hl = size * 0.5;
    const p1 = {x: c.x - hl * Math.cos(ang - 0.45), y: c.y - hl * Math.sin(ang - 0.45)};
    const p2 = {x: c.x - hl * Math.cos(ang + 0.45), y: c.y - hl * Math.sin(ang + 0.45)};
    this.arrowEl.innerHTML = '<svg width="' + b.width + '" height="' + b.height + '">' +
      '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + c.x + '" y2="' + c.y + '" stroke="' + (color || '#1E7A45') + '" stroke-width="' + size * 0.17 + '" stroke-linecap="round" opacity="0.85"/>' +
      '<polygon points="' + c.x + ',' + c.y + ' ' + p1.x + ',' + p1.y + ' ' + p2.x + ',' + p2.y + '" fill="' + (color || '#1E7A45') + '" opacity="0.9"/>' +
      '</svg>';
    this.arrowEl.style.display = 'block';
  }

  clearArrow(){
    if(this.arrowEl) this.arrowEl.style.display = 'none';
  }
}
