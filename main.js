import './style.css'

const STORAGE_KEY = 'bj-contas-v1'
const LEGACY_KEY = 'debt-tracker-v1'
const app = document.querySelector('#app')
const islandRoot = document.querySelector('#dynamic-island')

const currencyFormatter = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})

const defaultState = {
  debts: [],
  expenses: [],
  filter: '',
  view: 'home', // home, debts, work, salaries, stats
  shifts: [],
  hotels: [],
  activityLog: [],
  settings: {},
}



const state = loadState()

function loadState() {
  // migrate from legacy key if present
  const migrated = localStorage.getItem(STORAGE_KEY)
  if (migrated) {
    try {
      const parsed = JSON.parse(migrated)
      return { ...defaultState, ...parsed, activityLog: pruneActivityLog(parsed.activityLog || []) }
    } catch { /* fallthrough */ }
  }
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) {
    try {
      const debts = JSON.parse(legacy)
      const s = { ...defaultState, debts }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
      return s
    } catch {
      return { ...defaultState }
    }
  }
  return { ...defaultState, activityLog: [] }
}

function pruneActivityLog(entries = state.activityLog || []) {
  const cutoff = Date.now() - 72 * 60 * 60 * 1000
  return entries.filter(entry => new Date(entry.createdAt).getTime() >= cutoff)
}

function saveState() {
  state.activityLog = pruneActivityLog(state.activityLog)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function formatMoney(value) {
  return currencyFormatter.format(value)
}

function getTotalOpen() {
  return state.debts.reduce((sum, d) => sum + (d.status === 'open' ? d.remainingAmount : 0), 0)
}

function animateValue(el) {
  if (!el) return
  el.classList.add('pulse')
  setTimeout(() => el.classList.remove('pulse'), 420)
}

function triggerHaptic() {
  if (navigator.vibrate) navigator.vibrate(40)
}

function showDynamicIsland(title, meta, amount) {
  if (!islandRoot) return
  islandRoot.className = 'dynamic-island active expanded'
  islandRoot.innerHTML = `<div class="island"><div style="display:flex;flex-direction:column;align-items:flex-start"><div class=\"title\">${escapeHtml(title)}</div><div class=\"meta\">${escapeHtml(meta)} ${amount ? '<strong style=\"margin-left:6px\">' + escapeHtml(amount) + '</strong>' : ''}</div></div></div>`
  if (navigator.vibrate) navigator.vibrate([20, 30, 20])
  setTimeout(() => {
    islandRoot.className = 'dynamic-island active'
    setTimeout(() => { islandRoot.className = 'dynamic-island'; islandRoot.innerHTML = '' }, 800)
  }, 1800)
}

function getVisibleDebts() {
  const q = (state.filter || '').trim().toLowerCase()
  return state.debts.filter(d => {
    if (!q) return true
    return [d.name, d.reason, d.category || ''].some(f => String(f).toLowerCase().includes(q)) || String(d.remainingAmount).includes(q)
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
}

function formatDateDisplay(isoDate){
  if(!isoDate) return ''
  // isoDate expected YYYY-MM-DD
  try{ const [y,m,d] = isoDate.split('-'); return `${d}/${m}/${y}` }catch(e){ return isoDate }
}

function formatDateTimeDisplay(isoDateTime){
  const value = new Date(isoDateTime)
  if(Number.isNaN(value.getTime())) return ''
  return value.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function addActivity(message, meta = '') {
  state.activityLog = pruneActivityLog(state.activityLog)
  state.activityLog.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    meta,
    createdAt: new Date().toISOString(),
  })
  state.activityLog = state.activityLog.slice(0, 20)
  saveState()
}

function createDebt({ name, reason, amount, category, date, notes }, { showIsland = true, logActivity = true } = {}) {
  const debt = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    reason,
    category: category || 'outros',
    originalAmount: amount,
    remainingAmount: amount,
    payments: [],
    status: 'open',
    createdAt: new Date().toISOString(),
    date: date || new Date().toISOString().slice(0,10), // store as YYYY-MM-DD
    notes: notes || '',
  }
  state.debts.unshift(debt)
  if(logActivity) addActivity('Dívida adicionada', `${name} • ${formatMoney(amount)}`)
  saveState()
  if (showIsland) {
    showDynamicIsland('✅ Dívida adicionada', name, formatMoney(amount))
    triggerHaptic()
  }
  render()
}

function createExpense({ title, category, amount, date, notes }){
  const exp = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, category: category||'outros', amount: Number(amount)||0, date: date||new Date().toISOString(), notes: notes||'' }
  state.expenses.unshift(exp)
  addActivity('Despesa registada', `${title} • ${formatMoney(exp.amount)}`)
  saveState()
  showDynamicIsland('➖ Despesa registada', title, formatMoney(exp.amount))
  triggerHaptic()
  render()
}

function removeExpense(id){
  const e = state.expenses.find(x=>x.id===id)
  state.expenses = state.expenses.filter(x=>x.id!==id)
  if(e) addActivity('Despesa removida', `${e.title}`)
  saveState()
  showDynamicIsland('🗑️ Despesa removida', e?e.title:'', '')
  triggerHaptic()
  render()
}

function updateExpense(id, patch){
  state.expenses = state.expenses.map(e=> e.id===id ? {...e, ...patch} : e)
  saveState()
  render()
}

