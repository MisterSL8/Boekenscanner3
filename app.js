/**
 * KringloopBoek Scanner — app.js
 */

// ─── State ────────────────────────────────────────────────────────────────────
let scannerActive = false;
let animFrame     = null;
let cameraStream  = null;
let scanHistory   = [];
try { scanHistory = JSON.parse(localStorage.getItem('kringloop_history') || '[]'); } catch(e) {}

// ─── Alles start na DOM-load ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-camera').addEventListener('click', startCamera);
  document.getElementById('btn-stop').addEventListener('click', stopCamera);
  document.getElementById('btn-zoek').addEventListener('click', zoekBoek);
  document.getElementById('btn-reset').addEventListener('click', resetScanner);
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);
  document.getElementById('isbn-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') zoekBoek();
  });
  renderGeschiedenis();
});

// ─── Camera starten ───────────────────────────────────────────────────────────
async function startCamera() {
  setStatus('Camera starten…', 'loading');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    });
  } catch (e) {
    setStatus(e.name === 'NotAllowedError'
      ? 'Camera geweigerd — geef toestemming in je browser.'
      : 'Camera niet beschikbaar: ' + e.message, 'error');
    return;
  }

  const video = document.getElementById('preview');
  video.srcObject = cameraStream;
  await video.play().catch(() => {});

  document.getElementById('camera-area').classList.remove('hidden');
  document.getElementById('btn-camera').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  scannerActive = true;
  setStatus('Camera actief — wijs op barcode…', 'loading');

  if ('BarcodeDetector' in window) {
    scanMetBarcodeDetector(video);
  } else {
    scanMetZXing(video);
  }
}

// ─── Camera stoppen ───────────────────────────────────────────────────────────
function stopCamera() {
  scannerActive = false;
  if (animFrame)    { cancelAnimationFrame(animFrame); animFrame = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  const video = document.getElementById('preview');
  video.srcObject = null;
  document.getElementById('camera-area').classList.add('hidden');
  document.getElementById('btn-camera').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  const s = document.getElementById('scan-status');
  if (!s.classList.contains('success')) setStatus('');
}

// ─── Scan-engine 1: BarcodeDetector (Chrome / Android ingebouwd) ─────────────
async function scanMetBarcodeDetector(video) {
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','upc_a','upc_e'] });
  } catch(e) {
    detector = new BarcodeDetector();
  }
  const tick = async () => {
    if (!scannerActive) return;
    try {
      const barcodes = await detector.detect(video);
      for (const bc of barcodes) {
        const isbn = bc.rawValue.replace(/[^0-9X]/gi, '');
        if (isbn.length === 10 || isbn.length === 13) {
          scannerActive = false;
          stopCamera();
          setStatus('ISBN gevonden: ' + isbn, 'success');
          zoekBoekByISBN(isbn);
          return;
        }
      }
    } catch(e) { /* frame overgeslagen */ }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
}

// ─── Scan-engine 2: ZXing (Safari / Firefox fallback) ────────────────────────
function scanMetZXing(video) {
  const ZX = window.ZXingBrowser || window.ZXing;
  if (!ZX || !ZX.BrowserMultiFormatReader) {
    setStatus('Barcode-scanner niet beschikbaar in deze browser. Gebruik handmatige invoer.', 'error');
    stopCamera();
    return;
  }
  const reader = new ZX.BrowserMultiFormatReader();
  reader.decodeFromVideoElement(video, (result, err) => {
    if (!result || !scannerActive) return;
    const isbn = result.getText().replace(/[^0-9X]/gi, '');
    if (isbn.length === 10 || isbn.length === 13) {
      scannerActive = false;
      reader.reset();
      stopCamera();
      setStatus('ISBN gevonden: ' + isbn, 'success');
      zoekBoekByISBN(isbn);
    }
  });
}

// ─── Handmatige invoer ────────────────────────────────────────────────────────
function zoekBoek() {
  // Accepteer met of zonder koppelstreepjes/spaties, bijv. 978-90-414-1920-0
  const isbn = document.getElementById('isbn-input').value
    .replace(/[\s\-\.]/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();

  if (!isbn) {
    setStatus('Voer een ISBN in.', 'error');
    return;
  }
  if (isbn.length !== 10 && isbn.length !== 13) {
    setStatus(`Ongeldig ISBN — ${isbn.length} cijfers gevonden, verwacht 10 of 13.`, 'error');
    return;
  }
  zoekBoekByISBN(isbn);
}

// ─── Open Library API ─────────────────────────────────────────────────────────
async function zoekBoekByISBN(isbn) {
  setStatus('Boekgegevens ophalen…', 'loading');
  document.getElementById('result-section').classList.add('hidden');
  try {
    const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const data = await res.json();
    if (data[`ISBN:${isbn}`]) {
      toonResultaat(isbn, data[`ISBN:${isbn}`]);
    } else {
      await zoekViaSearch(isbn);
    }
  } catch(e) {
    setStatus('Netwerkfout: ' + e.message, 'error');
  }
}

async function zoekViaSearch(isbn) {
  try {
    setStatus('Zoeken in Open Library index…', 'loading');
    const res  = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&limit=1`);
    const data = await res.json();
    if (!data.docs?.length) { toonOnbekendBoek(isbn); return; }
    const d = data.docs[0];
    toonResultaat(isbn, {
      title:          d.title,
      authors:        (d.author_name || []).map(n => ({ name: n })),
      publish_date:   d.first_publish_year ? String(d.first_publish_year) : '',
      cover:          d.cover_i ? { medium: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` } : null,
      number_of_pages: d.number_of_pages_median || null,
      _ratings:       d.ratings_average  || 0,
      _ratingsCount:  d.ratings_count    || 0,
      _wantToRead:    d.want_to_read_count  || 0,
      _alreadyRead:   d.already_read_count  || 0,
    });
  } catch(e) {
    setStatus('Zoeken mislukt: ' + e.message, 'error');
  }
}

