'use strict';

// Все данные хранятся только на телефоне (localStorage).
const KEY = 'antiludo-v1';
const DAY = 86400000;
const CRAVING_MIN = 15;
// Домены казино для проверки блокировки (есть во всех gambling-списках).
const PROBE_CASINOS = ['joycasino.com', 'vavada.com', '1xbet.com'];
// Свой DNS-фильтр на Cloudflare (папка antiludo-filter).
const FILTER_URL = 'https://antiludo.antiludo-7341.workers.dev/dns-query';

const $ = (id) => document.getElementById(id);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
const state = Object.assign({
  start: null, perDay: 0, best: 0, wins: 0, slips: [],
  reasons: [], name: '', phone: '', sosUntil: 0, lastCheck: null,
}, load());
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const money = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
function daysClean() {
  if (!state.start) return 0;
  const [y, m, d] = state.start.split('-').map(Number);
  return Math.max(0, Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / DAY));
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Главная ----------
function renderHome() {
  $('setup').hidden = !!state.start;
  $('streak').hidden = !state.start;
  if (!state.start) $('sStart').value = todayStr();

  const n = daysClean();
  $('days').textContent = n;
  $('daysWord').textContent = plural(n, 'день', 'дня', 'дней');
  $('saved').textContent = state.perDay > 0 ? 'Сохранено: ' + money(n * state.perDay) : '';
  const extra = [];
  if (state.best > n) extra.push('Рекорд: ' + state.best + ' ' + plural(state.best, 'день', 'дня', 'дней'));
  if (state.wins > 0) extra.push('Тяга побеждена: ' + state.wins + ' ' + plural(state.wins, 'раз', 'раза', 'раз'));
  $('best').textContent = extra.join(' · ');

  renderReasons($('reasons'), true);
  renderBanner();
}

function renderReasons(ul, editable) {
  if (!state.reasons.length) {
    ul.innerHTML = editable ? '<li class="empty">Например: «Хочу закрыть долги», «Ради семьи»</li>' : '';
    return;
  }
  ul.innerHTML = state.reasons.map((r, i) =>
    '<li><span>' + esc(r) + '</span>' +
    (editable ? '<button type="button" class="del" data-i="' + i + '" aria-label="Удалить">×</button>' : '') +
    '</li>').join('');
}

function renderBanner() {
  const c = state.lastCheck;
  const b = $('protBanner');
  if (c && c.protected) { b.innerHTML = ''; return; }
  b.innerHTML = '<div class="banner bad">' +
    (c ? 'Казино на этом телефоне не блокируются.' : 'Блокировка казино ещё не проверена.') +
    ' <a href="#" id="goProtect">Включить защиту →</a></div>';
  $('goProtect').onclick = (e) => { e.preventDefault(); show('protect'); };
}

$('sSave').onclick = () => {
  state.start = $('sStart').value || todayStr();
  state.perDay = parseFloat(String($('sPerDay').value).replace(',', '.').replace(/\s/g, '')) || 0;
  save();
  renderHome();
};

$('reasonForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('reasonInput').value.trim();
  if (!v) return;
  state.reasons.push(v);
  $('reasonInput').value = '';
  save();
  renderHome();
};
$('reasons').onclick = (e) => {
  const btn = e.target.closest('.del');
  if (!btn) return;
  state.reasons.splice(Number(btn.dataset.i), 1);
  save();
  renderHome();
};

$('slipBtn').onclick = () => {
  if (!state.start) return;
  if (!confirm('Ничего страшного, так бывает. Счётчик начнётся заново, рекорд сохранится. Продолжить?')) return;
  state.best = Math.max(state.best, daysClean());
  state.slips.push(todayStr());
  state.start = todayStr();
  save();
  renderHome();
  toast('Начинаем заново. Ты уже знаешь, что можешь.');
};

// ---------- Режим «Хочется играть» ----------
let sosTimer = null, breathTimer = null;

