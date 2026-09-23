/* GrandMaster64 — child (student) page */
(async function(){
  await loadMe();
  initTopbar();
  applyI18n();
  document.addEventListener('langchange', () => {
    applyI18n(); renderTasks(); renderLessons(); renderStatsView();
    if(board && board.fen) board.render(board.fen, board.legal, {autoFlip: true});
  });
  const me = APP_ME && APP_ME.user;
  if(!me || me.role !== 'child'){ location.href = '/'; return; }

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      if(tab.dataset.tab === 'tasks') renderTasks();
      if(tab.dataset.tab === 'lessons') renderLessons();
      if(tab.dataset.tab === 'stats') renderStatsView();
    };
  });

  const banner = document.getElementById('moveBanner');
  function showBanner(kind, msg){
    banner.className = 'banner show ' + kind;
    banner.textContent = msg;
  }
  function hideBanner(){ banner.className = 'banner'; }

  /* ---------- puzzle engine UI ---------- */
  let board, token = null, pzMeta = null, startTs = 0, timerInt = null, maxHints = 3, hintsLeft = 3, busy = false;

  board = new BoardView(document.getElementById('board'), (uci) => doMove(uci));

  async function refreshLegal(){
    if(!token) return [];
    try {
      const j = await api('/api/puzzle/legal?token=' + token);
      return j.legal;
    } catch(e){ return []; }
  }

  function updateSide(){
    const av = document.getElementById('sideAv');
    const txt = document.getElementById('sideTxt');
    if(board.side === 'w'){ av.textContent = '♔'; txt.textContent = t('side_white'); }
    else { av.textContent = '♚'; txt.textContent = t('side_black'); }
  }

  function startTimer(){
    startTs = Date.now();
    clearInterval(timerInt);
    timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - startTs) / 1000);
      document.getElementById('pzTimer').textContent = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
      document.getElementById('timeBar').style.width = Math.min(100, s / 120 * 100) + '%';
    }, 1000);
  }

  function setHints(n){
    hintsLeft = n;
    document.getElementById('hintLeft').textContent = n;
  }

  async function startPuzzle(taskId){
    busy = true;
    try {
      const j = await api('/api/puzzle/start', {method: 'POST', body: {task_id: taskId || null}});
      token = j.token;
      pzMeta = j.puzzle;
      const legal = await refreshLegal();
      board.render(pzMeta.fen, legal, {autoFlip: true});
      board.setLast([], null);
      updateSide();
      setHints(parseInt(APP_SETTINGS.max_hints || 3, 10));
      document.getElementById('boardIdle').classList.add('hidden');
      document.getElementById('boardWrap').classList.remove('hidden');
      document.getElementById('puzzleMeta').classList.add('hidden');
      document.getElementById('puzzleMetaFull').classList.remove('hidden');
      document.getElementById('pzRating').textContent = pzMeta.rating;
      document.getElementById('pzTheme').textContent = themeName(pzMeta.themes[0] || '');
      if(taskId){
        showBanner('sky', '📋 ' + t('task_active') + ' #' + taskId);
      } else hideBanner();
      startTimer();
      busy = false;
    } catch(e){
      busy = false;
      if(e.j && e.j.error === 'task_complete'){ toast(t('task_done'), 'ok'); renderTasks(); }
      else toast(t('error') + ': ' + e.message, 'bad');
    }
  }

  async function doMove(uci){
    if(!token || busy) return;
    busy = true;
    board.clearArrow();
    try {
      const j = await api('/api/puzzle/move', {method: 'POST', body: {token, uci}});
      if(j.bad === 'illegal'){
        showBanner('bad', '✖ ' + t('illegal_move'));
        setTimeout(hideBanner, 1800);
        busy = false;
        return;
      }
      if(j.bad === 'wrong'){
        showBanner('warn', '↩ ' + t('wrong_move') + ' (' + j.mistakes + ')');
        setTimeout(hideBanner, 2400);
        busy = false;
        return;
      }
      if(j.solved){
        clearInterval(timerInt);
        board.render(j.fen, [], {autoFlip: true, lastMoves: [uci]});
        board.setLast([uci]);
        token = null;
        solvedModal(j);
        refreshHeaderStats();
        return;
      }
      hideBanner();
      const legal = await refreshLegal();
      board.render(j.fen, legal, {autoFlip: true, lastMoves: [j.my_uci, j.opp_uci].filter(Boolean)});
      board.setLast([j.my_uci, j.opp_uci].filter(Boolean));
      updateSide();
      busy = false;
    } catch(e){
      toast(t('error') + ': ' + e.message, 'bad');
      busy = false;
    }
  }

  function solvedModal(j){
    const stars = j.score >= 90 ? 3 : j.score >= 60 ? 2 : 1;
    const msg = j.mistakes === 0 && j.hints === 0 ? t('perfect') : t('nice');
    openModal(
      '<div style="text-align:center">' +
      '<div class="score-ring" style="--p:' + j.score + '"><div><b>' + j.score + '</b><small>' + t('your_score') + '</small></div></div>' +
      '<h3>' + t('solved_title') + '</h3>' +
      '<p style="font-size:1.5rem;margin:6px 0 12px">' + '<span class="star">★</span>'.repeat(stars) + '<span style="opacity:.25">★</span>'.repeat(3 - stars) + '</p>' +
      '<p class="muted mb">' + msg + '</p>' +
      '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="stat"><div class="num" style="font-size:1.2rem">' + fmtSecs(j.secs) + '</div><div class="lbl">' + t('time_spent') + '</div></div>' +
      '<div class="stat"><div class="num" style="font-size:1.2rem">' + j.hints + '</div><div class="lbl">' + t('hints_used') + '</div></div>' +
      '<div class="stat"><div class="num" style="font-size:1.2rem">' + j.mistakes + '</div><div class="lbl">' + t('mistakes') + '</div></div>' +
      '</div>' +
      '<button class="btn b-primary" style="width:100%" id="solvedNext">' + t('next_puzzle') + ' ♟</button>' +
      '</div>');
    document.getElementById('solvedNext').onclick = () => { closeModal(); startPuzzle(null); };
    if(j.task_id) renderTasks();
  }

  document.getElementById('idleStart').onclick = () => startPuzzle(null);
  document.getElementById('nextPuzzle').onclick = () => startPuzzle(null);
  document.getElementById('hintBtn').onclick = async () => {
    if(!token) return;
    try {
      const j = await api('/api/puzzle/hint', {method: 'POST', body: {token}});
      setHints(j.remaining);
      board.showArrow(j.hint.from, j.hint.to, '#1E7A45');
      setTimeout(() => board.clearArrow(), 3500);
      showBanner('sky', '💡 ' + t('hint') + ' — ' + j.hint.from + ' → ' + j.hint.to);
      setTimeout(hideBanner, 2500);
    } catch(e){
      toast(t(e.j && e.j.error === 'no_hints' ? 'no_hints' : 'error'), 'bad');
    }
  };
  document.getElementById('giveupBtn').onclick = async () => {
    if(!token) return;
    try { await api('/api/puzzle/giveup', {method: 'POST', body: {token}}); } catch(e){}
    token = null;
    clearInterval(timerInt);
    document.getElementById('boardWrap').classList.add('hidden');
    document.getElementById('boardIdle').classList.remove('hidden');
    document.getElementById('puzzleMetaFull').classList.add('hidden');
    document.getElementById('puzzleMeta').classList.remove('hidden');
  };

  async function refreshHeaderStats(){
    try {
      const j = await api('/api/stats');
      document.getElementById('todayCount').textContent = j.stats.solved_today;
      document.getElementById('streakChip').textContent = j.stats.streak;
    } catch(e){}
  }

  /* ---------- tasks ---------- */
  async function renderTasks(){
    const box = document.getElementById('taskList');
    box.innerHTML = '<div class="empty">' + t('loading') + '</div>';
    let tasks = [];
    try { tasks = (await api('/api/tasks')).tasks; } catch(e){}
    if(!tasks.length){
      box.innerHTML = '<div class="card empty" style="grid-column:1/-1"><span class="big">📭</span>' + t('no_tasks') + '</div>';
      return;
    }
    box.innerHTML = tasks.map(tk => {
      const pct = Math.round(100 * tk.solved / Math.max(1, tk.total));
      const done = tk.status === 'done';
      return '<div class="card">' +
        '<div class="card-title-row"><h3 style="margin:0"><span class="ic">' + (done ? '✅' : '📋') + '</span>' + esc(tk.title) + '</h3>' +
        '<span class="chip ' + (done ? 'c-ok' : 'c-warn') + '">' + (done ? t('task_done') : tk.solved + '/' + tk.total) + '</span></div>' +
        (tk.description ? '<p class="muted mb">' + esc(tk.description) + '</p>' : '') +
        '<div class="progress big mb" style="margin-top:10px"><i style="width:' + pct + '%"></i></div>' +
        '<div class="flex spread">' +
        '<span class="chip">' + t('due') + ': ' + tk.due_days + ' ' + t('due_days').split('(')[0].trim() + '</span>' +
        '<span class="chip c-sky">≈ ' + (tk.avg_rating || '?') + ' ' + t('rating') + '</span>' +
        (done ? '' : '<button class="btn btn-sm b-primary" data-task="' + tk.id + '">' + t('start_puzzle') + ' ♟</button>') +
        '</div></div>';
    }).join('');
    box.querySelectorAll('[data-task]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        document.querySelector('[data-tab="trainer"]').classList.add('active');
        document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-trainer').classList.remove('hidden');
        startPuzzle(parseInt(b.dataset.task, 10));
      };
    });
  }

  /* ---------- lessons ---------- */
  async function renderLessons(){
    const box = document.getElementById('sectionList');
    box.innerHTML = '<div class="empty">' + t('loading') + '</div>';
    let secs = [];
    try { secs = (await api('/api/sections')).sections; } catch(e){}
    if(!secs.length || secs.every(s => !s.videos.length)){
      box.innerHTML = '<div class="card empty"><span class="big">🎬</span>' + t('no_events') + '</div>';
      return;
    }
    box.innerHTML = secs.filter(s => s.videos.length).map(s =>
      '<div class="card mb"><h3><span class="ic">📚</span>' + esc(s.title) + '</h3>' +
      (s.description ? '<p class="muted mb">' + esc(s.description) + '</p>' : '') +
      '<div class="vgrid">' + s.videos.map(v => videoCard(v, s.id)).join('') + '</div></div>'
    ).join('');
    box.querySelectorAll('[data-play]').forEach(b => {
      b.onclick = () => playVideo(parseInt(b.dataset.play, 10));
    });
  }

  function videoCard(v, secId){
    const thumb = v.kind === 'youtube'
      ? '<img src="https://img.youtube.com/vi/' + esc(v.ref) + '/hqdefault.jpg" alt="" onerror="this.style.display=\'none\'">'
      : '<span>🎬</span>';
    return '<div class="vcard" data-play="' + v.id + '">' +
      (v.done ? '<span class="done-flag">✓</span>' : '') +
      '<div class="thumb">' + thumb + '</div>' +
      '<div class="vmeta"><div class="vtitle">' + esc(v.title) + '</div>' +
      '<div class="vsub">' + (v.kind === 'youtube' ? 'YouTube' : 'GrandMaster64') + '</div></div></div>';
  }

  let curVideo = null, sentComplete = false;
  async function playVideo(vid){
    sentComplete = false;
    curVideo = vid;
    const secs = (await api('/api/sections')).sections;
    let v = null;
    for(const s of secs){ const f = s.videos.find(x => x.id === vid); if(f){ v = f; break; } }
    if(!v) return;
    let body;
    if(v.kind === 'youtube'){
      body = '<iframe class="player-frame" src="https://www.youtube-nocookie.com/embed/' + esc(v.ref) + '?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    } else {
      body = '<video class="player-native" controls src="/uploads/' + esc(v.ref) + '"></video>';
      const vid2 = body;
      openModal('<h3>' + esc(v.title) + '</h3>' + body +
        '<div class="btn-row" style="justify-content:flex-end;margin-top:12px">' +
        '<button class="btn btn-sm" id="vClose" data-i18n="close"></button>' +
        '<button class="btn btn-sm b-ok" id="vDone" data-i18n="complete"></button></div>');
      applyI18n(document.getElementById('modalBox'));
      const el = document.querySelector('#modalBox video');
      el.onplay = () => api('/api/video/event', {method: 'POST', body: {video_id: vid, event: 'start'}}).catch(()=>{});
      el.ontimeupdate = () => {
        if(!sentComplete && el.duration && el.currentTime / el.duration >= 0.92){
          sentComplete = true;
          api('/api/video/event', {method: 'POST', body: {video_id: vid, event: 'complete'}}).catch(()=>{});
        }
      };
      document.getElementById('vClose').onclick = closeModal;
      document.getElementById('vDone').onclick = () => {
        if(!sentComplete){
          sentComplete = true;
          api('/api/video/event', {method: 'POST', body: {video_id: vid, event: 'complete'}}).catch(()=>{});
        }
        closeModal();
      };
      return;
    }
    openModal('<h3>' + esc(v.title) + '</h3>' + body +
      '<div class="btn-row" style="justify-content:flex-end;margin-top:12px">' +
      '<button class="btn btn-sm" id="vClose" data-i18n="close"></button>' +
      '<button class="btn btn-sm b-ok" id="vDone" data-i18n="complete"></button></div>');
    applyI18n(document.getElementById('modalBox'));
    api('/api/video/event', {method: 'POST', body: {video_id: vid, event: 'start'}}).catch(()=>{});
    document.getElementById('vClose').onclick = closeModal;
    document.getElementById('vDone').onclick = () => {
      if(!sentComplete){
        sentComplete = true;
        api('/api/video/event', {method: 'POST', body: {video_id: vid, event: 'complete'}}).catch(()=>{});
      }
      closeModal();
    };
  }

  /* ---------- stats ---------- */
  async function renderStatsView(){
    let s;
    try { s = (await api('/api/stats')).stats; } catch(e){ return; }
    document.getElementById('stSolved').textContent = s.total_solved;
    document.getElementById('stAcc').textContent = s.accuracy + '%';
    document.getElementById('stHints').textContent = s.hints;
    document.getElementById('stBest').textContent = s.best_score;
    document.getElementById('todayCount').textContent = s.solved_today;
    document.getElementById('streakChip').textContent = s.streak;
    barChart(document.getElementById('chartBox'), s.series, 'solved');
    const themes = Object.entries(s.by_theme || {});
    const mx = Math.max(1, ...themes.map(x => x[1]));
    document.getElementById('themeBox').innerHTML = themes.length ? themes.map((x, i) =>
      '<div class="mb"><div class="flex spread" style="font-size:.85rem;font-weight:700;margin-bottom:5px">' +
      '<span>' + themeName(x[0]) + '</span><span>' + x[1] + ' ' + t('solved_word') + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(100 * x[1] / mx) + '%"></i></div></div>'
    ).join('') : '<div class="empty">' + t('no_events') + '</div>';
    renderLog(document.getElementById('myLog'), s.recent);
  }

  await Promise.all([refreshHeaderStats()]);
})();