// ─── Resultaat tonen ──────────────────────────────────────────────────────────
function toonResultaat(isbn, boek) {
  const titel   = boek.title || 'Onbekende titel';
  const auteurs = (boek.authors || []).map(a => a.name || a.personal_name).filter(Boolean).join(', ') || 'Onbekende auteur';
  const jaar    = boek.publish_date || '';

  // Cover
  const coverEl = document.getElementById('book-cover');
  if (boek.cover?.medium) {
    const img = document.createElement('img');
    img.src    = boek.cover.medium;
    img.alt    = titel;
    img.onerror = () => { coverEl.innerHTML = '<div class="cover-placeholder">📖</div>'; };
    coverEl.innerHTML = '';
    coverEl.appendChild(img);
  } else {
    coverEl.innerHTML = '<div class="cover-placeholder">📖</div>';
  }

  document.getElementById('book-title').textContent  = titel;
  document.getElementById('book-author').textContent = auteurs;
  document.getElementById('book-year').textContent   = jaar ? `Gepubliceerd: ${jaar}` : '';
  document.getElementById('tag-isbn').textContent    = isbn;

  // ── Scores berekenen ──
  const ratingsGem    = boek._ratings      || 0;
  const aantalRatings = boek._ratingsCount || 0;
  const wilLezen      = boek._wantToRead   || 0;
  const alGelezen     = boek._alreadyRead  || 0;
  const totaal        = wilLezen + alGelezen + aantalRatings;

  // Populariteit (1–5 sterren) op basis van gemiddelde rating + aantal beoordelingen
  let pop;
  if      (ratingsGem >= 4.2 && aantalRatings > 50) pop = 5;
  else if (ratingsGem >= 3.8 && aantalRatings > 20) pop = 4;
  else if (ratingsGem >= 3.2 || totaal > 100)       pop = 3;
  else if (ratingsGem >= 2.5 || totaal > 20)        pop = 2;
  else                                               pop = totaal > 5 ? 2 : 1;

  // Verkoopkans (0–100%) — zie uitleg in de UI
  let verkoop;
  if      (totaal > 500 && ratingsGem >= 4) verkoop = 90;
  else if (pop >= 4)                        verkoop = 75;
  else if (pop === 3)                       verkoop = 55;
  else if (aantalRatings > 0)               verkoop = 35;
  else                                      verkoop = 20;

  const paginas = boek.number_of_pages || 0;
  if (paginas > 50 && paginas < 600) verkoop = Math.min(95, verkoop + 5);

  // Uitleg voor de gebruiker welke data er gebruikt is
  let databron = '';
  if (aantalRatings > 0 || wilLezen > 0) {
    const delen = [];
    if (aantalRatings > 0) delen.push(`${aantalRatings} beoordelingen (gem. ${ratingsGem.toFixed(1)}/5)`);
    if (wilLezen > 0)      delen.push(`${wilLezen}× op leeslijst`);
    if (alGelezen > 0)     delen.push(`${alGelezen}× gelezen`);
    databron = 'Gebaseerd op: ' + delen.join(', ') + ' (Open Library)';
  } else {
    databron = 'Geen beoordelingsdata beschikbaar — schatting op basis van boekformaat';
  }

  // Ranking label
  const rankingLabel = verkoop >= 80 ? '🏆 TOP BOEK'
                     : verkoop >= 65 ? '⭐ POPULAIR'
                     : verkoop >= 45 ? '📘 GEMIDDELD'
                     : verkoop >= 30 ? '📗 NICHE'
                     : '❓ ONBEKEND';

  // Advies
  let advies;
  if (aantalRatings === 0 && wilLezen === 0) {
    advies = '❓ Onvoldoende data. Zoek handmatig op bol.com om populariteit te checken.';
  } else if (verkoop >= 80) {
    advies = '✅ Zeker kopen! Verkoopt snel op bol.com.';
  } else if (verkoop >= 60) {
    advies = '👍 Goede koop. Redelijke verkoopkans. Check de tweedehandsprijzen.';
  } else if (verkoop >= 40) {
    advies = '🤔 Twijfelgeval. Kopen als de kringloopprijs erg laag is.';
  } else if (verkoop >= 20) {
    advies = '⚠️ Weinig vraag. Alleen kopen als je het zelf wil lezen.';
  } else {
    advies = '❌ Moeilijk verkoopbaar. Sla over tenzij je het zelf wil.';
  }

  const popLabels = ['', 'Niet bekend', 'Weinig gevraagd', 'Beetje populair', 'Populair', 'Bestseller'];
  renderStars('populariteit-stars', pop);
  document.getElementById('populariteit-text').textContent = popLabels[pop] || '';
  document.getElementById('verkoopkans-fill').style.width  = verkoop + '%';
  document.getElementById('verkoopkans-text').textContent  = verkoop + '% kans';
  document.getElementById('bol-ranking').textContent       = rankingLabel;
  document.getElementById('advies').textContent            = advies;
  document.getElementById('data-uitleg').textContent       = databron;

  // Bol.com links
  const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
  const slug   = encodeURIComponent(titel + ' ' + auteurs);
  document.getElementById('bol-nieuw-link').href          = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;
  document.getElementById('bol-tweedehands-link').href    = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}&filterSelected=used--USED`;
  document.getElementById('bol-search-link').href         = `https://www.bol.com/nl/nl/s/?searchtext=${slug}`;

  voegToeAanGeschiedenis({ isbn, titel, score: verkoop, rankingLabel });

  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('');
}