function startInlineEdit(target){
  try{
    const item = target.closest('.expense-item')
    if(!item) return
    const id = item.dataset.id
    const cur = target.textContent.trim()
    const exp = state.expenses.find(x=>x.id===id)
    if(!exp) return
    openEditExpenseModal(exp)
  }catch(e){}
}

function getExpensesTotalThisMonth(){
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
  return state.expenses.reduce((s,e)=>{ const d = new Date(e.date); if(d.getFullYear()===y && d.getMonth()===m) return s+Number(e.amount||0); return s },0)
}

function updateDebt(id, patch) {
  state.debts = state.debts.map(d => d.id === id ? { ...d, ...patch } : d)
  saveState()
  render()
}

function removeDebt(id) {
  const d = state.debts.find(x => x.id === id)
  state.debts = state.debts.filter(d2 => d2.id !== id)
  if(d) addActivity('Dívida removida', `${d.name} • ${formatMoney(d.remainingAmount)}`)
  saveState()
  showDynamicIsland('🗑️ Dívida removida', d ? d.name : '', '')
  triggerHaptic()
  render()
}

function registerPayment(debt, amount, note) {
  const payment = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, amount, note: note || '', date: new Date().toISOString() }
  const remaining = Math.max(0, debt.remainingAmount - amount)
  const status = remaining === 0 ? 'paid' : 'open'
  updateDebt(debt.id, { payments: [...debt.payments, payment], remainingAmount: remaining, status })
  addActivity(status === 'paid' ? 'Dívida paga totalmente' : 'Dívida paga', `${debt.name} • ${formatMoney(amount)}`)
  showDynamicIsland('💰 Dívida paga', debt.name, (amount>0?formatMoney(amount):''))
  triggerHaptic()
}

function markDebtPaidFully(debt){
  updateDebt(debt.id, { status: 'paid', paidAt: new Date().toISOString() })
  addActivity('Dívida marcada como paga', `${debt.name}`)
  showDynamicIsland('✅ Dívida marcada como paga', debt.name, formatMoney(debt.remainingAmount))
  triggerHaptic()
  render()
}

function render() {
  const totalOpen = getTotalOpen()
  const totalDebts = state.debts.length
  const lastDebt = state.debts[0]
  state.activityLog = pruneActivityLog(state.activityLog)

  app.innerHTML = `
    <div class="app-shell">
      <header class="navbar panel">
        <div class="navbar-row">
          <div class="navbar-summary">
            <div style="display:flex;align-items:center;gap:12px"><h1 class="app-title">Contas</h1><div class="chip">${totalDebts} itens</div></div>
            <div class="app-sub">Bem-vindo · Total em dívida <strong>${formatMoney(totalOpen)}</strong></div>
          </div>
                <div class="top-tabs">
                  <button class="tab ${state.view==='home'?'active':''}" data-view="home">Home</button>
                  <button class="tab ${state.view==='debts'?'active':''}" data-view="debts">💰 Dívidas</button>
                  <button class="tab ${state.view==='work'?'active':''}" data-view="work">💼 Trabalho</button>
                  <button class="tab ${state.view==='salaries'?'active':''}" data-view="salaries">💶 Salários</button>
                  <button class="tab ${state.view==='stats'?'active':''}" data-view="stats">📊 Estatísticas</button>
                </div>
        </div>
      </header>

      <main class="content">
        <section class="dashboard">
          <div class="card panel"><h3>💰 Total em dívida</h3><div id="totalOpen" class="value">${formatMoney(totalOpen)}</div></div>
          <div class="card panel"><h3>👥 Amigos</h3><div class="value">${new Set(state.debts.map(d=>d.name)).size}</div></div>
          <div class="card panel"><h3>📄 Dívidas em aberto</h3><div class="value">${state.debts.filter(d=>d.status==='open').length}</div></div>
          <div class="card panel"><h3>✅ Dívidas pagas</h3><div class="value">${state.debts.filter(d=>d.status==='paid').length}</div></div>
        </section>

        ${renderMainView()}

      </main>
    </div>
    <div id="modalRoot"></div>
  `

  // animate total
  requestAnimationFrame(()=>{ animateValue(document.querySelector('#totalOpen')) })

  attachListeners()
}

// Modal helpers (simple inline modal)
function showModal(innerHtml){
  const root = document.querySelector('#modalRoot')
  if(!root) return
  root.innerHTML = `<div class="modal-backdrop" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999"><div class="modal" style="background:var(--bg);padding:16px;border-radius:12px;min-width:280px;max-width:90%;box-shadow:0 8px 24px rgba(0,0,0,0.2)">${innerHtml}</div></div>`
}
function closeModal(){ const root = document.querySelector('#modalRoot'); if(root) root.innerHTML = '' }