function openSos() {
  if (!state.sosUntil || state.sosUntil < Date.now()) {
    state.sosUntil = Date.now() + CRAVING_MIN * 60000;
    save();
  }
  renderReasons($('sosReasons'), false);
  const call = $('callBtn');
  call.hidden = !state.phone;
  if (state.phone) {
    call.href = 'tel:' + state.phone.replace(/[^\d+]/g, '');
    call.textContent = 'Позвонить' + (state.name ? ': ' + state.name : '');
  }
  $('sosScreen').hidden = false;
  tickSos();
  sosTimer = setInterval(tickSos, 1000);
  breathe();
}

function tickSos() {
  const left = Math.max(0, state.sosUntil - Date.now());
  const s = Math.ceil(left / 1000);
  $('timer').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  if (left <= 0) closeSos(true);
}

// Дыхание 4-4-6: вдох, задержка, выдох.
function breathe() {
  const steps = [['Вдох', 4000, true], ['Задержка', 4000, true], ['Выдох', 6000, false]];
  let i = 0;
  const run = () => {
    const [word, ms, big] = steps[i];
    $('breathWord').textContent = word;
    $('circle').classList.toggle('in', big);
    i = (i + 1) % steps.length;
    breathTimer = setTimeout(run, ms);
  };
  run();
}

function closeSos(win) {
  clearInterval(sosTimer);
  clearTimeout(breathTimer);
  $('sosScreen').hidden = true;
  state.sosUntil = 0;
  if (win) state.wins += 1;
  save();
  renderHome();
  if (win) toast('Ты справился. Это победа.');
}

$('sosBtn').onclick = openSos;
$('sosDone').onclick = () => closeSos(true);

// ---------- Проверка защиты ----------
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
// Открывается ли сайт: no-cors запрос проходит, если домен доступен,
// и падает, если фильтр подменил его адрес.
function reachable(domain) {
  return withTimeout(fetch('https://' + domain + '/favicon.ico?_=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }), 7000)
    .then(() => true, () => false);
}

async function runCheck() {
  const out = $('checkResult');
  const btn = $('checkBtn');
  btn.disabled = true;
  out.textContent = 'Проверяю…';
  const online = await reachable('www.google.com');
  if (!online) {
    out.innerHTML = '<div class="big no">Нет интернета</div>Подключись к сети и попробуй снова.';
    btn.disabled = false;
    return;
  }
  const open = await Promise.all(PROBE_CASINOS.map(reachable));
  const isProtected = open.every((o) => !o);
  state.lastCheck = { protected: isProtected, at: Date.now() };
  save();

  let html = isProtected
    ? '<div class="big ok">Защита работает</div>'
    : '<div class="big no">Казино открываются</div>';
  html += '<ul>' + PROBE_CASINOS.map((d, i) => '<li>' + d + ' — ' + (open[i] ? '<b class="no">открывается</b>' : '<span class="ok">заблокирован</span>') + '</li>').join('') + '</ul>';
  if (!isProtected) html += '<p class="hint">Если профиль уже стоит: Настройки → Основные → VPN и управление устройством → DNS — выбери «Блокировка казино».</p>';
  out.innerHTML = html;
  btn.disabled = false;
  renderBanner();
}
$('checkBtn').onclick = runCheck;

// ---------- Профиль защиты (.mobileconfig) ----------
// Профиль собирает сервер фильтра: iPhone ставит профиль только из обычной
// загрузки с сервера. Пароль уходит в теле POST-запроса и нигде не хранится.
$('profileForm').action = FILTER_URL.replace('/dns-query', '/profile');
$('profileForm').onsubmit = (e) => {
  if (navigator.standalone) {
    e.preventDefault();
    toast('Открой этот сайт в Safari — с экрана «Домой» iPhone не даёт ставить профили');
    return;
  }
  if (!$('pPass').value && !confirm('Без пароля профиль можно будет удалить в любой момент. Всё равно скачать?')) e.preventDefault();
};

// ---------- Помощь ----------
$('hName').value = state.name;
$('hPhone').value = state.phone;
$('hName').oninput = () => { state.name = $('hName').value.trim(); save(); };
$('hPhone').oninput = () => { state.phone = $('hPhone').value.trim(); save(); };

// ---------- Вкладки ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo(0, 0);
  if (view === 'protect' && !$('checkBtn').disabled && !show.checked) { show.checked = true; runCheck(); }
}
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => show(b.dataset.view); });

renderHome();
if (state.sosUntil > Date.now()) openSos();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
