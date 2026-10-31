import { splitBill } from './split.js';

const root = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const state = { group: null, token: '', kitchenToken: '', kitchen: null, dialog: null, dishes: [], allergens: [], filter: 'Усі', tipPercent: 10, busy: false };
const currency = value => `${new Intl.NumberFormat('uk-UA').format(value)} ₴`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function dateText(value, timeZone, utcOffsetMinutes) {
  const hasOffset = Number.isInteger(utcOffsetMinutes);
  const date = new Date(new Date(value).getTime() + (hasOffset ? utcOffsetMinutes * 60_000 : 0));
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'full', timeStyle: 'short', timeZone: hasOffset ? 'UTC' : timeZone || undefined }).format(date);
}
function timeLabel(timeZone, utcOffsetMinutes) {
  if (!Number.isInteger(utcOffsetMinutes)) return timeZone || 'місцевий час';
  const sign = utcOffsetMinutes < 0 ? '−' : '+';
  const absolute = Math.abs(utcOffsetMinutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
function dishCount(count) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} страв`;
  const last = count % 10;
  return `${count} ${last === 1 ? 'страва' : last >= 2 && last <= 4 ? 'страви' : 'страв'}`;
}

async function api(path, { method = 'GET', data, token = state.token } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не вдалося виконати дію.');
  return result;
}
function notify(message, error = false) {
  toastNode.textContent = message;
  toastNode.className = error ? 'show error' : 'show';
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toastNode.className = ''; }, 4500);
}
function saveIdentity(group, token, kitchenToken = '') {
  state.group = group;
  state.token = token;
  state.kitchenToken = kitchenToken;
  localStorage.setItem('tablemate', JSON.stringify({ groupId: group.id, token, kitchenToken }));
  history.replaceState({}, '', '/');
  render();
  window.scrollTo(0, 0);
}
async function refresh() {
  if (!state.group) return;
  state.group = await api(`/groups/${state.group.id}`);
  render();
}
async function run(work) {
  if (state.busy) return;
  state.busy = true;
  try { await work(); } catch (error) { notify(error.message, true); }
  finally { state.busy = false; }
}
function dishCard(dish, quantity, editable) {
  return `<article class="dish-card ${dish.color}">
    <div class="dish-art"><span aria-hidden="true">${dish.icon}</span><img src="${escapeHtml(dish.image)}" alt="${escapeHtml(dish.name)}" loading="lazy" decoding="async"></div>
    <div class="dish-content"><div class="dish-top"><span class="eyebrow">${escapeHtml(dish.category)}</span><strong>${currency(dish.price)}</strong></div>
      <h3>${escapeHtml(dish.name)}</h3><p>${escapeHtml(dish.description)}</p>
      <div class="dish-bottom"><small>${dish.allergens.length ? `Містить: ${escapeHtml(dish.allergens.join(', '))}` : 'Без вказаних алергенів'}</small>
        ${editable ? `<div class="stepper"><button type="button" data-action="decrease" data-id="${dish.id}" aria-label="Зменшити ${escapeHtml(dish.name)}">−</button><span>${quantity}</span><button type="button" data-action="increase" data-id="${dish.id}" aria-label="Додати ${escapeHtml(dish.name)}">+</button></div>` : ''}
      </div></div></article>`;
}
function menuPanel(session) {
  const editable = Boolean(session) && !session.isSubmitted && state.group.status === 'Open';
  const quantities = Object.fromEntries((session?.items || []).map(item => [item.dish.id, item.quantity]));
  const visible = state.filter === 'Усі' ? state.dishes : state.dishes.filter(d => d.category === state.filter);
  return `<section class="menu-panel" id="menu"><div class="section-heading"><div><span class="eyebrow">ВИБІР СМАКУ</span><h2>Меню вечора</h2></div><p>Зберіть свій кошик. Після підтвердження його вже не можна змінити.</p></div>
    <div class="filters" role="group" aria-label="Категорія страв">${['Усі', 'Закуски', 'Основні страви', 'Десерти'].map(category => `<button type="button" class="chip ${state.filter === category ? 'active' : ''}" data-action="filter" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}</div>
    <div class="dish-grid">${visible.map(d => dishCard(d, quantities[d.id] || 0, editable)).join('')}</div>
    ${session ? `<div class="cart-footer"><div><span>Мій кошик</span><strong>${currency(session.total)}</strong></div>${session.isSubmitted ? '<span class="pill done">✓ Підтверджено</span>' : `<button class="button primary" type="button" data-action="submit-cart" ${session.items.length ? '' : 'disabled'}>Підтвердити мій кошик <span>↗</span></button>`}</div>` : ''}
  </section>`;
}
function participantCard(participant) {
  const isOwner = participant.type === 'Owner';
  return `<article class="person-card"><div class="person-head"><div class="avatar ${isOwner ? 'owner-avatar' : ''}">${escapeHtml(participant.name.slice(0, 1).toUpperCase())}</div><div class="person-name"><h3>${escapeHtml(participant.name)} ${isOwner ? '<span class="owner-tag">організатор</span>' : ''}</h3><p>${dishCount(participant.items.length)} · ${participant.isSubmitted ? 'кошик підтверджено' : 'ще обирає'}</p></div><span class="status-dot ${participant.isSubmitted ? 'ready' : ''}" title="${participant.isSubmitted ? 'Підтверджено' : 'Ще обирає'}"></span></div>
    ${participant.items.length ? `<ul class="person-items">${participant.items.map(item => `<li><span>${escapeHtml(item.dish.icon)} ${escapeHtml(item.dish.name)} <small>× ${item.quantity}</small></span><strong>${currency(item.dish.price * item.quantity)}</strong></li>`).join('')}</ul>` : '<p class="empty-items">Кошик поки порожній</p>'}
    <div class="person-foot"><span>${participant.avoid.length ? `Уникає: ${escapeHtml(participant.avoid.join(', '))}` : 'Обмеження не вказані'}</span><strong>${currency(participant.total)}</strong></div>
    ${!isOwner && state.group.status === 'Open' ? `<button class="text-button remove" type="button" data-action="remove" data-id="${participant.id}" data-name="${escapeHtml(participant.name)}">Видалити гостя ↗</button>` : ''}</article>`;
}
function insightPanel() {
  const { budgetTotal, remaining, waiting, conflicts, swap } = state.group.insights;
  const progress = Math.min(100, Math.round(budgetTotal / state.group.budget * 100));
  return `<aside class="insight-card"><div class="insight-title"><span class="sparkle">✳</span><div><span class="eyebrow">РОЗУМНІ ПІДКАЗКИ</span><h2>Баланс столу</h2></div></div>
    <p>${state.group.status === 'Submitted' ? 'Передано на кухню' : 'Усі кошики проти бюджету'}</p><div class="budget-row"><strong>${currency(budgetTotal)}</strong><span>із ${currency(state.group.budget)}</span></div>
    <div class="meter" role="progressbar" aria-label="Використано бюджету" aria-valuenow="${Math.min(100, Math.round(budgetTotal / state.group.budget * 100))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress}%" class="${remaining < 0 ? 'over' : ''}"></span></div>
    <p class="budget-note ${remaining < 0 ? 'warning' : ''}">${remaining >= 0 ? `Залишилось ${currency(remaining)} на нові страви` : `Перевищення на ${currency(-remaining)}`}</p>
    ${swap ? `<div class="tip"><span>💡</span><p>Щоб зменшити суму на <strong>${currency(swap.saving)}</strong>, ${escapeHtml(swap.participant)} може замінити «${escapeHtml(swap.from)}» на «${escapeHtml(swap.to)}».</p></div>` : ''}
    ${waiting.length ? `<div class="tip amber"><span>⏳</span><p>${state.group.status === 'Submitted' ? 'Не увійшли до замовлення' : 'Ще обирають'}: <strong>${escapeHtml(waiting.join(', '))}</strong>.</p></div>` : ''}
    ${conflicts.length ? `<div class="tip coral"><span>⚠</span><p>Перевірте алергени: ${conflicts.map(c => `${escapeHtml(c.participant)} — ${escapeHtml(c.dish)} (${escapeHtml(c.allergens.join(', '))})`).join('; ')}.</p></div>` : ''}
    ${state.group.status === 'Open' ? `<form id="budget-form" class="budget-form"><label for="budget">Змінити бюджет</label><div><input id="budget" name="budget" type="number" min="100" max="100000" step="1" value="${state.group.budget}" required><button type="submit" aria-label="Зберегти бюджет">→</button></div></form>` : ''}
    <small class="disclaimer">Інформація про алергени довідкова: уточнюйте склад у ресторані.</small></aside>`;
}
function splitPanel() {
  const group = state.group;
  const participants = group.status === 'Submitted' ? group.participants.filter(person => person.isSubmitted) : group.participants;
  const bill = splitBill(participants, state.tipPercent);
  return `<section class="split-panel" id="split"><div class="split-heading"><div><span class="eyebrow">ДОДАТКОВА ФУНКЦІЯ</span><h2>Розділити рахунок</h2><p>${group.status === 'Submitted' ? 'Розрахунок за кошиками, переданими на кухню.' : 'Попередній розрахунок за поточними кошиками всіх учасників.'}</p></div><div class="tip-selector"><span>Чайові</span><div role="group" aria-label="Відсоток чайових">${[0, 5, 10, 15].map(percent => `<button type="button" data-action="tip" data-percent="${percent}" aria-pressed="${state.tipPercent === percent}" class="chip ${state.tipPercent === percent ? 'active' : ''}">${percent}%</button>`).join('')}</div></div></div><div class="split-rows">${bill.rows.length ? bill.rows.map(person => `<div class="split-row"><span>${escapeHtml(person.name)}<small>${currency(person.subtotal)} + ${currency(person.tip)} чайових</small></span><strong>${currency(person.total)}</strong></div>`).join('') : '<p class="split-empty">Додайте страви, щоб побачити розрахунок.</p>'}</div><div class="split-total"><span>Разом: ${currency(bill.subtotal)} + ${currency(bill.tip)} чайових</span><strong>${currency(bill.total)}</strong></div><small>Розрахунок орієнтовний. Оплата відбувається поза застосунком.</small></section>`;
}
function orderPanel() {
  if (!state.group.order) return '';
  return `<section class="order-panel"><div><span class="eyebrow">ДЛЯ КУХНІ</span><h2>Підсумкове замовлення</h2><p>Однакові страви об’єднано; непідтверджені кошики не враховано.</p></div><ul>${state.group.order.items.map(item => {
    const dish = state.dishes.find(d => d.id === item.dishId);
    return `<li><span>${dish?.icon || ''} ${escapeHtml(dish?.name || item.dishId)}</span><strong>× ${item.quantity}</strong></li>`;
  }).join('')}</ul></section>`;
}
function dashboard() {
  const group = state.group;
  const own = group.participants.find(p => p.id === group.mySessionId);
  const isOwner = group.role === 'owner';
  const invite = `${location.origin}/join?group=${encodeURIComponent(group.id)}&invite=${encodeURIComponent(group.inviteCode || '')}`;
  return `<header class="site-header"><a href="/" class="brand" aria-label="Tablemate, головна"><span class="brand-mark">✳</span><span>tablemate<span class="brand-period">.</span></span></a><nav><a href="#table">Мій стіл</a><a href="#menu">Меню</a><button type="button" class="logout" data-action="leave">Вийти ↗</button></nav></header>
    <main><section class="dashboard-hero" id="table"><div class="hero-copy"><span class="eyebrow light">СПІЛЬНА ВЕЧЕРЯ БЕЗ ХАОСУ</span><h1>${escapeHtml(group.title)}</h1><p>${dateText(group.serviceAt, group.timeZone, group.utcOffsetMinutes)} · ${group.participants.length} із ${group.guestLimit} місць <small>(${escapeHtml(timeLabel(group.timeZone, group.utcOffsetMinutes))})</small></p><div class="hero-actions">${isOwner ? `<button class="button cream" type="button" data-action="copy">Скопіювати запрошення <span>↗</span></button>${state.kitchenToken ? '<button class="button outline-light" type="button" data-action="open-kitchen">Кухонний талон ↗</button><button class="button outline-light" type="button" data-action="copy-kitchen">Скопіювати талон ↗</button>' : ''}` : '<span class="pill hero-pill">Ви приєдналися до столу</span>'}<span class="pill ${group.status === 'Submitted' ? 'submitted' : ''}">${group.status === 'Submitted' ? '✓ Передано на кухню' : '● Збираємо замовлення'}</span></div></div><div class="hero-decoration" aria-hidden="true"><div class="plate"><span>✳</span></div><span class="orbit orbit-one">✦</span><span class="orbit orbit-two">✳</span></div></section>
    ${isOwner ? `<section class="dashboard-grid"><div><div class="section-heading"><div><span class="eyebrow">УСІ ЗА ОДНИМ СТОЛОМ</span><h2>Хто що замовив</h2></div><p>Слідкуйте за кошиками гостей і відправляйте одне замовлення.</p></div><div class="people-grid">${group.participants.map(participantCard).join('')}</div><div class="total-bar"><div><span>Сума всіх кошиків</span><strong>${currency(group.insights.total)}</strong><small>До кухні: ${currency(group.insights.submittedTotal)}</small></div><button class="button primary" type="button" data-action="submit-group" ${group.status !== 'Open' || group.insights.submittedTotal === 0 ? 'disabled' : ''}>${group.status === 'Submitted' ? 'Замовлення на кухні ✓' : 'Передати замовлення'} <span>↗</span></button></div></div>${insightPanel()}</section>${splitPanel()}${orderPanel()}` : `<section class="guest-intro"><span class="eyebrow">ВАШЕ ПЕРЕДЗАМОВЛЕННЯ</span><h2>Обирайте те, що смакує вам</h2><p>Ваш кошик бачить організатор. Перед відправкою перевірте страви та алергени.</p>${own?.avoid.length ? `<div class="allergy-note">Позначені обмеження: ${escapeHtml(own.avoid.join(', '))}</div>` : ''}</section>`}
    ${menuPanel(own)}<footer class="footer"><span>tablemate<span class="brand-period">.</span></span><p>Створено для EPAM IT Marathon 2026 · Вечеря стає кращою разом.</p></footer></main>`;
}
function welcome() {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  const groupId = params.get('group');
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dateValue = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return `<header class="site-header"><a href="/" class="brand"><span class="brand-mark">✳</span><span>tablemate<span class="brand-period">.</span></span></a><nav><a href="#how">Як це працює</a><a href="#start">Створити стіл</a></nav></header><main>
    <section class="welcome-hero"><div class="welcome-copy"><span class="eyebrow">ВЕЧЕРЯ ПОЧИНАЄТЬСЯ ТУТ</span><h1>Разом за столом.<br><em>Без плутанини</em><br>у замовленні.</h1><p>Запросіть друзів, дозвольте кожному обрати свої страви й зберіть усе в одне зручне передзамовлення.</p><a class="button primary" href="#start">Створити свій стіл <span>↗</span></a><div class="welcome-proof"><span>✳</span><p>Одна компанія. Одна вечеря. Жодних нескінченних повідомлень.</p></div></div><div class="welcome-art" aria-hidden="true"><div class="art-plate"><span>🍝</span></div><div class="floating-card top">🍅 <span>Томати й страчатела<br><strong>× 2</strong></span></div><div class="floating-card bottom"><span class="check">✓</span><span>Замовлення зібрано<br><strong>для всієї компанії</strong></span></div><span class="art-star">✳</span></div></section>
    <section class="steps" id="how"><div class="section-heading"><div><span class="eyebrow">ТРИ ПРОСТІ КРОКИ</span><h2>Від ідеї до вечері</h2></div></div><div class="step-grid"><article><span>01</span><h3>Створіть стіл</h3><p>Вкажіть дату, кількість гостей і комфортний бюджет.</p></article><article><span>02</span><h3>Запросіть друзів</h3><p>Кожен збере власний кошик за посиланням.</p></article><article><span>03</span><h3>Підтвердіть разом</h3><p>Перевірте суму, обмеження й відправте спільне замовлення.</p></article></div></section>
    <section class="start-section" id="start"><div><span class="eyebrow light">ВАШ ВЕЧІР ПОЧИНАЄТЬСЯ</span><h2>${invite ? 'Вас запросили до столу' : 'Створімо ваш стіл'}</h2><p>${invite ? 'Назвіть своє ім’я та вкажіть продукти, яких уникаєте.' : 'Це займе хвилину. Після створення ви отримаєте приватне посилання для друзів.'}</p></div>
      ${invite && groupId ? `<form id="join-form" class="start-form"><input type="hidden" name="groupId" value="${escapeHtml(groupId)}"><input type="hidden" name="inviteCode" value="${escapeHtml(invite)}"><label>Ваше ім’я<input name="name" maxlength="50" required placeholder="Наприклад, Олена"></label><fieldset><legend>Що вам не підходить?</legend><div class="allergen-options">${state.allergens.map(a => `<label><input type="checkbox" name="avoid" value="${escapeHtml(a)}"><span>${escapeHtml(a)}</span></label>`).join('')}</div></fieldset><button class="button primary" type="submit">Приєднатися до столу ↗</button></form>` : `<form id="create-form" class="start-form"><label>Назва вечора<input name="title" maxlength="80" required value="Вечеря з друзями"></label><div class="form-row"><label>Ваше ім’я<input name="ownerName" maxlength="50" required placeholder="Наприклад, Ігор"></label><label>Дата й час<input name="serviceAt" type="datetime-local" value="${dateValue}" required></label></div><div class="form-row"><label>Місць за столом<input name="guestLimit" type="number" min="2" max="20" value="5" required></label><label>Бюджет, ₴<input name="budget" type="number" min="100" max="100000" value="1800" required></label></div><button class="button primary" type="submit">Створити стіл ↗</button><button class="text-button demo-button" type="button" data-action="demo">Або подивитися живе демо →</button></form>`}
    </section><footer class="footer"><span>tablemate<span class="brand-period">.</span></span><p>Створено для EPAM IT Marathon 2026 · Вечеря стає кращою разом.</p></footer></main>`;
}
function kitchenScreen() {
  const kitchen = state.kitchen.data;
  const items = kitchen.order?.items || [];
  return `<header class="site-header"><a href="/" class="brand"><span class="brand-mark">✳</span><span>tablemate<span class="brand-period">.</span></span></a><span class="kitchen-label">КУХОННИЙ ТАЛОН</span></header><main class="kitchen-page"><section class="kitchen-sheet"><div class="ticket-top"><span class="eyebrow">ЗАМОВЛЕННЯ ДЛЯ КУХНІ</span><span class="ticket-icon">✳</span></div><h1>${escapeHtml(kitchen.title)}</h1><p>${dateText(kitchen.serviceAt, kitchen.timeZone, kitchen.utcOffsetMinutes)} · ${escapeHtml(timeLabel(kitchen.timeZone, kitchen.utcOffsetMinutes))}</p>${kitchen.status === 'Submitted' ? `<div class="ticket-status">✓ Підтверджено організатором</div><ul class="ticket-items">${items.map(item => {
    const dish = state.dishes.find(d => d.id === item.dishId);
    return `<li><span>${dish?.icon || ''} ${escapeHtml(dish?.name || item.dishId)}</span><strong>× ${item.quantity}</strong></li>`;
  }).join('')}</ul><div class="ticket-total"><span>Позицій</span><strong>${items.reduce((sum, item) => sum + item.quantity, 0)}</strong></div>` : '<div class="ticket-waiting">Замовлення ще збирають. Оновіть сторінку пізніше.</div>'}<button class="button primary" type="button" data-action="refresh-kitchen">Оновити талон ↻</button></section></main>`;
}
function dialog() {
  if (!state.dialog) return '';
  const removing = state.dialog.type === 'remove';
  const title = removing ? `Видалити ${escapeHtml(state.dialog.name)}?` : 'Передати замовлення?';
  const description = removing ? 'Кошик гостя зникне з групи, а загальна сума оновиться.' : `На кухню потраплять лише підтверджені кошики на ${currency(state.group.insights.submittedTotal)}. ${state.group.insights.waiting.length ? `Ще обирають: ${escapeHtml(state.group.insights.waiting.join(', '))}.` : ''}`;
  return `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description"><span class="modal-icon">${removing ? '↗' : '✳'}</span><h2 id="modal-title">${title}</h2><p id="modal-description">${description}</p><div class="modal-actions"><button class="button neutral" type="button" data-action="cancel-dialog">Скасувати</button><button class="button primary" type="button" data-action="confirm-dialog">${removing ? 'Видалити гостя' : 'Передати на кухню'} ↗</button></div></div></div>`;
}
function render() {
  root.innerHTML = state.kitchen ? kitchenScreen() : state.group ? dashboard() + dialog() : welcome();
  if (state.dialog) root.querySelector('[data-action="cancel-dialog"]')?.focus();
}

root.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'create-form') run(async () => {
    const input = Object.fromEntries(new FormData(form));
    const selectedDate = new Date(input.serviceAt);
    const result = await api('/groups', { method: 'POST', data: { title: input.title, ownerName: input.ownerName, serviceAt: selectedDate.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, utcOffsetMinutes: -selectedDate.getTimezoneOffset(), guestLimit: Number(input.guestLimit), budget: Number(input.budget) }, token: '' });
    saveIdentity(result.group, result.token, result.kitchenToken);
    notify('Стіл створено. Запросіть друзів за посиланням.');
  });
  if (form.id === 'join-form') run(async () => {
    const input = new FormData(form);
    const result = await api(`/groups/${input.get('groupId')}/join`, { method: 'POST', data: { inviteCode: input.get('inviteCode'), name: input.get('name'), avoid: input.getAll('avoid') }, token: '' });
    saveIdentity(result.group, result.token);
    notify('Ви приєдналися до столу!');
  });
  if (form.id === 'budget-form') run(async () => {
    state.group = await api(`/groups/${state.group.id}/budget`, { method: 'PATCH', data: { budget: Number(new FormData(form).get('budget')) } });
    render(); notify('Бюджет оновлено.');
  });
});

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'filter') { state.filter = button.dataset.filter; render(); return; }
  if (action === 'tip') { state.tipPercent = Number(button.dataset.percent); render(); return; }
  if (action === 'reload') { location.reload(); return; }
  if (action === 'leave') { localStorage.removeItem('tablemate'); state.group = null; state.token = ''; state.kitchenToken = ''; render(); return; }
  if (action === 'copy') return run(async () => {
    const link = `${location.origin}/join?group=${encodeURIComponent(state.group.id)}&invite=${encodeURIComponent(state.group.inviteCode)}`;
    await navigator.clipboard.writeText(link); notify('Посилання скопійовано.');
  });
  if (action === 'copy-kitchen') return run(async () => {
    const link = `${location.origin}/kitchen#group=${encodeURIComponent(state.group.id)}&key=${encodeURIComponent(state.kitchenToken)}`;
    await navigator.clipboard.writeText(link); notify('Приватне посилання для кухні скопійовано.');
  });
  if (action === 'open-kitchen') {
    location.assign(`/kitchen#group=${encodeURIComponent(state.group.id)}&key=${encodeURIComponent(state.kitchenToken)}`);
    return;
  }
  if (action === 'increase' || action === 'decrease') return run(async () => {
    const session = state.group.participants.find(p => p.id === state.group.mySessionId);
    const items = session.items.map(item => ({ dishId: item.dish.id, quantity: item.quantity }));
    const existing = items.find(item => item.dishId === button.dataset.id);
    if (existing) existing.quantity += action === 'increase' ? 1 : -1;
    else if (action === 'increase') items.push({ dishId: button.dataset.id, quantity: 1 });
    const next = items.filter(item => item.quantity > 0);
    state.group = await api(`/groups/${state.group.id}/sessions/${session.id}/cart`, { method: 'PUT', data: { items: next } });
    render();
  });
  if (action === 'submit-cart') return run(async () => {
    state.group = await api(`/groups/${state.group.id}/sessions/${state.group.mySessionId}/submit`, { method: 'POST' });
    render(); notify('Ваш кошик підтверджено.');
  });
  if (action === 'remove') { state.dialog = { type: 'remove', id: button.dataset.id, name: button.dataset.name }; render(); return; }
  if (action === 'submit-group') { state.dialog = { type: 'submit' }; render(); return; }
  if (action === 'cancel-dialog') { state.dialog = null; render(); return; }
  if (action === 'confirm-dialog') return run(async () => {
    const pending = state.dialog;
    if (pending.type === 'remove') {
      await api(`/groups/${state.group.id}/sessions/${pending.id}`, { method: 'DELETE' });
      state.dialog = null;
      await refresh(); notify('Гостя видалено. Суму перераховано.');
    } else {
      const result = await api(`/groups/${state.group.id}/submit`, { method: 'POST' });
      state.group = result.group; state.dialog = null; render(); notify('Спільне замовлення передано на кухню.');
    }
  });
  if (action === 'refresh-kitchen') return run(async () => {
    state.kitchen.data = await api(`/groups/${state.kitchen.groupId}/kitchen`, { token: state.kitchen.token });
    render(); notify('Талон оновлено.');
  });
  if (action === 'demo') return run(async () => {
    const serviceAt = new Date(Date.now() + 86_400_000).toISOString();
    const created = await api('/groups', { method: 'POST', data: { title: 'Теплий вечір у місті', ownerName: 'Ігор', serviceAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, utcOffsetMinutes: -new Date(serviceAt).getTimezoneOffset(), guestLimit: 5, budget: 1200 }, token: '' });
    const group = created.group;
    const first = await api(`/groups/${group.id}/join`, { method: 'POST', data: { inviteCode: group.inviteCode, name: 'Олена', avoid: ['Молоко'] }, token: '' });
    await api(`/groups/${group.id}/sessions/${first.group.mySessionId}/cart`, { method: 'PUT', data: { items: [{ dishId: 'tofu', quantity: 1 }, { dishId: 'pear', quantity: 1 }] }, token: first.token });
    await api(`/groups/${group.id}/sessions/${first.group.mySessionId}/submit`, { method: 'POST', token: first.token });
    const second = await api(`/groups/${group.id}/join`, { method: 'POST', data: { inviteCode: group.inviteCode, name: 'Марко', avoid: [] }, token: '' });
    await api(`/groups/${group.id}/sessions/${second.group.mySessionId}/cart`, { method: 'PUT', data: { items: [{ dishId: 'fish', quantity: 2 }, { dishId: 'cake', quantity: 1 }] }, token: second.token });
    const refreshed = await api(`/groups/${group.id}`, { token: created.token });
    saveIdentity(refreshed, created.token, created.kitchenToken);
    notify('Демо-стіл готовий. Спробуйте додати страви або змінити бюджет.');
  });
});