function openPaymentModal(debt){
  showModal(`<h3>Registrar pagamento — ${escapeHtml(debt.name)}</h3><form id="payForm"><input name="amount" placeholder="Valor" /><input name="note" placeholder="Descrição (opcional)" /><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="secondary-button" id="payFullDebtBtn">Pago total</button><button type="submit" class="primary-button">Registar</button><button type="button" id="cancelPay">Cancelar</button></div></form>`)
  const f = document.querySelector('#payForm')
  const cancel = document.querySelector('#cancelPay')
  const payFull = document.querySelector('#payFullDebtBtn')
  cancel && cancel.addEventListener('click', ()=>closeModal())
  payFull && payFull.addEventListener('click', ()=>{ markDebtPaidFully(debt); closeModal() })
  f && f.addEventListener('submit', e=>{ e.preventDefault(); const amt = Number(String(f.amount.value||'').replace(',','.')); if(Number.isNaN(amt)||amt<=0){ alert('Valor inválido'); return } const note = f.note.value||''; if(amt>debt.remainingAmount){ if(!confirm('Pagamento maior que restante. Usar valor restante?')) return; registerPayment(debt, debt.remainingAmount, note) } else registerPayment(debt, amt, note); closeModal(); render() })
}

function openEditDebtModal(debt){
  showModal(`<h3>Editar dívida — ${escapeHtml(debt.name)}</h3><form id="editDebtForm"><input name="name" placeholder="Nome" value="${escapeHtml(debt.name)}" /><input name="reason" placeholder="Motivo" value="${escapeHtml(debt.reason)}" /><input name="remaining" placeholder="Restante" value="${escapeHtml(String(debt.remainingAmount))}" /><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="submit" class="primary-button">Guardar</button><button type="button" id="cancelEditDebt">Cancelar</button></div></form>`)
  const f = document.querySelector('#editDebtForm'); const cancel = document.querySelector('#cancelEditDebt')
  cancel && cancel.addEventListener('click', ()=>closeModal())
  f && f.addEventListener('submit', e=>{ e.preventDefault(); const name=f.name.value.trim(); const reason=f.reason.value.trim(); const rem = Number(String(f.remaining.value||'').replace(',','.')); if(!name||!reason||Number.isNaN(rem)||rem<0){ alert('Valores inválidos'); return } updateDebt(debt.id, { name, reason, remainingAmount: rem, status: rem===0 ? 'paid' : 'open' }); addActivity('Dívida editada', `${name} • ${formatMoney(rem)}`); showDynamicIsland('✏️ Dívida editada', name, ''); triggerHaptic(); closeModal(); render() })
}

function openEditShiftModal(sh){
  showModal(`<h3>Editar turno — ${escapeHtml(sh.placeName||'')}</h3><form id="editShiftForm"><input name="start" placeholder="Início (HH:MM)" value="${escapeHtml(sh.start||'')}" /><input name="end" placeholder="Fim (HH:MM)" value="${escapeHtml(sh.end||'')}" /><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="submit" class="primary-button">Guardar</button><button type="button" id="cancelEditShift">Cancelar</button></div></form>`)
  const f = document.querySelector('#editShiftForm'); const cancel = document.querySelector('#cancelEditShift')
  cancel && cancel.addEventListener('click', ()=>closeModal())
  f && f.addEventListener('submit', e=>{ e.preventDefault(); const start=f.start.value.trim(); const end=f.end.value.trim(); if(!start||!end){ alert('Preencha início e fim'); return } try{ const [shh,shm]=start.split(':').map(Number); const [eh,em]=end.split(':').map(Number); let hrs=(eh+em/60)-(shh+shm/60); if(hrs<0) hrs+=24; sh.totalHours = Math.round(hrs*100)/100 }catch(e){ alert('Formato de hora inválido'); return } sh.start=start; sh.end=end; addActivity('Turno editado', `${sh.placeName || 'Sem hotel'} • ${formatDateDisplay(String(sh.date).slice(0,10))}`); saveState(); showDynamicIsland('✏️ Turno editado', sh.placeName||'', ''); closeModal(); render() })
}

function openEditExpenseModal(exp){
  showModal(`<h3>Editar despesa — ${escapeHtml(exp.title)}</h3><form id="editExpForm"><input name="title" value="${escapeHtml(exp.title)}" /><input name="amount" value="${escapeHtml(String(exp.amount))}" /><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="submit" class="primary-button">Guardar</button><button type="button" id="cancelEditExp">Cancelar</button></div></form>`)
  const f = document.querySelector('#editExpForm'); const cancel = document.querySelector('#cancelEditExp')
  cancel && cancel.addEventListener('click', ()=>closeModal())
  f && f.addEventListener('submit', e=>{ e.preventDefault(); const title=f.title.value.trim(); const amount=Number(String(f.amount.value||'').replace(',','.')); if(!title||Number.isNaN(amount)||amount<0){ alert('Valores inválidos'); return } updateExpense(exp.id, { title, amount }); addActivity('Despesa editada', `${title} • ${formatMoney(amount)}`); showDynamicIsland('✏️ Despesa editada', title, formatMoney(amount)); triggerHaptic(); closeModal(); render() })
}