function toonOnbekendBoek(isbn) {
  document.getElementById('book-cover').innerHTML        = '<div class="cover-placeholder">❓</div>';
  document.getElementById('book-title').textContent      = 'Boek niet gevonden in database';
  document.getElementById('book-author').textContent     = 'Geen data in Open Library';
  document.getElementById('book-year').textContent       = '';
  document.getElementById('tag-isbn').textContent        = isbn;
  renderStars('populariteit-stars', 0);
  document.getElementById('populariteit-text').textContent = 'Onbekend';
  document.getElementById('verkoopkans-fill').style.width  = '10%';
  document.getElementById('verkoopkans-text').textContent  = 'Onbekend';
  document.getElementById('bol-ranking').textContent       = '❓ ONBEKEND';
  document.getElementById('advies').textContent =
    '❓ Geen data. Gebruik de bol.com-links hieronder om zelf te beoordelen.';
  document.getElementById('data-uitleg').textContent = 'Geen beoordelingsdata gevonden in Open Library';

  const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
  document.getElementById('bol-nieuw-link').href          = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;
  document.getElementById('bol-tweedehands-link').href    = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}&filterSelected=used--USED`;
  document.getElementById('bol-search-link').href         = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;

  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function renderStars(id, score) {
  const el = document.getElementById(id);
  el.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star ' + (i <= score ? 'filled' : 'empty');
    s.textContent = '★';
    el.appendChild(s);
  }
}

function isbn10To13(isbn10) {
  const d = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * (i % 2 === 0 ? 1 : 3);
  return d + ((10 - (sum % 10)) % 10);
}

function setStatus(msg, type = '') {
  const el = document.getElementById('scan-status');
  el.textContent = msg;
  el.className   = 'scan-status' + (type ? ' ' + type : '');
}

function resetScanner() {
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('isbn-input').value = '';
  setStatus('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Geschiedenis ─────────────────────────────────────────────────────────────
function voegToeAanGeschiedenis(item) {
  scanHistory = scanHistory.filter(h => h.isbn !== item.isbn);
  scanHistory.unshift(item);
  if (scanHistory.length > 20) scanHistory = scanHistory.slice(0, 20);
  try { localStorage.setItem('kringloop_history', JSON.stringify(scanHistory)); } catch(e) {}
  renderGeschiedenis();
}

function renderGeschiedenis() {
  const section = document.getElementById('history-section');
  const list    = document.getElementById('history-list');
  if (!scanHistory.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = '';
  scanHistory.forEach(item => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <span class="history-icon">📚</span>
      <div class="history-info">
        <div class="history-title">${escapeHtml(item.titel)}</div>
        <div class="history-isbn">ISBN: ${item.isbn}</div>
      </div>
      <span class="history-score">${item.rankingLabel.split(' ')[0]} ${item.score}%</span>`;
    li.addEventListener('click', () => zoekBoekByISBN(item.isbn));
    list.appendChild(li);
  });
}

function clearHistory() {
  scanHistory = [];
  try { localStorage.removeItem('kringloop_history'); } catch(e) {}
  renderGeschiedenis();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
