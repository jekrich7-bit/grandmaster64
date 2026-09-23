/* GrandMaster64 — shared helpers */
const LANGS = window.LANGS || [];
const RTL_LANGS = window.RTL_LANGS || [];
let APP_ME = null;
let APP_SETTINGS = {};

function t(key){
  const lang = (window.LANG || 'uz');
  const dict = (window.I18N || {})[lang] || {};
  return dict[key] !== undefined ? dict[key] : ((window.I18N || {}).en || {})[key] || key;
}

function applyI18n(root){
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

function currentLang(){
  return (APP_ME && APP_ME.user) ? APP_ME.user.lang : (localStorage.getItem('gm_lang') || 'uz');
}

function setLang(code, persist){
  if(!(window.I18N || {})[code]) code = 'uz';
  window.LANG = code;
  document.documentElement.lang = code;
  document.documentElement.dir = RTL_LANGS.includes(code) ? 'rtl' : 'ltr';
  if(persist){
    localStorage.setItem('gm_lang', code);
    if(APP_ME && APP_ME.user) api('/api/auth/lang', {method:'POST', body: JSON.stringify({lang: code})}).catch(()=>{});
  }
  applyI18n();
  document.dispatchEvent(new CustomEvent('langchange', {detail: code}));
}

async function api(path, opts){
  opts = opts || {};
  if(opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)){
    opts.body = JSON.stringify(opts.body);
    opts.headers = Object.assign({'Content-Type': 'application/json'}, opts.headers);
  }
  const r = await fetch(path, Object.assign({credentials: 'same-origin'}, opts));
  let j = null;
  try { j = await r.json(); } catch(e) { j = {ok: 0, error: 'bad_json'}; }
  if(!r.ok || j.ok === 0){
    const e = new Error(j.error || r.status);
    e.j = j;
    throw e;
  }
  return j;
}

