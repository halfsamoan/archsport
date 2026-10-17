(() => {
  'use strict';
  // Actual club crests from the documented provider media API, bundled offline.
  for (const [selector, id, name] of [
    ['.team-mark.fcb, .mini-team, .tiny-mark:not(.blue)', 529, 'FC Barcelona'],
    ['.team-mark.inter, .tiny-mark.blue', 505, 'Inter'],
  ]) {
    document.querySelectorAll(selector).forEach(mark => {
      const crest = document.createElement('img');
      crest.src = `assets/logos/${id}.png`;
      crest.alt = name;
      crest.width = 48;
      crest.height = 48;
      mark.replaceChildren(crest);
      mark.classList.add('real-logo');
    });
  }
  const notch = document.querySelector('#notch');
  const announcement = document.querySelector('#announcement');
  let mode = 'expanded';
  let home = 1;
  let eventTimer;
  let goalVersion = 0;
  let settings = {reduce: false, spoiler: false, following: true};
  try { settings = {...settings, ...JSON.parse(localStorage.getItem('archsport-preview') || '{}')}; } catch {}
  function save() { try { localStorage.setItem('archsport-preview', JSON.stringify(settings)); } catch {} }
  function paintSettings() {
    document.body.classList.toggle('reduced-motion', settings.reduce);
    document.body.classList.toggle('spoiler', settings.spoiler);
    document.querySelector('#reduce-motion').checked = settings.reduce;
    document.querySelector('#spoiler').checked = settings.spoiler;
    const follow = document.querySelector('#follow');
    follow.textContent = settings.following ? '선택됨' : '선택하기';
    follow.setAttribute('aria-pressed', String(settings.following));
    document.querySelector('.following div>span').textContent = settings.following ? '선택한 팀' : '시연 팀 · 선택 해제됨';
  }
  function scores() {
    document.querySelector('.compact-score').textContent = `${home} : 1`;
    document.querySelector('.home-score').textContent = String(home);
    document.querySelector('#detail-score').textContent = `${home} : 1`;
  }
  function setMode(next) {
    clearTimeout(eventTimer);
    const hiddenScore = settings.spoiler;
    if (next === 'event' && hiddenScore) {
      announcement.textContent = '스포일러 숨기기가 켜져 있어 득점 알림을 표시하지 않습니다.';
      return;
    }
    mode = next;
    notch.dataset.mode = mode;
    notch.setAttribute('aria-expanded', String(mode !== 'compact'));
    notch.setAttribute('aria-label', `바르셀로나 경기 노치. ${hiddenScore ? '점수 숨김.' : `${home} 대 1.`} ${mode === 'compact' ? '클릭하면 펼치기' : '클릭하면 접기'}`);
    document.querySelectorAll('.mode-controls [data-mode]').forEach(button => {
      button.classList.toggle('selected', button.dataset.mode === mode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
    notch.classList.remove('goal-pulse');
    if (mode === 'event') {
      home = 2;
      scores();
      const version = ++goalVersion;
      requestAnimationFrame(() => { if (version === goalVersion && mode === 'event') notch.classList.add('goal-pulse'); });
      announcement.textContent = '시연 알림. 바르셀로나 득점. 2 대 1. 실제 경기 정보가 아닙니다.';
      eventTimer = setTimeout(() => setMode('compact'), 6000);
    } else {
      announcement.textContent = mode === 'expanded' ? '시연 경기 노치를 펼쳤습니다.' : '시연 경기 노치를 접었습니다.';
    }
  }
  document.querySelectorAll('[data-mode]:not(#notch)').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  notch.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    setMode(mode === 'compact' ? 'expanded' : 'compact');
  });
  notch.addEventListener('keydown', event => {
    if (event.target !== notch) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMode(mode === 'compact' ? 'expanded' : 'compact'); }
    if (event.key === 'Escape') setMode('compact');
  });
  document.querySelector('#collapse').addEventListener('click', () => setMode('compact'));
  for (const [trigger, dialog] of [['detail-open', 'details'], ['settings-open', 'preferences'], ['team-open', 'teams']]) {
    document.getElementById(trigger).addEventListener('click', () => document.getElementById(dialog).showModal());
  }
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  document.querySelector('#reduce-motion').addEventListener('change', event => { settings.reduce = event.target.checked; save(); paintSettings(); });
  document.querySelector('#spoiler').addEventListener('change', event => {
    settings.spoiler = event.target.checked;
    if (settings.spoiler && mode === 'event') setMode('compact');
    save(); paintSettings(); setMode(mode);
  });
  document.querySelector('#follow').addEventListener('click', () => { settings.following = !settings.following; save(); paintSettings(); });
  document.querySelector('#team-search').addEventListener('input', event => {
    const value = event.target.value.trim().toLowerCase();
    const found = ['fc barcelona', '바르셀로나', '바르사'].some(name => name.includes(value));
    document.querySelector('#team-result').hidden = !found;
    document.querySelector('#team-result').style.display = found ? 'flex' : 'none';
    document.querySelector('#search-empty').hidden = found;
  });
  document.querySelector('#connection-toggle').addEventListener('click', event => {
    const offline = document.body.classList.toggle('offline');
    document.querySelector('.notch-live').innerHTML = offline ? '<i></i>연결 끊김' : '<i></i>후반 67′';
    document.querySelector('#last-play').textContent = offline ? '마지막 수신 정보 · 재연결 대기' : '바르셀로나, 공격 전개';
    event.target.textContent = offline ? '연결 복구 시연' : '오프라인 시연';
    announcement.textContent = offline ? '오프라인 시연. 마지막 정보를 유지합니다.' : '데모 연결이 복구되었습니다.';
  });
  paintSettings();
  setMode('expanded');
})();