function renderDebtCard(d){
  const initials = (d.name||'??').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase()
  return `
    <article class="debt-card panel ${d.status === 'paid' ? 'debt-paid' : ''}" data-id="${d.id}">
      <div class="avatar">${initials}</div>
      <div class="debt-info">
        <div class="debt-row"><div>
          <div style="font-weight:800">${escapeHtml(d.name)}</div>
          <div class="debt-meta">${escapeHtml(d.reason)} • ${escapeHtml(d.category||'')}</div>
        </div>
        <div style="text-align:right">
          <div class="debt-amount ${d.status === 'paid' ? 'amount-paid' : ''}">${formatMoney(d.remainingAmount)}</div>
                  <div class="debt-meta">${formatDateDisplay(d.date || d.createdAt.slice(0,10))}</div>
        </div></div>
                ${d.status==='paid' ? '<div class="status-chip status-paid" style="width:max-content">Pago total</div>' : ''}
                ${d.notes?`<div style="margin-top:6px;color:var(--muted)">${escapeHtml(d.notes)}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button class="icon-btn" data-action="pay" data-id="${d.id}">Registrar</button>
          <button class="icon-btn" data-action="edit" data-id="${d.id}">Editar</button>
          <button class="icon-btn" data-action="delete" data-id="${d.id}">Eliminar</button>
        </div>
      </div>
    </article>
  `
}

function renderWorkView(){
  const grouped = groupShiftsByHotel()
  const workLayout = state.settings.workLayout || 'accordion'
  return `
    <section>
      <div style="display:grid;gap:12px">
        <form class="panel work-form" id="workForm">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input name="date" type="date" />
            <select name="placeType"><option>Hotel</option><option>Outro</option></select>
            <input name="placeName" placeholder="Nome do local (ex: Hotel PortoBay)" list="hotelsList" />
            <input name="start" type="time" />
            <input name="end" type="time" />
            <input name="rate" type="number" step="0.01" placeholder="Valor por hora" />
          </div>
          <textarea name="notes" placeholder="Notas (opcional)" rows="2"></textarea>
          <div style="display:flex;gap:8px"><button class="primary-button">Guardar turno</button></div>
        </form>

        <datalist id="hotelsList">
          ${state.hotels.map(h=>`<option value="${escapeHtml(h.name)}"></option>`).join('')}
        </datalist>

        <div class="panel" style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <strong>Vista dos hotéis</strong>
            <div class="debt-meta">Alterna entre lista normal e lista expandida</div>
          </div>
          <button class="icon-btn" id="toggleWorkLayout" type="button">${workLayout === 'accordion' ? 'Ver normal' : 'Ver expandido'}</button>
        </div>

        <div id="shiftsList">
          ${grouped.length ? (workLayout === 'accordion' ? grouped.map(renderHotelAccordion).join('') : renderFlatShiftsList()) : '<div class="empty-state panel">Nenhum turno registado.</div>'}
        </div>
      </div>
    </section>
  `
}

function renderFlatShiftsList(){
  return state.shifts
    .slice()
    .sort((a,b)=> new Date(a.date) - new Date(b.date))
    .map(renderShiftCard)
    .join('')
}

function groupShiftsByHotel(){
  const groups = new Map()
  state.shifts
    .slice()
    .sort((a,b)=> new Date(a.date) - new Date(b.date))
    .forEach(shift => {
      const key = shift.placeName || 'Sem hotel'
      const current = groups.get(key) || []
      current.push(shift)
      groups.set(key, current)
    })
  return Array.from(groups.entries()).map(([name, shifts]) => ({ name, shifts }))
}

function renderHotelAccordion(group){
  const sortedShifts = group.shifts.slice().sort((a,b)=> new Date(a.date) - new Date(b.date))
  return `
    <details class="panel hotel-accordion" ${group.name !== 'Sem hotel' ? '' : 'open'}>
      <summary>
        <div>
          <strong>${escapeHtml(group.name)}</strong>
          <div class="debt-meta">${group.shifts.length} turnos</div>
        </div>
        <div class="accordion-chev">⌄</div>
      </summary>
      <div class="hotel-accordion-body">
        ${sortedShifts.map(renderShiftCard).join('')}
      </div>
    </details>
  `
}

function renderShiftCard(s){
  return `
    <div class="shift-card panel" data-id="${s.id}">
      <div style="display:flex;justify-content:space-between;gap:12px"><div>${new Date(s.date).toLocaleDateString('pt-PT')} • ${escapeHtml(s.placeType)} - ${escapeHtml(s.placeName)}</div><div>${s.totalHours || '-'}h • ${formatMoney(s.totalAmount || 0)}</div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="icon-btn" data-action="edit-shift" data-id="${s.id}">Editar</button><button class="icon-btn" data-action="delete-shift" data-id="${s.id}">Eliminar</button></div>
    </div>
  `
}

function renderCalendarView(){
  // simple month view for current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1)
  const days = new Date(year, month+1, 0).getDate()
  const startWeek = first.getDay()
  let cells = []
  for(let i=0;i<startWeek;i++) cells.push('')
  for(let d=1; d<=days; d++) cells.push(d)
  const shiftsByDay = {}
  state.shifts.forEach(s => { const dd = new Date(s.date).getDate(); shiftsByDay[dd] = shiftsByDay[dd] || []; shiftsByDay[dd].push(s) })
  return `<section class="panel calendar">${cells.map(c => c? `<div class="day ${shiftsByDay[c] ? 'has-shift':''}"><div>${c}</div>${shiftsByDay[c] ? '<div class="dot"></div>':''}</div>`:'<div class="day empty"></div>').join('')}</section>`
}

function renderStatsView(){
  const summary = getCurrentMonthSummary()
  return `<section style="display:grid;gap:12px"><div class="card panel"><h3>Horas este mês</h3><div class="value">${summary.hours}</div></div><div class="card panel"><h3>Ganhos este mês</h3><div class="value">${formatMoney(summary.earnings)}</div></div></section>`
}

function getCurrentMonthSummary(){
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  return state.shifts.reduce((summary, shift) => {
    const shiftDate = new Date(shift.date)
    if(shiftDate.getFullYear() === year && shiftDate.getMonth() === month){
      summary.hours += Number(shift.totalHours || 0)
      summary.earnings += Number(shift.totalAmount || 0)
    }
    return summary
  }, { hours: 0, earnings: 0 })
}

function renderHomeView(){
  const activities = state.activityLog.slice(0, 8)
  return `
    <section class="panel" style="padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div>
          <h3 style="margin-bottom:2px">Atividade recente</h3>
          <div class="debt-meta">Mantém tudo o que fizeste nas últimas 72 horas</div>
        </div>
        <button class="icon-btn destructive-action" id="clearActivityLog" type="button" ${activities.length ? '' : 'disabled'}>Limpar tudo</button>
      </div>
      ${activities.length ? activities.map(activity => `
        <div class="activity-item" data-id="${activity.id}">
          <div style="min-width:0">
            <strong>${escapeHtml(activity.message)}</strong>
            <div class="debt-meta">${escapeHtml(activity.meta)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            <div class="debt-meta">${formatDateTimeDisplay(activity.createdAt)}</div>
            <button class="icon-btn destructive-action" data-action="delete-activity" data-id="${activity.id}" aria-label="Apagar atividade">×</button>
          </div>
        </div>
      `).join('') : '<div class="empty-state">Sem atividade recente</div>'}
    </section>
  `
}

function addHotel(h){
  const hotel = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: h.name, cycleStartDay: Number(h.cycleStartDay||1), cycleEndDay: Number(h.cycleEndDay||31), payDelay: Number(h.payDelay||0), defaultRate: Number(h.defaultRate||0) }
  state.hotels.unshift(hotel)
  addActivity('Hotel adicionado', `${hotel.name} • ${hotel.cycleStartDay}-${hotel.cycleEndDay} • +${hotel.payDelay}m`)
  saveState()
  render()
}

function deleteHotel(id){
  const hotel = state.hotels.find(h=>h.id===id)
  state.hotels = state.hotels.filter(h=>h.id!==id)
  if(hotel) addActivity('Hotel removido', hotel.name)
  saveState(); render()
}

function getHotelForShift(shift){
  return state.hotels.find(h=>h.name.toLowerCase()===String(shift.placeName||'').toLowerCase()) || null
}

function getPayrollMonthKey(shift, hotel){
  const date = new Date(shift.date)
  const day = date.getDate()
  const cycleStart = Number(hotel?.cycleStartDay || 1)
  const cycleEnd = Number(hotel?.cycleEndDay || 31)
  let periodEndMonth = date.getMonth()
  let periodEndYear = date.getFullYear()

  if (cycleStart > cycleEnd) {
    // ranges like 21-20: dates from start day roll to next month's end period
    if (day >= cycleStart) {
      periodEndMonth += 1
      if (periodEndMonth > 11) { periodEndMonth = 0; periodEndYear += 1 }
    }
  }

  const payDelay = Number(hotel?.payDelay || 0)
  periodEndMonth += payDelay
  while (periodEndMonth > 11) { periodEndMonth -= 12; periodEndYear += 1 }
  return `${periodEndYear}-${String(periodEndMonth + 1).padStart(2, '0')}`
}

function computePayrolls(){
  const byMonth = {}
  state.shifts.forEach(s=>{
    // ensure totalHours
    if(!s.totalHours && s.start && s.end){ try{ const [sh,sm]=s.start.split(':').map(Number); const [eh,em]=s.end.split(':').map(Number); let hrs=(eh+em/60)-(sh+sm/60); if(hrs<0) hrs+=24; s.totalHours = Math.round(hrs*100)/100 }catch(e){}
    }
    // find hotel rule
    const hotel = getHotelForShift(s)
    const rate = (s.rate && Number(s.rate)) || (hotel && Number(hotel.defaultRate)) || 0
    s.totalAmount = Math.round(((s.totalHours||0) * rate) * 100)/100
    const key = getPayrollMonthKey(s, hotel)
    byMonth[key] = byMonth[key] || { hours:0, amount:0, shifts: [] }
    byMonth[key].hours += Number(s.totalHours||0)
    byMonth[key].amount += Number(s.totalAmount||0)
    byMonth[key].shifts.push(s)
  })
  // convert to array sorted desc
  return Object.keys(byMonth).sort().reverse().map(k=>({ month:k, ...byMonth[k], amount: Math.round(byMonth[k].amount*100)/100 }))
}

function renderSalariesView(){
  const payrolls = computePayrolls()
  return `
    <section style="display:grid;gap:12px">
      <div class="panel" style="padding:12px">
        <h3>Hotéis</h3>
        <form id="hotelForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input name="name" placeholder="Nome do hotel" />
          <input name="cycleStartDay" type="number" min="1" max="31" placeholder="Início do período" />
          <input name="cycleEndDay" type="number" min="1" max="31" placeholder="Fim do período" />
          <select name="payDelay"><option value="0">Pagamento no mesmo mês</option><option value="1">Pagamento no mês seguinte</option><option value="2">+2 meses</option></select>
          <input name="defaultRate" placeholder="Valor por hora" />
          <button class="primary-button">Guardar Hotel</button>
        </form>
        <div style="margin-top:8px">${state.hotels.length? state.hotels.map(h=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;gap:8px"><div>${escapeHtml(h.name)} • ${h.cycleStartDay || 1}-${h.cycleEndDay || 31} • paga +${h.payDelay}m • ${h.defaultRate}€/h</div><div><button class="icon-btn" data-action="delete-hotel" data-id="${h.id}">Eliminar</button></div></div>`).join('') : '<div class="empty-state">Nenhum hotel</div>'}</div>
      </div>

      <div class="panel" style="padding:12px">
        <h3>Salários</h3>
        ${payrolls.length? payrolls.map(p=>`<div style="padding:10px;border-radius:12px;margin-bottom:8px;background:transparent"><div style="display:flex;justify-content:space-between"><div><strong>${p.month}</strong></div><div>${formatMoney(p.amount)}</div></div><div style="color:var(--muted);font-size:0.9rem">Horas: ${p.hours}</div></div>`).join('') : '<div class="empty-state">Nenhum salário calculado</div>'}
      </div>
    </section>
  `
}

function logShiftActivity(shift, actionLabel = 'Turno registado'){
  addActivity(actionLabel, `${shift.placeName || 'Sem hotel'} • ${formatDateDisplay(String(shift.date).slice(0,10))} • ${shift.totalHours || 0}h • ${formatMoney(shift.totalAmount || 0)}`)
}

function attachListeners(){
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', e=>{ state.view = e.currentTarget.dataset.view; saveState(); render() }))

  const debtForm = document.querySelector('#debtForm')
  if(debtForm){
    debtForm.addEventListener('submit', e=>{
      e.preventDefault();
      const f = e.currentTarget
      const reason = f.reason.value.trim()
      const date = (f.date && f.date.value) ? f.date.value : new Date().toISOString().slice(0,10)
      const notes = (f.notes && f.notes.value) ? f.notes.value : ''
      const isGroup = f.isGroup && f.isGroup.checked
      const name = (f.name && f.name.value) ? f.name.value.trim() : ''
      const amount = Number(String((f.amount && f.amount.value) || '').replace(',', '.'))
      const groupAmount = Number(String((f.groupAmount && f.groupAmount.value) || '').replace(',', '.'))
      const category = 'outros'
      if(!reason){ alert('Preenche o motivo'); return }
      if(isGroup){
        const raw = f.participants.value || ''
        const parts = raw.split(',').map(s=>s.trim()).filter(Boolean)
        const others = parts.filter(p => p.toLowerCase() !== name.toLowerCase())
        if(others.length === 0){ alert('Adicione pelo menos uma pessoa além de si na lista de participantes.'); return }
        const splitMethod = (f.splitMethod && f.splitMethod.value) ? f.splitMethod.value : 'equal'
        if(splitMethod === 'custom'){
          const valsRaw = (f.participantsAmounts && f.participantsAmounts.value) ? f.participantsAmounts.value : ''
          const vals = valsRaw.split(',').map(s=>Number(String(s).trim().replace(',','.')))
          if(vals.some(v=>Number.isNaN(v))){ alert('Os valores personalizados têm números inválidos.'); return }
          if(vals.length !== others.length){ alert('O número de valores personalizados não corresponde ao número de participantes.'); return }
          const totalCustom = vals.reduce((sum, value)=>sum + value, 0)
          if(groupAmount > 0 && Math.abs(totalCustom - groupAmount) > 0.02){ if(!confirm('Os valores personalizados não batem certo com o valor total. Continuar?')) return }
          vals.forEach((share, idx)=>{ const person = others[idx]; createDebt({ name: person, reason, amount: share, category, date, notes }, { showIsland: false, logActivity: false }) })
          addActivity('Dívida de grupo criada', `${reason} • ${others.length} pessoas`)
          saveState(); showDynamicIsland('👥 Dívida de grupo criada', `${others.length} pessoas`, formatMoney(totalCustom || groupAmount)); triggerHaptic(); f.reset(); render(); return
        }
        // equal split
        if(Number.isNaN(groupAmount) || groupAmount <= 0){ alert('Preenche o valor total do grupo'); return }
        const n = others.length
        const base = Math.floor((groupAmount / n) * 100) / 100
        let remainder = Math.round((groupAmount - base * n) * 100) / 100
        others.forEach((person) => {
          let share = base
          if(remainder > 0){ share = Math.round((share + 0.01) * 100) / 100; remainder = Math.round((remainder - 0.01) * 100) / 100 }
          createDebt({ name: person, reason, amount: share, category, date, notes }, { showIsland: false, logActivity: false })
        })
        addActivity('Dívida de grupo criada', `${reason} • ${others.length} pessoas`)
        saveState()
        showDynamicIsland('👥 Dívida de grupo criada', `${others.length} pessoas`, formatMoney(groupAmount))
        triggerHaptic()
        f.reset(); render();
        return
      }
      if(!name||Number.isNaN(amount)||amount<=0){ alert('Preenche nome e valor'); return }
      createDebt({ name, reason, amount, category, date, notes }); f.reset();
    })
  }

  document.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click', handleAction))
  // hotel delete handler mapping
  document.querySelectorAll('[data-action="delete-hotel"]').forEach(btn=>btn.addEventListener('click', e=>{ const id = e.currentTarget.dataset.id; if(confirm('Eliminar hotel?')) deleteHotel(id) }))

  const spotlight = document.querySelector('#spotlight')
  if(spotlight) spotlight.addEventListener('input', e=>{ state.filter = e.target.value; render() })

  const clearAll = document.querySelector('#clearAll')
  if(clearAll) clearAll.addEventListener('click', ()=>{ if(confirm('Limpar todas as dívidas?')){ state.debts=[]; saveState(); render(); } })

  const clearActivityLog = document.querySelector('#clearActivityLog')
  if(clearActivityLog) clearActivityLog.addEventListener('click', ()=>{
    if(!state.activityLog.length) return
    if(confirm('Limpar toda a atividade recente?')){
      state.activityLog = []
      saveState()
      render()
    }
  })

  const workForm = document.querySelector('#workForm')
  if(workForm){
    workForm.addEventListener('submit', e=>{
      e.preventDefault(); const f=e.currentTarget;
      const shift = { id:`${Date.now()}`, date: f.date.value||new Date().toISOString(), placeType: f.placeType.value||'', placeName: f.placeName.value||'', start: f.start.value, end: f.end.value, notes: f.notes.value, rate: f.rate.value }
      // compute total hours if possible
      if(shift.start && shift.end){ const [sh,sm]=shift.start.split(':').map(Number); const [eh,em]=shift.end.split(':').map(Number); let hrs=(eh+em/60)-(sh+sm/60); if(hrs<0) hrs+=24; shift.totalHours = Math.round(hrs*100)/100 }
      // determine hotel rule
      const hotel = getHotelForShift(shift)
      const payDelay = hotel ? Number(hotel.payDelay||0) : 0
      const rate = (shift.rate && Number(shift.rate)) || (hotel && Number(hotel.defaultRate)) || 0
      shift.totalAmount = Math.round((shift.totalHours||0) * rate * 100)/100
      shift.payDelay = payDelay
      state.shifts.unshift(shift); addActivity('Turno registado', `${shift.placeName || 'Sem hotel'} • ${formatDateDisplay(String(shift.date).slice(0,10))} • ${shift.totalHours || 0}h`); saveState(); showDynamicIsland('🏨 Turno registado', shift.placeName, shift.totalHours?shift.totalHours+'h':''); triggerHaptic(); render(); workForm.reset()
    })
  }

  const toggleWorkLayout = document.querySelector('#toggleWorkLayout')
  if(toggleWorkLayout){
    toggleWorkLayout.addEventListener('click', ()=>{
      state.settings.workLayout = (state.settings.workLayout || 'accordion') === 'accordion' ? 'flat' : 'accordion'
      saveState()
      render()
    })
  }

  const expenseForm = document.querySelector('#expenseForm')
  if(expenseForm){
    expenseForm.addEventListener('submit', e=>{
      e.preventDefault(); const f=e.currentTarget; const title=f.title.value.trim(); const amount=Number(String(f.amount.value||'').replace(',', '.'))
      const category=f.category.value; const date=f.date.value||new Date().toISOString(); const notes=f.notes.value||''
      if(!title||Number.isNaN(amount)||amount<=0){ alert('Preencha a despesa corretamente'); return }
      createExpense({ title, category, amount, date, notes }); expenseForm.reset();
    })
  }

  const hotelForm = document.querySelector('#hotelForm')
  if(hotelForm){
    hotelForm.addEventListener('submit', e=>{ e.preventDefault(); const f=e.currentTarget; const name = f.name.value.trim(); const payDelay = Number(f.payDelay.value||0); const defaultRate = Number(String(f.defaultRate.value||'').replace(',', '.')) || 0; const cycleStartDay = Number(f.cycleStartDay.value||1); const cycleEndDay = Number(f.cycleEndDay.value||31); if(!name){ alert('Nome do hotel necessário'); return } addHotel({ name, payDelay, defaultRate, cycleStartDay, cycleEndDay }); f.reset(); })
  }

  // toggle group fields
  const isGroupCheckbox = document.querySelector('#isGroup')
  const groupFields = document.querySelector('#groupFields')
  const normalFields = document.querySelector('.normal-fields')
  if(isGroupCheckbox && groupFields){
    const syncDebtFormMode = (checked)=>{
      groupFields.style.display = checked ? 'block' : 'none'
      if(normalFields) normalFields.style.display = checked ? 'none' : 'block'
    }
    syncDebtFormMode(isGroupCheckbox.checked)
    isGroupCheckbox.addEventListener('change', (e)=>{ syncDebtFormMode(e.target.checked) })
  }
  // show/hide participantsAmounts when splitMethod changes
  const splitMethodSelect = document.querySelector('select[name="splitMethod"]')
  if(splitMethodSelect){
    splitMethodSelect.addEventListener('change', e=>{
      const pa = document.querySelector('input[name="participantsAmounts"]')
      if(pa) pa.style.display = e.target.value === 'custom' ? 'block' : 'none'
    })
  }

  const placeTypeField = document.querySelector('select[name="placeType"]')
  const placeNameField = document.querySelector('input[name="placeName"]')
  const rateField = document.querySelector('input[name="rate"]')
  if(placeTypeField && placeNameField && rateField){
    const syncHotelRate = ()=>{
      const hotel = getHotelForShift({ placeName: placeNameField.value })
      if(hotel){
        rateField.value = String(hotel.defaultRate || '')
      }
    }
    placeNameField.addEventListener('input', syncHotelRate)
    placeNameField.addEventListener('change', syncHotelRate)
    placeNameField.addEventListener('blur', syncHotelRate)
  }

  // inline edit and swipe handling for expenses
  const expensesList = document.querySelector('#expensesList')
  if(expensesList){
    expensesList.addEventListener('click', (ev)=>{
      const title = ev.target.closest('.expense-title')
      if(title){ startInlineEdit(title); return }
    })

    // pointer-based swipe handling
    let pointer = null, startX = 0, curEl = null
    expensesList.addEventListener('pointerdown', (ev)=>{
      const item = ev.target.closest('.expense-item')
      if(!item) return
      pointer = ev.pointerId; startX = ev.clientX; curEl = item.querySelector('.swipe-wrap')
      item.setPointerCapture && item.setPointerCapture(pointer)
    })
    expensesList.addEventListener('pointermove', (ev)=>{
      if(pointer !== ev.pointerId || !curEl) return
      const dx = Math.min(0, ev.clientX - startX)
      curEl.style.transform = `translateX(${dx}px)`
    })
    expensesList.addEventListener('pointerup', (ev)=>{
      if(pointer !== ev.pointerId || !curEl) return
      const dx = ev.clientX - startX
      if(dx < -80){ // swiped left
        const item = ev.target.closest('.expense-item')
        if(item){ const id = item.dataset.id; if(confirm('Remover despesa?')) removeExpense(id) }
      } else { curEl.style.transform = '' }
      try{ ev.target.releasePointerCapture(pointer) }catch(e){}
      pointer = null; curEl = null
    })
  }

  }

function renderMainView(){
  if(state.view === 'home'){
    return renderHomeView()
  }
  if(state.view === 'debts'){
    const visible = getVisibleDebts()
    return `
      <section class="panel" style="padding:12px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <form id="debtForm" class="panel" style="flex:1;min-width:260px">
            <h3>Adicionar dívida</h3>
            <div class="normal-fields">
              <input name="name" placeholder="Nome" />
              <input name="amount" placeholder="Valor" />
            </div>
            <input name="reason" placeholder="Motivo" />

            <label style="font-size:12px;color:var(--muted)">Dívida de grupo? <input type="checkbox" name="isGroup" id="isGroup" /></label>
            <div id="groupFields" style="display:none">
              <input name="groupAmount" placeholder="Valor total do grupo" />
              <select name="splitMethod"><option value="equal">Dividir igualmente</option><option value="custom">Personalizado</option></select>
              <input name="participants" placeholder="Participantes (separados por ,)" />
              <input name="participantsAmounts" placeholder="Valores (separados por ,) - só para Personalizado" />
            </div>
            <div style="display:flex;gap:8px;margin-top:8px"><button class="primary-button">Adicionar</button></div>
          </form>

          <div style="flex:2;min-width:320px">
            <h3>Dívidas</h3>
            <div class="debt-list">${visible.length ? visible.map(renderDebtCard).join('') : '<div class="empty-state">Sem dívidas</div>'}</div>
          </div>
        </div>
      </section>
    `
  }

  if(state.view === 'work') return renderWorkView()
  if(state.view === 'salaries') return renderSalariesView()
  if(state.view === 'stats') return renderStatsView()

  return `<section class="panel" style="padding:12px"><div class="empty-state">Nenhuma vista</div></section>`
}

function handleAction(e){
  const btn = e.currentTarget
  const action = btn.dataset.action
  const id = btn.dataset.id
  if(!action) return
  if(action==='delete'){
    if(confirm('Remover dívida?')) removeDebt(id)
    return
  }
  if(action==='delete-expense'){
    if(confirm('Remover despesa?')) removeExpense(id)
    return
  }
  if(action==='pay'){
    const debt = state.debts.find(d=>d.id===id)
    if(!debt) return
    openPaymentModal(debt)
    return
  }
  if(action==='edit'){
    const debt = state.debts.find(d=>d.id===id)
    if(!debt) return
    openEditDebtModal(debt)
    return
  }
  if(action==='delete-shift'){
    if(!confirm('Remover turno?')) return
    const sh = state.shifts.find(s=>s.id===id)
    state.shifts = state.shifts.filter(s=>s.id!==id)
    if(sh) addActivity('Turno removido', `${sh.placeName || 'Sem hotel'} • ${formatDateDisplay(String(sh.date).slice(0,10))}`)
    saveState()
    showDynamicIsland('🗑️ Turno removido', '', '')
    triggerHaptic()
    render()
    return
  }
  if(action==='edit-shift'){
    const sh = state.shifts.find(x=>x.id===id)
    if(!sh) return
    openEditShiftModal(sh)
    return
  }
  if(action==='edit-expense'){
    const ex = state.expenses.find(x=>x.id===id)
    if(!ex) return
    openEditExpenseModal(ex)
    return
  }
  if(action==='delete-activity'){
    state.activityLog = state.activityLog.filter(item => item.id !== id)
    saveState()
    render()
    return
  }

}

function escapeHtml(text){ return String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }

render()

if('serviceWorker' in navigator){ window.addEventListener('load', ()=>{ navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(()=>{}) }) }
