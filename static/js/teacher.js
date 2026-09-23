/* GrandMaster64 — teacher page */
(async function(){
  await loadMe();
  initTopbar();
  applyI18n();
  document.addEventListener('langchange', () => { applyI18n(); renderStudents(); renderTasks(); renderVideos(); });
  const me = APP_ME && APP_ME.user;
  if(!me || !['teacher', 'admin'].includes(me.role)){ location.href = '/'; return; }

  let students = [];
  let sectionsCache = [];

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
      document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
      if(tab.dataset.tab === 'students') renderStudents();
      if(tab.dataset.tab === 'tasks') renderTasks();
      if(tab.dataset.tab === 'videos') renderVideos();
    };
  });

  /* ---------- students ---------- */
  async function loadStudents(){
    try {
      students = (await api('/api/students')).students;
      fillChildSelect();
    } catch(e){ students = []; }
  }

  function fillChildSelect(){
    const sel = document.getElementById('tkChild');
    sel.innerHTML = '<option value="">' + t('all_students') + '</option>' +
      students.map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
    const vsel = document.getElementById('vidSection');
    vsel.innerHTML = '<option value="">' + t('none') + '</option>' +
      sectionsCache.map(s => '<option value="' + s.id + '">' + esc(s.title) + '</option>').join('');
  }

  async function renderStudents(){
    await loadStudents();
    applySearch();
  }

  function applySearch(){
    const term = (document.getElementById('studentSearch').value || '').toLowerCase();
    const rows = students.filter(s => !term || s.name.toLowerCase().includes(term) || s.username.toLowerCase().includes(term));
    const tb = document.getElementById('studentRows');
    if(!rows.length){
      tb.innerHTML = '<tr><td colspan="7" class="empty">' + t('no_students') + '</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(s =>
      '<tr><td><div class="flex"><span class="avatar" style="width:34px;height:34px;font-size:.8rem">' + initials(s.name) + '</span><b>' + esc(s.name) + '</b></div></td>' +
      '<td>' + (s.parent ? esc(s.parent) : '<span class="muted">' + t('no_parent') + '</span>') + '</td>' +
      '<td><b>' + s.solved + '</b></td>' +
      '<td>' + s.hints + ' 💡</td>' +
      '<td>' + s.accuracy + '%</td>' +
      '<td>' + s.solved_today + '</td>' +
      '<td><div class="acts"><button class="btn btn-sm" data-view="' + s.id + '">' + t('view_stats') + '</button></div></td></tr>'
    ).join('');
    tb.querySelectorAll('[data-view]').forEach(b => b.onclick = () => studentModal(parseInt(b.dataset.view, 10)));
  }
  document.getElementById('studentSearch').oninput = applySearch;

  async function studentModal(uid){
    let j;
    try { j = await api('/api/students/' + uid); } catch(e){ toast(t('error'), 'bad'); return; }
    const s = j.stats, c = j.child;
    const hintsByPuzzle = j.events.filter(e => e.type === 'hint_used').length;
    const ov = openModal(
      '<div class="flex spread" style="margin-bottom:14px">' +
      '<div class="flex"><span class="avatar">' + initials(c.name) + '</span><div><h3 style="margin:0">' + esc(c.name) + '</h3><span class="muted">@' + esc(c.username) + '</span></div></div>' +
      '<span class="chip c-sky">' + t('role_child') + '</span></div>' +
      '<div class="grid g4" style="margin-bottom:14px">' +
      statCell('🏆', s.total_solved, t('total_solved')) +
      statCell('💡', s.hints, t('hints_used')) +
      statCell('🎯', s.accuracy + '%', t('accuracy')) +
      statCell('🔥', s.streak, t('streak')) +
      '</div>' +
      '<div class="card-title-row"><h3 style="margin:0"><span class="ic">📋</span>' + t('tasks') + '</h3></div>' +
      '<div class="mb">' + (j.task_items.length ? j.task_items.map(it =>
        '<div class="flex spread mb" style="font-size:.85rem">' +
        '<span>' + esc(it.task_title) + ' <span class="muted">(' + t('due') + ': ' + it.due_days + 'd)</span></span>' +
        '<span class="chip ' + (it.status === 'done' ? 'c-ok' : 'c-warn') + '">' + it.solved + '/' + it.total + (it.status === 'done' ? ' ✓' : '') + '</span></div>'
      ).join('') : '<span class="muted">' + t('no_tasks') + '</span>') + '</div>' +
      '<div class="card-title-row"><h3 style="margin:0"><span class="ic">🕘</span>' + t('my_activity') + '</h3></div>' +
      '<div class="log" id="stLog"></div>' +
      '<div class="btn-row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-sm" onclick="closeModal()">' + t('close') + '</button></div>'
    , true);
    renderLog(ov.querySelector('#stLog'), j.events);
  }

  function statCell(ic, num, lbl){
    return '<div class="stat"><span class="ic">' + ic + '</span><div class="num" style="font-size:1.4rem">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
  }

  /* ---------- tasks ---------- */
  document.getElementById('tkCreate').onclick = async () => {
    const title = document.getElementById('tkTitle').value.trim();
    if(!title){ toast(t('task_name'), 'bad'); return; }
    try {
      const j = await api('/api/tasks', {method: 'POST', body: {
        title,
        description: document.getElementById('tkDesc').value.trim(),
        child_id: parseInt(document.getElementById('tkChild').value, 10) || null,
        difficulty: document.getElementById('tkDiff').value,
        count: parseInt(document.getElementById('tkCount').value, 10) || 5,
        due_days: parseInt(document.getElementById('tkDue').value, 10) || 7
      }});
      toast(t('task_created') + ': ' + j.puzzles + ' ' + t('puzzle_word'), 'ok');
      document.getElementById('tkTitle').value = '';
      document.getElementById('tkDesc').value = '';
      renderTasks();
    } catch(e){ toast(t('error') + ': ' + (e.j && e.j.error ? t('error') + ' (' + e.j.error + ')' : e.message), 'bad'); }
  };

  async function renderTasks(){
    const box = document.getElementById('taskBox');
    let tasks = [];
    try { tasks = (await api('/api/tasks')).tasks; } catch(e){}
    if(!tasks.length){ box.innerHTML = '<div class="empty">' + t('no_tasks') + '</div>'; return; }
    box.innerHTML = tasks.map(tk =>
      '<div style="border-radius:16px;padding:14px;background:var(--surface2);box-shadow:var(--sh-sm)">' +
      '<div class="flex spread" style="margin-bottom:8px">' +
      '<b>' + esc(tk.title) + '</b>' +
      '<span class="chip">' + (tk.child_name ? esc(tk.child_name) : t('all_students')) + ' · ' + tk.total + ' ' + t('puzzle_word') + '</span></div>' +
      (tk.description ? '<p class="muted mb" style="font-size:.8rem">' + esc(tk.description) + '</p>' : '') +
      '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">' +
      tk.items.map(it =>
        '<div class="flex spread" style="font-size:.8rem">' +
        '<span>' + esc(it.name) + '</span>' +
        '<span class="chip ' + (it.status === 'done' ? 'c-ok' : 'c-warn') + '" style="padding:3px 10px">' + it.solved + '/' + tk.total + '</span></div>'
      ).join('') + '</div>' +
      '<div class="flex spread"><span class="muted" style="font-size:.72rem">' + fmtDate(tk.created_at) + '</span>' +
      '<button class="btn btn-sm b-danger" data-del="' + tk.id + '">' + t('delete') + '</button></div>' +
      '</div>'
    ).join('');
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      confirmDialog(t('delete_confirm'), async () => {
        await api('/api/tasks/' + b.dataset.del, {method: 'DELETE'}).catch(()=>{});
        renderTasks();
      });
    });
  }

  /* ---------- videos & sections ---------- */
  async function loadContent(){
    try {
      const j = await api('/api/content');
      sectionsCache = j.sections;
      fillChildSelect();
      renderVideoList(j.videos);
    } catch(e){}
  }
  async function renderVideos(){
    await loadContent();
  }

  function renderVideoList(vids){
    const box = document.getElementById('videoList');
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

  document.getElementById('secAdd').onclick = async () => {
    const title = document.getElementById('secTitle').value.trim();
    if(!title){ toast(t('section_title'), 'bad'); return; }
    try {
      await api('/api/sections', {method: 'POST', body: {title}});
      document.getElementById('secTitle').value = '';
      loadContent();
    } catch(e){ toast(t('error'), 'bad'); }
  };

  document.getElementById('vidAdd').onclick = async () => {
    const title = document.getElementById('vidTitle').value.trim();
    const url = document.getElementById('vidUrl').value.trim();
    const file = document.getElementById('vidFile').files[0];
    const sectionId = parseInt(document.getElementById('vidSection').value, 10) || null;
    if(!file && !url){ toast(t('youtube_url') + ' / ' + t('upload_file'), 'bad'); return; }
    const btn = document.getElementById('vidAdd');
    btn.disabled = true;
    try {
      if(file){
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', title);
        fd.append('section_id', sectionId || '');
        await api('/api/videos', {method: 'POST', body: fd, kind: 'file'});
        document.getElementById('vidFile').value = '';
      } else {
        await api('/api/videos', {method: 'POST', body: {kind: 'youtube', url, title, section_id: sectionId}});
        document.getElementById('vidUrl').value = '';
      }
      document.getElementById('vidTitle').value = '';
      toast(t('ev_video_added'), 'ok');
      loadContent();
    } catch(e){
      toast(t('error') + ': ' + (e.j && e.j.error ? e.j.error : e.message), 'bad');
    }
    btn.disabled = false;
  };

  await Promise.all([loadStudents(), loadContent()]);
})();