function toast(msg, kind){
  let box = document.getElementById('toasts');
  if(!box){
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function openModal(html, wide){
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.id = 'modalOv';
  ov.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '" id="modalBox">' + html + '</div>';
  ov.addEventListener('click', e => { if(e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  return ov;
}
function closeModal(){
  const ov = document.getElementById('modalOv');
  if(ov) ov.remove();
}
function confirmDialog(msg, onYes){
  const ov = openModal(
    '<h3>' + t('confirm') + '?</h3><p class="muted mb">' + msg + '</p>' +
    '<div class="btn-row" style="justify-content:flex-end"><button class="btn btn-sm" id="cNo">' + t('cancel') + '</button>' +
    '<button class="btn btn-sm b-danger" id="cYes">' + t('delete') + '</button></div>');
  ov.querySelector('#cNo').onclick = closeModal;
  ov.querySelector('#cYes').onclick = () => { closeModal(); onYes(); };
}

function fmtSecs(s){
  s = Math.max(0, s | 0);
  const m = Math.floor(s / 60), ss = s % 60;
  if(m) return m + "'" + (ss < 10 ? '0' : '') + ss + '"';
  return ss + ' ' + t('seconds');
}

function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if(isNaN(d)) return ts;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* event log rendering (shared by child/teacher/parent/admin) */
const EVENT_ICONS = {
  login: '🔑', puzzle_start: '♟', puzzle_solved: '🏆', puzzle_mistake: '⚠️',
  hint_used: '💡', puzzle_giveup: '🏳', task_done: '✅', video_start: '▶️',
  video_complete: '🎬', user_created: '👤', settings: '⚙️', video_added: '📹',
  task_created: '📋', puzzle_refresh: '🔄'
};
function eventLine(e){
  const d = e.data || {};
  const typeKey = 'ev_' + e.type;
  let extra = '';
  if(e.type === 'puzzle_solved') extra = ' · ' + (d.score || 0) + ' ' + t('points') + ' · ' + fmtSecs(d.secs || 0);
  if(e.type === 'hint_used') extra = ' #' + (d.n || 1);
  if(e.type === 'puzzle_mistake') extra = ' (' + esc(d.uci || '') + ')';
  if(e.type === 'video_start' || e.type === 'video_complete' || e.type === 'video_added') extra = ' — ' + esc(d.title || '');
  if(e.type === 'task_done' || e.type === 'task_created') extra = ' — ' + esc(d.title || '');
  if(e.type === 'user_created') extra = ' — ' + esc(d.username || '') + ' (' + esc(d.role || '') + ')';
  return '<div class="log-item"><span class="lic">' + (EVENT_ICONS[e.type] || '•') + '</span>' +
    '<span class="lt">' + t(typeKey) + extra + '</span>' +
    '<span class="lm">' + fmtDate(e.ts) + '</span></div>';
}
function renderLog(el, events){
  if(!events || !events.length){
    el.innerHTML = '<div class="empty"><span class="big">🕹</span>' + t('no_events') + '</div>';
    return;
  }
  el.innerHTML = events.map(eventLine).join('');
}

/* simple SVG bar chart */
function barChart(el, series, key, color){
  if(!series || !series.length) return;
  const w = 560, h = 150, pad = 8;
  const max = Math.max(1, ...series.map(x => x[key] || 0));
  const bw = (w - pad * 2) / series.length;
  let bars = '';
  series.forEach((x, i) => {
    const v = x[key] || 0;
    const bh = Math.round((h - 34) * (v / max));
    const x0 = pad + i * bw + bw * 0.15, bwid = bw * 0.7;
    bars += '<rect x="' + x0 + '" y="' + (h - 20 - bh) + '" width="' + bwid + '" height="' + Math.max(2, bh) + '" rx="5" fill="' + (color || 'url(#gbar)') + '"/>' +
      '<text x="' + (x0 + bwid / 2) + '" y="' + (h - 20 - bh - 4) + '" font-size="10" text-anchor="middle" fill="#547190" font-weight="700">' + v + '</text>' +
      '<text x="' + (x0 + bwid / 2) + '" y="' + (h - 6) + '" font-size="9" text-anchor="middle" fill="#8AA3BE">' + String(x.date).slice(5) + '</text>';
  });
  el.innerHTML = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<defs><linearGradient id="gbar" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#8FC7FF"/><stop offset="1" stop-color="#2E86DE"/></linearGradient></defs>' +
    bars + '</svg>';
}

function initials(name){
  return (name || '?').split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
}

async function loadMe(){
  try {
    APP_ME = await api('/api/me');
    APP_SETTINGS = APP_ME.settings || {};
    document.title = (APP_SETTINGS.app_name || 'GrandMaster64') + (document.title.includes('—') ? document.title.split('—')[1] : '');
    const bn = document.querySelector('.brand-name b');
    if(bn) bn.textContent = APP_SETTINGS.app_name || 'GrandMaster64';
    if(APP_ME.user){
      const sel = document.getElementById('langSelect');
      if(sel) sel.value = APP_ME.user.lang;
      setLang(APP_ME.user.lang, false);
    } else {
      setLang(currentLang(), false);
    }
  } catch(e) { /* not logged in */ }
}

function initTopbar(){
  const ls = document.getElementById('langSelect');
  if(ls){
    ls.onchange = () => setLang(ls.value, true);
  }
  const lo = document.getElementById('logoutBtn');
  if(lo){
    lo.onclick = async () => {
      try { await api('/api/auth/logout', {method: 'POST'}); } catch(e){}
      location.href = '/login';
    };
  }
  document.querySelectorAll('.navlink').forEach(a => {
    if(location.pathname.startsWith(a.getAttribute('href'))) a.classList.add('active');
  });
}

/* theme name translation */
function themeName(th){
  const map = {'mate-in-1': 'theme_mate_in_1', 'mate-in-2': 'theme_mate_in_2', 'back-rank': 'theme_back_rank'};
  return map[th] ? t(map[th]) : (th || t('theme'));
}
