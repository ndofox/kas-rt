const API_PATH = '/api/finance';
const PAGE_SIZE = 50;
const state = { from: '', to: '', offset: 0, total: 0, transactions: [], busy: false, loaded: false };

const byId = (id) => document.getElementById(id);

function getMonthRange(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
    label: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)))
  };
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(amount);
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '—';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

function setNotice(message, kind = 'info') {
  const notice = byId('notice');
  notice.textContent = message;
  notice.classList.remove('hidden', 'border-red-300', 'bg-red-50', 'text-red-900', 'border-slate-300', 'bg-white', 'text-slate-800');
  notice.classList.add(...(kind === 'error'
    ? ['border-red-300', 'bg-red-50', 'text-red-900']
    : ['border-slate-300', 'bg-white', 'text-slate-800']));
}

function clearNotice() {
  byId('notice').classList.add('hidden');
  byId('notice').textContent = '';
}

function resetSummary() {
  for (const id of ['balance', 'income', 'expense', 'net']) byId(id).textContent = '—';
  byId('balance-as-of').textContent = 'Menunggu saldo awal';
  byId('transaction-count').textContent = '— transaksi';
  byId('updated-at').textContent = 'Belum ada pembaruan';
}

function updateSummary(data) {
  const summary = data.summary || {};
  const opening = data.openingBalance || {};
  byId('balance').textContent = summary.currentBalance !== null && summary.currentBalance !== undefined && Number.isFinite(Number(summary.currentBalance))
    ? formatMoney(summary.currentBalance) : 'Belum tersedia';
  byId('income').textContent = formatMoney(summary.income);
  byId('expense').textContent = formatMoney(summary.expense);
  byId('net').textContent = formatMoney(summary.net);
  byId('net').classList.toggle('text-emerald-700', Number(summary.net) > 0);
  byId('net').classList.toggle('text-red-700', Number(summary.net) < 0);
  byId('transaction-count').textContent = `${Number(summary.transactionCount) || 0} transaksi pada periode ini`;
  byId('balance-as-of').textContent = opening.asOfDate
    ? `Saldo awal per ${formatDate(opening.asOfDate)}`
    : 'Saldo awal belum tersedia atau tanggal belum berlaku';
  byId('updated-at').textContent = data.generatedAt
    ? `Data diperbarui ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(data.generatedAt))}`
    : 'Waktu pembaruan tidak tersedia';
}

function createCell(text, className = '') {
  const cell = document.createElement('td');
  cell.className = `border-b border-slate-200 px-4 py-3 align-top ${className}`.trim();
  cell.textContent = text == null || text === '' ? '—' : String(text);
  return cell;
}

function renderRows() {
  const tbody = byId('transaction-rows');
  tbody.replaceChildren();

  for (const transaction of state.transactions) {
    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-50';
    row.append(
      createCell(transaction.id_transaksi, 'font-mono whitespace-nowrap text-xs'),
      createCell(formatDate(transaction.tanggal), 'font-mono whitespace-nowrap'),
      createCell(transaction.tipe === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran',
        transaction.tipe === 'pemasukan' ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'),
      createCell(transaction.kategori),
      createCell(transaction.keterangan, 'max-w-sm whitespace-normal'),
      createCell(formatMoney(transaction.nominal), `font-mono whitespace-nowrap text-right font-semibold ${transaction.tipe === 'pemasukan' ? 'text-emerald-700' : 'text-red-700'}`)
    );

    const proofCell = document.createElement('td');
    proofCell.className = 'border-b border-slate-200 px-4 py-3 align-top';
    if (isPublicProofUrl(transaction.url_struk)) {
      const link = document.createElement('a');
      link.href = transaction.url_struk;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'font-semibold text-slate-900 underline underline-offset-2';
      link.textContent = 'Buka bukti';
      proofCell.append(link);
    } else {
      proofCell.textContent = '—';
    }
    row.append(proofCell);
    tbody.append(row);
  }

  byId('empty-state').classList.toggle('hidden', state.transactions.length > 0 || state.busy || !state.loaded);
  byId('results-count').textContent = `${state.transactions.length} dari ${state.total} transaksi`;
  byId('load-more').classList.toggle('hidden', state.transactions.length >= state.total || state.total === 0);
}

function isPublicProofUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function loadPage({ append = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  clearNotice();
  byId('refresh').disabled = true;
  byId('load-more').disabled = true;

  if (!append) {
    state.offset = 0;
    state.transactions = [];
    state.total = 0;
    state.loaded = false;
    resetSummary();
  }
  renderRows();

  try {
    const params = new URLSearchParams({
      from: state.from,
      to: state.to,
      offset: String(append ? state.transactions.length : 0),
      limit: String(PAGE_SIZE)
    });
    const response = await fetch(`${API_PATH}?${params}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.ok !== true || !Array.isArray(data.transactions)) throw new Error('Format respons API tidak sesuai.');

    updateSummary(data);
    state.total = Number(data.pagination?.total) || 0;
    state.offset = Number(data.pagination?.offset) || 0;
    state.transactions = append
      ? state.transactions.concat(data.transactions)
      : data.transactions;
    state.loaded = true;
    byId('period-label').textContent = `Periode ${formatDate(data.period?.from || state.from)} – ${formatDate(data.period?.to || state.to)}`;
    if (data.openingBalance?.amount == null || data.openingBalance?.asOfDate == null) {
      byId('balance').textContent = 'Belum tersedia';
      setNotice('Saldo awal belum tersedia atau tanggalnya belum berlaku. Ringkasan transaksi periode tetap ditampilkan; saldo kas aktual belum dapat dihitung.');
    }
    if (Array.isArray(data.warnings) && data.warnings.length) {
      const warningText = data.warnings.map((warning) => {
        if (warning.code === 'invalid_rows_excluded') return `${warning.count} baris transaksi tidak valid tidak dihitung.`;
        if (warning.code === 'duplicate_ids_excluded') return `${warning.count} ID transaksi ganda tidak dihitung.`;
        return 'Sebagian data tidak dapat digunakan.';
      }).join(' ');
      setNotice(warningText, 'error');
    }
    renderRows();
  } catch (error) {
    if (!append) state.loaded = false;
    setNotice('Data belum dapat dimuat. Periksa konfigurasi API atau coba muat ulang.', 'error');
    byId('period-label').textContent = `Periode ${formatDate(state.from)} – ${formatDate(state.to)}`;
    if (!append) {
      state.transactions = [];
      state.total = 0;
      renderRows();
    }
  } finally {
    state.busy = false;
    byId('refresh').disabled = false;
    byId('load-more').disabled = false;
    renderRows();
  }
}

function selectCurrentMonth() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', timeZone: 'Asia/Jakarta'
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const localMonth = `${year}-${month}`;
  byId('period').value = localMonth;
  const range = getMonthRange(localMonth);
  state.from = range.from;
  state.to = range.to;
  byId('period-label').textContent = range.label;
  loadPage();
}

byId('period').addEventListener('change', () => {
  const range = getMonthRange(byId('period').value);
  if (!range) {
    setNotice('Pilih periode bulan yang valid.', 'error');
    return;
  }
  state.from = range.from;
  state.to = range.to;
  loadPage();
});
byId('refresh').addEventListener('click', () => loadPage());
byId('load-more').addEventListener('click', () => loadPage({ append: true }));
selectCurrentMonth();
