/* GrandMaster64 — parent page */
(async function(){
  await loadMe();
  initTopbar();
  applyI18n();
  document.addEventListener('langchange', () => { applyI18n(); if(curChild) showChild(curChild); });
  const me = APP_ME && APP_ME.user;
  if(!me || !['parent', 'admin'].includes(me.role)){ location.href = '/'; return; }

  const kids = (APP_ME.children || []).filter(c => c.role === 'child');
  let curChild = null;

  if(!kids.length){
    document.getElementById('parentEmpty').classList.remove('hidden');
    return;
  }

  const bar = document.getElementById('kidsBar');
  bar.innerHTML = kids.map(k =>
    '<button class="tab" data-kid="' + k.id + '"><span class="avatar" style="width:26px;height:26px;font-size:.65rem;margin-inline-end:6px">' + initials(k.name) + '</span>' + esc(k.name) + '</button>'
  ).join('');
  bar.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => showChild(parseInt(b.dataset.kid, 10), b));

  async function showChild(uid, btn){
    curChild = uid;
    bar.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === btn));
    const box = document.getElementById('childView');
    box.innerHTML = '<div class="card empty">' + t('loading') + '</div>';
    let j;
    try { j = await api('/api/students/' + uid); } catch(e){ box.innerHTML = '<div class="card empty">' + t('error') + '</div>'; return; }
    const s = j.stats, c = j.child;
    const hintEvents = j.events.filter(e => e.type === 'hint_used');
    const mistakeEvents = j.events.filter(e => e.type === 'puzzle_mistake');
    const videoEvents = j.events.filter(e => e.type === 'video_complete');
    box.innerHTML =
      '<div class="grid g4" style="margin-bottom:18px">' +
      cell('🏆', s.total_solved, t('total_solved')) +
      cell('💡', s.hints, t('hints_used')) +
      cell('🎯', s.accuracy + '%', t('accuracy')) +
      cell('⏱', fmtSecs(s.avg_secs), t('avg_time')) +
      '</div>' +
      '<div class="grid g4" style="margin-bottom:18px">' +
      cell('🔥', s.streak, t('streak')) +
      cell('✅', s.tasks_done, t('tasks')) +
      cell('🎬', s.videos_done, t('lessons')) +
      cell('⭐', s.best_score, t('best_score')) +
      '</div>' +
      '<div class="grid g2" style="margin-bottom:18px">' +
      '<div class="card"><h3><span class="ic">📈</span>' + t('last14') + '</h3><div id="parChart"></div></div>' +
      '<div class="card"><h3><span class="ic">📋</span>' + t('tasks') + '</h3><div id="parTasks">' +
        (j.task_items.length ? j.task_items.map(it =>
          '<div class="flex spread mb" style="font-size:.85rem"><span>' + esc(it.task_title) + '</span>' +
          '<span class="chip ' + (it.status === 'done' ? 'c-ok' : 'c-warn') + '">' + it.solved + '/' + it.total + (it.status === 'done' ? ' ✓' : '') + '</span></div>'
        ).join('') : '<span class="muted">' + t('no_tasks') + '</span>') +
      '</div></div></div>' +
      '<div class="grid g2" style="margin-bottom:18px">' +
      '<div class="card"><h3><span class="ic">💡</span>' + t('hints_report') + '</h3>' +
        '<p class="muted mb">' + hintEvents.length + ' × ' + t('ev_hint') +
        ' · ' + mistakeEvents.length + ' × ' + t('ev_puzzle_mistake') +
        ' · ' + videoEvents.length + ' × ' + t('ev_video_complete') + '</p>' +
        '<div class="log" id="parHints"></div>' +
      '</div>' +
      '<div class="card"><h3><span class="ic">🕘</span>' + t('my_activity') + '</h3><div class="log" id="parLog"></div></div>' +
      '</div>';
    barChart(document.getElementById('parChart'), s.series, 'solved');
    renderLog(document.getElementById('parHints'), j.events.filter(e => ['hint_used', 'puzzle_mistake', 'puzzle_solved'].includes(e.type)).slice(0, 30));
    renderLog(document.getElementById('parLog'), s.recent);
  }

  function cell(ic, num, lbl){
    return '<div class="stat"><span class="ic">' + ic + '</span><div class="num" style="font-size:1.5rem">' + num + '</div><div class="lbl">' + lbl + '</div></div>';
  }

  showChild(kids[0].id, bar.querySelector('[data-kid]'));
})();