root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.dialog) { state.dialog = null; render(); }
});
root.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && event.target.closest('.dish-art')) event.target.hidden = true;
}, true);

async function init() {
  try {
    const menu = await api('/menu', { token: '' });
    state.dishes = menu.dishes; state.allergens = menu.allergens;
    if (location.pathname === '/kitchen') {
      const params = new URLSearchParams(location.hash.slice(1));
      const savedKitchen = JSON.parse(sessionStorage.getItem('tablemate-kitchen') || 'null');
      const groupId = params.get('group') || savedKitchen?.groupId;
      const token = params.get('key') || savedKitchen?.token;
      if (!groupId || !token) throw new Error('Відкрийте приватне посилання, яке надав організатор.');
      sessionStorage.setItem('tablemate-kitchen', JSON.stringify({ groupId, token }));
      history.replaceState({}, '', '/kitchen');
      state.kitchen = { groupId, token, data: await api(`/groups/${encodeURIComponent(groupId)}/kitchen`, { token }) };
      render();
      return;
    }
    const saved = JSON.parse(localStorage.getItem('tablemate') || 'null');
    if (saved?.groupId && saved?.token && !new URLSearchParams(location.search).has('invite')) {
      state.token = saved.token;
      state.kitchenToken = saved.kitchenToken || '';
      try { state.group = await api(`/groups/${saved.groupId}`); }
      catch { localStorage.removeItem('tablemate'); state.token = ''; }
    }
    render();
  } catch (error) { root.innerHTML = `<main class="fatal"><h1>Не вдалося завантажити застосунок</h1><p>${escapeHtml(error.message)}</p><button data-action="reload">Спробувати ще раз</button></main>`; }
}
init();
