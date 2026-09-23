(async function(){
  await loadMe();
  initTopbar();
  applyI18n();
  const banner = document.getElementById('banner');
  let mode = 'login';

  function setMode(m){
    mode = m;
    document.getElementById('tabLogin').classList.toggle('active', m === 'login');
    document.getElementById('tabReg').classList.toggle('active', m === 'reg');
    document.getElementById('roleField').style.display = m === 'reg' ? '' : 'none';
    document.getElementById('authBtn').textContent = t(m === 'reg' ? 'register' : 'login');
    banner.className = 'banner';
  }
  document.getElementById('tabLogin').onclick = () => setMode('login');
  document.getElementById('tabReg').onclick = () => setMode('reg');

  document.getElementById('authForm').onsubmit = async e => {
    e.preventDefault();
    const user = document.getElementById('fUser').value.trim();
    const pass = document.getElementById('fPass').value;
    const name = document.getElementById('fName').value.trim();
    const btn = document.getElementById('authBtn');
    btn.disabled = true;
    try {
      if(mode === 'login'){
        await api('/api/auth/login', {method: 'POST', body: {username: user, password: pass}});
      } else {
        await api('/api/auth/register', {method: 'POST', body: {
          username: user, password: pass, name,
          role: document.getElementById('regRole').value
        }});
      }
      location.href = '/';
    } catch(err){
      const map = {wrong: 'wrong_creds', taken: 'username_taken', weak: 'weak', closed: 'closed'};
      banner.textContent = t(map[err.j && err.j.error] || err.message);
      banner.className = 'banner show bad';
    }
    btn.disabled = false;
  };

  document.addEventListener('langchange', () => applyI18n());
  setMode('login');
})();
