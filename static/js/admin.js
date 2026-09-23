/* GrandMaster64 — admin panel */
(async function(){
  await loadMe();
  initTopbar();
  applyI18n();
  document.addEventListener('langchange', () => { applyI18n(); renderAll(activeTab); });
  const me = APP_ME && APP_ME.user;
  if(!me || me.role !== 'admin'){ location.href = '/'; return; }

  let users = [], sectionsCache = [], tasksCache = [], activeTab = 'dash';

  const ROLES = ['admin', 'teacher', 'parent', 'child'];
  const LANGOPTS = ['uz', 'en', 'ru', 'tr', 'ar'].map(l => '<option value="' + l + '">' + l.toUpperCase() + '</option>').join('');

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      activeTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      renderAll(activeTab);
    };
  });

  function renderAll(tab){
    if(!tab) return;
    if(tab === 'dash') renderDash();
    if(tab === 'users') renderUsers();
    if(tab === 'puzzles') renderPuzzles();
    if(tab === 'tasks') renderAdminTasks();
    if(tab === 'videos') renderVideos();
    if(tab === 'settings') renderSettings();
    if(tab === 'logs') renderLogsPage();
  }

  /* ---------- dashboard ---------- */
  let dashTimer = null;
  async function renderDash(){
    let j;
    try { j = await api('/api/admin/dashboard'); } catch(e){ return; }
    const d = j.dashboard;
    document.getElementById('dUsers').textContent = d.users;
    document.getElementById('dPuzzles').textContent = d.puzzles;
    document.getElementById('dVideos').textContent = d.videos;
    document.getElementById('dSolved').textContent = d.solved_today;
    renderLog(document.getElementById('dEvents'), d.events);
    const pc = document.getElementById('dPerChild');
    const mx = Math.max(1, ...d.per_child.map(x => x.solved));
    pc.innerHTML = d.per_child.map(x =>
      '<div><div class="flex spread" style="font-size:.85rem;font-weight:700;margin-bottom:4px">' +
      '<span>' + esc(x.name) + '</span><span class="muted">' + x.solved + ' 🏆 · ' + x.hints + ' 💡</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(100 * x.solved / mx) + '%"></i></div></div>'
    ).join('') || '<span class="muted">' + t('no_students') + '</span>';
    if(d.refresh && d.refresh.state === 'running'){
      dashTimer = setTimeout(renderDash, 3000);
    } else if(dashTimer){ clearTimeout(dashTimer); dashTimer = null; }
  }

  /* ---------- users ---------- */
  async function loadUsers(){
    try { users = (await api('/api/admin/users')).users; } catch(e){ users = []; }
  }
  function renderUsers(){
    loadUsers().then(applyUserFilter);
    fillSelects();
  }
  function applyUserFilter(){
    const term = (document.getElementById('uSearch').value || '').toLowerCase();
    const tb = document.getElementById('uRows');
    const rows = users.filter(u => !term || u.name.toLowerCase().includes(term) || u.username.toLowerCase().includes(term));
    if(!rows.length){ tb.innerHTML = '<tr><td colspan="6" class="empty">' + t('none') + '</td></tr>'; return; }
    tb.innerHTML = rows.map(u =>
      '<tr><td><b>' + esc(u.name) + '</b></td><td>@' + esc(u.username) + '</td>' +
      '<td><span class="chip ' + (u.role === 'admin' ? 'c-bad' : u.role === 'teacher' ? 'c-sky' : u.role === 'parent' ? 'c-warn' : 'c-ok') + '">' + t('role_' + u.role) + '</span></td>' +
      '<td>' + (u.parent_name ? esc(u.parent_name) : '<span class="muted">—</span>') + '</td>' +
      '<td><span class="dot ' + (u.active ? 'ok' : 'bad') + '"></span></td>' +
      '<td><div class="acts">' +
      '<button class="btn btn-sm" data-edit="' + u.id + '">' + t('edit') + '</button>' +
      '<button class="btn btn-sm" data-reset="' + u.id + '">' + t('reset_password') + '</button>' +
      '<button class="btn btn-sm b-danger" data-del="' + u.id + '">✕</button>' +
      '</div></td></tr>'
    ).join('');
    tb.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => userModal(parseInt(b.dataset.edit, 10)));
    tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      confirmDialog(t('delete_confirm'), async () => {
        await api('/api/admin/users/' + b.dataset.del, {method: 'DELETE'}).catch(()=>{});
        renderUsers();
      });
    });
    tb.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
      const pw = prompt(t('new_password'), '123456');
      if(!pw) return;
      try {
        await api('/api/admin/users/' + b.dataset.reset + '/reset', {method: 'POST', body: {password: pw}});
        toast(t('new_password') + ' ✓', 'ok');
      } catch(e){ toast(t('error'), 'bad'); }
    });
  }
  document.getElementById('uSearch').oninput = applyUserFilter;

  function userModal(uid){
    const u = users.find(x => x.id === uid);
    if(!u) return;
    const parentOpts = '<option value="">' + t('no_parent') + '</option>' +
      users.filter(x => x.role === 'parent').map(p => '<option value="' + p.id + '" ' + (u.parent_id === p.id ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const ov = openModal(
      '<h3>' + t('edit_user') + ' — ' + esc(u.name) + '</h3>' +
      '<div class="field"><label data-i18n="name"></label><input class="input" id="muName" value="' + esc(u.name) + '"></div>' +
      '<div class="field"><label data-i18n="role"></label><select class="input" id="muRole">' +
      ROLES.map(r => '<option value="' + r + '" ' + (u.role === r ? 'selected' : '') + '>' + t('role_' + r) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>' + 'Til</label><select class="input" id="muLang">' + LANGOPTS.replace('value="' + u.lang + '"', 'value="' + u.lang + '" selected') + '</select></div>' +
      (u.role === 'child' ? '<div class="field"><label data-i18n="link_to_parent"></label><select class="input" id="muParent">' + parentOpts + '</select></div>' : '') +
      '<div class="field" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:13px;background:var(--surface2);box-shadow:var(--sh-in)">' +
      '<label style="margin:0" data-i18n="active"></label><label class="switch"><input type="checkbox" id="muActive" ' + (u.active ? 'checked' : '') + '><i></i></label></div>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
      '<button class="btn btn-sm" onclick="closeModal()">' + t('cancel') + '</button>' +
      '<button class="btn btn-sm b-primary" id="muSave">' + t('save') + '</button></div>');
    applyI18n(ov);
    ov.querySelector('#muSave').onclick = async () => {
      try {
        await api('/api/admin/users/' + u.id, {method: 'POST', body: {
          name: ov.querySelector('#muName').value,
          role: ov.querySelector('#muRole').value,
          lang: ov.querySelector('#muLang').value,
          active: ov.querySelector('#muActive').checked,
          parent_id: ov.querySelector('#muParent') ? (parseInt(ov.querySelector('#muParent').value, 10) || null) : null
        }});
        toast(t('save') + ' ✓', 'ok');
        closeModal();
        renderUsers();
      } catch(e){ toast(t('error') + ': ' + e.message, 'bad'); }
    };
  }

  document.getElementById('uAddBtn').onclick = () => {
    const parentOpts = '<option value="">' + t('no_parent') + '</option>' +
      users.filter(x => x.role === 'parent').map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
    const ov = openModal(
      '<h3>' + t('add_user') + '</h3>' +
      '<div class="field"><label data-i18n="name"></label><input class="input" id="nuName"></div>' +
      '<div class="field"><label data-i18n="username"></label><input class="input" id="nuUser"></div>' +
      '<div class="field"><label data-i18n="password"></label><input class="input" id="nuPass" value="123456"></div>' +
      '<div class="row"><div class="field"><label data-i18n="role"></label><select class="input" id="nuRole">' +
      ROLES.map(r => '<option value="' + r + '">' + t('role_' + r) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Til</label><select class="input" id="nuLang">' + LANGOPTS + '</select></div></div>' +
      '<div class="field"><label data-i18n="link_to_parent"></label><select class="input" id="nuParent">' + parentOpts + '</select></div>' +
      '<div class="btn-row" style="justify-content:flex-end">' +
      '<button class="btn btn-sm" onclick="closeModal()">' + t('cancel') + '</button>' +
      '<button class="btn btn-sm b-primary" id="nuSave">' + t('create') + '</button></div>');
    applyI18n(ov);
    ov.querySelector('#nuSave').onclick = async () => {
      try {
        await api('/api/admin/users', {method: 'POST', body: {
          name: ov.querySelector('#nuName').value,
          username: ov.querySelector('#nuUser').value,
          password: ov.querySelector('#nuPass').value,
          role: ov.querySelector('#nuRole').value,
          lang: ov.querySelector('#nuLang').value,
          parent_id: parseInt(ov.querySelector('#nuParent').value, 10) || null
        }});
        toast(t('ev_user_created'), 'ok');
        closeModal();
        renderUsers();
      } catch(e){ toast(t('error') + ': ' + (e.j && e.j.error ? e.j.error : e.message), 'bad'); }
    };
  };

  /* ---------- puzzles ---------- */
  let pzPoll = null;
  async function renderPuzzles(){
    let j;
    try { j = await api('/api/admin/puzzles'); } catch(e){ return; }
    const rows = j.puzzles;
    document.getElementById('pzTotal').textContent = j.total + ' ' + t('puzzle_word');
    const stEl = document.getElementById('pzStatus');
    if(APP_SETTINGS.puzzle_refresh_status){
      try {
        const st = JSON.parse(APP_SETTINGS.puzzle_refresh_status);
        if(st.state === 'running'){
          stEl.textContent = t('refresh_running');
          if(!pzPoll) pzPoll = setInterval(async () => {
            try {
              const d = await api('/api/admin/dashboard');
              if(d.dashboard.refresh && d.dashboard.refresh.state !== 'running'){ clearInterval(pzPoll); pzPoll = null; renderPuzzles(); }
            } catch(e){}
          }, 3000);
        } else if(st.state === 'done'){
          stEl.textContent = '✓ ' + (st.added || 0) + ' ' + t('refresh_ok') + ' (' + (st.at || '') + ')';
        } else if(st.state === 'error'){
          stEl.textContent = '✖ ' + t('refresh_fail');
        } else {
          stEl.textContent = '—';
        }
      } catch(e){ stEl.textContent = '—'; }
    }
    const tb = document.getElementById('pzRows');
    tb.innerHTML = rows.map(p =>
      '<tr><td>#' + p.id + '</td><td><b>' + p.rating + '</b></td>' +
      '<td>' + esc(p.themes) + '</td><td>' + (p.source === 'lichess' ? '<span class="chip c-sky">lichess</span>' : '<span class="chip">built-in</span>') + '</td>' +
      '<td><label class="switch"><input type="checkbox" data-tog="' + p.id + '" ' + (p.enabled ? 'checked' : '') + '><i></i></label></td>' +
      '<td><button class="btn btn-sm b-danger" data-pdel="' + p.id + '">✕</button></td></tr>'
    ).join('') || '<tr><td colspan="6" class="empty">' + t('none') + '</td></tr>';
    tb.querySelectorAll('[data-tog]').forEach(b => b.onchange = async () => {
      await api('/api/admin/puzzles/' + b.dataset.tog + '/toggle', {method: 'POST'}).catch(()=>{});
    });
    tb.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => {
      confirmDialog(t('delete_confirm'), async () => {
        await api('/api/admin/puzzles/' + b.dataset.pdel, {method: 'DELETE'}).catch(()=>{});
        renderPuzzles();
      });
    });
  }

  document.getElementById('pzRefresh').onclick = async () => {
    try {
      await api('/api/admin/puzzles/refresh', {method: 'POST', body: {limit: parseInt(APP_SETTINGS.lichess_limit || '60', 10) || 60}});
      toast(t('refresh_running'), 'ok');
      renderPuzzles();
    } catch(e){ toast(t('error'), 'bad'); }
  };

  /* ---------- tasks ---------- */
  function fillSelects(){
    const childOpts = '<option value="">' + t('all_students') + '</option>' +
      users.filter(u => u.role === 'child').map(u => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('');
    const a = document.getElementById('atkChild');
    if(a) a.innerHTML = childOpts;
    const vsel = document.getElementById('avidSection');
    if(vsel) vsel.innerHTML = '<option value="">' + t('none') + '</option>' +
      sectionsCache.map(s => '<option value="' + s.id + '">' + esc(s.title) + '</option>').join('');
  }

  async function renderAdminTasks(){
    fillSelects();
    let tasks = [];
    try { tasks = (await api('/api/tasks')).tasks; } catch(e){}
    const box = document.getElementById('atkBox');
    if(!tasks.length){ box.innerHTML = '<div class="empty">' + t('no_tasks') + '</div>'; return; }
    box.innerHTML = tasks.map(tk =>
      '<div style="border-radius:16px;padding:14px;background:var(--surface2);box-shadow:var(--sh-sm)">' +
      '<div class="flex spread" style="margin-bottom:6px"><b>' + esc(tk.title) + '</b>' +
      '<span class="chip">' + (tk.child_name ? esc(tk.child_name) : t('all_students')) + '</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px">' +
      tk.items.map(it => '<div class="flex spread" style="font-size:.8rem"><span>' + esc(it.name) + '</span>' +
      '<span class="chip ' + (it.status === 'done' ? 'c-ok' : 'c-warn') + '" style="padding:2px 10px">' + it.solved + '/' + tk.total + '</span></div>').join('') + '</div>' +
      '<div class="flex spread"><span class="muted" style="font-size:.72rem">' + fmtDate(tk.created_at) + '</span>' +
      '<button class="btn btn-sm b-danger" data-tdel="' + tk.id + '">' + t('delete') + '</button></div></div>'
    ).join('');
    box.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => {
      confirmDialog(t('delete_confirm'), async () => {
        await api('/api/tasks/' + b.dataset.tdel, {method: 'DELETE'}).catch(()=>{});
        renderAdminTasks();
      });
    });
  }

  document.getElementById('atkCreate').onclick = async () => {
    const title = document.getElementById('atkTitle').value.trim();
    if(!title){ toast(t('task_name'), 'bad'); return; }
    try {
      await api('/api/tasks', {method: 'POST', body: {
        title,
        description: document.getElementById('atkDesc').value.trim(),
        child_id: parseInt(document.getElementById('atkChild').value, 10) || null,
        difficulty: document.getElementById('atkDiff').value,
        count: parseInt(document.getElementById('atkCount').value, 10) || 5,
        due_days: parseInt(document.getElementById('atkDue').value, 10) || 7
      }});
      toast(t('ev_task_created'), 'ok');
      document.getElementById('atkTitle').value = '';
      renderAdminTasks();
    } catch(e){ toast(t('error'), 'bad'); }
  };

  /* ---------- videos & sections ---------- */
  async function loadContent(){
    try {
      const j = await api('/api/content');
      sectionsCache = j.sections;
      fillSelects();
      renderVideoList(j.videos, 'avidList');
    } catch(e){}
  }
  async function renderVideos(){ await loadContent(); }

  function renderVideoList(vids, boxId){
    const box = document.getElementById(boxId);
    if(!vids.length){ box.innerHTML = '<div class="empty">' + t('none') + '</div>'; return; }
    const secName = id => { const s = sectionsCache.find(x => x.id === id); return s ? s.title : '—'; };
    box.innerHTML = vids.map(v =>
      '<div class="flex spread" style="padding:10px 12px;border-radius:13px;background:var(--surface2);box-shadow:var(--sh-sm);font-size:.85rem">' +
      '<div class="flex" style="gap:8px"><span>' + (v.kind === 'youtube' ? '▶️' : '📹') + '</span><div><b>' + esc(v.title) + '</b><div class="muted" style="font-size:.72rem">' + secName(v.section_id) + '</div></div></div>' +
      '<button class="btn btn-sm b-danger" data-vdel="' + v.id + '">✕</button></div>'
    ).join('');
    box.querySelectorAll('[data-vdel]').forEach(b => b.onclick = () => {
      confirmDialog(t('delete_confirm'), async () => {
        await api('/api/videos/' + b.dataset.vdel, {method: 'DELETE'}).catch(()=>{});
        loadContent();
      });
    });
  }

  document.getElementById('asectAdd').onclick = async () => {
    const title = document.getElementById('asectTitle').value.trim();
    if(!title) return;
    try {
      await api('/api/sections', {method: 'POST', body: {title}});
      document.getElementById('asectTitle').value = '';
      loadContent();
    } catch(e){ toast(t('error'), 'bad'); }
  };

  document.getElementById('avidAdd').onclick = async () => {
    const title = document.getElementById('avidTitle').value.trim();
    const url = document.getElementById('avidUrl').value.trim();
    const file = document.getElementById('avidFile').files[0];
    const sectionId = parseInt(document.getElementById('avidSection').value, 10) || null;
    if(!file && !url){ toast(t('youtube_url'), 'bad'); return; }
    const btn = document.getElementById('avidAdd');
    btn.disabled = true;
    try {
      if(file){
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', title);
        fd.append('section_id', sectionId || '');
        await api('/api/videos', {method: 'POST', body: fd});
        document.getElementById('avidFile').value = '';
      } else {
        await api('/api/videos', {method: 'POST', body: {kind: 'youtube', url, title, section_id: sectionId}});
        document.getElementById('avidUrl').value = '';
      }
      document.getElementById('avidTitle').value = '';
      toast(t('ev_video_added'), 'ok');
      loadContent();
    } catch(e){ toast(t('error') + ': ' + (e.j && e.j.error ? e.j.error : e.message), 'bad'); }
    btn.disabled = false;
  };

  /* ---------- settings ---------- */
  async function renderSettings(){
    let j;
    try { j = await api('/api/admin/settings'); } catch(e){ return; }
    const s = j.settings;
    document.getElementById('sAppName').value = s.app_name || '';
    document.getElementById('sTagline').value = s.tagline || '';
    document.getElementById('sLang').value = s.default_lang || 'uz';
    document.getElementById('sMaxHints').value = s.max_hints || 3;
    document.getElementById('sLichess').value = s.lichess_limit || 60;
    document.getElementById('sRmin').value = s.rating_min || 400;
    document.getElementById('sRmax').value = s.rating_max || 1600;
    document.getElementById('sHintPen').value = s.hint_penalty || 20;
    document.getElementById('sMisPen').value = s.mistake_penalty || 5;
    document.getElementById('sSignup').checked = s.allow_signup === '1';
  }
  document.getElementById('sSave').onclick = async () => {
    try {
      await api('/api/admin/settings', {method: 'POST', body: {
        app_name: document.getElementById('sAppName').value,
        tagline: document.getElementById('sTagline').value,
        default_lang: document.getElementById('sLang').value,
        max_hints: document.getElementById('sMaxHints').value,
        lichess_limit: document.getElementById('sLichess').value,
        rating_min: document.getElementById('sRmin').value,
        rating_max: document.getElementById('sRmax').value,
        hint_penalty: document.getElementById('sHintPen').value,
        mistake_penalty: document.getElementById('sMisPen').value,
        allow_signup: document.getElementById('sSignup').checked ? '1' : '0'
      }});
      const mj = await api('/api/me');
      APP_ME = mj; APP_SETTINGS = mj.settings;
      toast(t('settings_saved'), 'ok');
    } catch(e){ toast(t('error'), 'bad'); }
  };

  /* ---------- logs ---------- */
  async function renderLogsPage(){
    fillSelects();
    const us = document.getElementById('logUser');
    us.innerHTML = '<option value="">' + t('all') + '</option>' +
      users.map(u => '<option value="' + u.id + '">' + esc(u.name) + ' (' + u.role + ')</option>').join('');
    const types = ['login','puzzle_start','puzzle_solved','puzzle_mistake','hint_used','puzzle_giveup','task_done','video_start','video_complete','user_created','settings','video_added','task_created'];
    document.getElementById('logType').innerHTML = '<option value="">' + t('event_type') + ': ' + t('all') + '</option>' +
      types.map(x => '<option value="' + x + '">' + t('ev_' + x) + '</option>').join('');
    await loadLog();
  }
  async function loadLog(){
    const u = document.getElementById('logUser').value;
    const ty = document.getElementById('logType').value;
    const qs = new URLSearchParams({limit: 400});
    if(u) qs.set('user_id', u);
    if(ty) qs.set('type', ty);
    try {
      const j = await api('/api/admin/events?' + qs.toString());
      const box = document.getElementById('logBox');
      if(!j.events.length){ box.innerHTML = '<div class="empty">' + t('none') + '</div>'; return; }
      box.innerHTML = j.events.map(e =>
        '<div class="log-item"><span class="lic">' + ({login:'🔑',puzzle_start:'♟',puzzle_solved:'🏆',puzzle_mistake:'⚠️',hint_used:'💡',puzzle_giveup:'🏳',task_done:'✅',video_start:'▶️',video_complete:'🎬',user_created:'👤',settings:'⚙️',video_added:'📹',task_created:'📋'}[e.type] || '•') + '</span>' +
        '<span class="lt"><b>' + esc(e.uname || e.username || '?') + '</b> · ' + t('ev_' + e.type) + '</span>' +
        '<span class="lm">' + fmtDate(e.ts) + '</span></div>'
      ).join('');
    } catch(e){}
  }
  document.getElementById('logLoad').onclick = loadLog;
  document.getElementById('logUser').onchange = loadLog;
  document.getElementById('logType').onchange = loadLog;

  /* go */
  renderAll('dash');
  loadUsers();
  loadContent();
})();
