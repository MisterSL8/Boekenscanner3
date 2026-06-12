/**
 * KringloopBoek Scanner — app.js
 * Camera: BarcodeDetector API (Chrome/Android) met ZXing als fallback
 */

// ─── State ───────────────────────────────────────────────────────────────────
let scannerActive = false;
let animFrame = null;
let stream = null;
let history = [];
try { history = JSON.parse(localStorage.getItem('kringloop_history') || '[]'); } catch(e) {}

// ─── Camera starten ───────────────────────────────────────────────────────────
async function startCamera() {
  setStatus('Camera starten…', 'loading');

  // Vraag camera-toegang
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    });
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      setStatus('Camera geweigerd. Geef toestemming in je browser.', 'error');
    } else {
      setStatus('Camera niet beschikbaar: ' + e.message, 'error');
    }
    return;
  }

  const video = document.getElementById('preview');
  video.srcObject = stream;
  await new Promise(r => { video.onloadedmetadata = r; });
  video.play();

  document.getElementById('camera-area').classList.remove('hidden');
  document.getElementById('btn-camera').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  scannerActive = true;
  setStatus('Camera actief — wijs op barcode…', 'loading');

  // Kies scan-engine
  if ('BarcodeDetector' in window) {
    scanMetBarcodeDetector(video);
  } else {
    scanMetZXing(video);
  }
}

// ─── Engine 1: BarcodeDetector (Chrome/Android ingebouwd) ────────────────────
async function scanMetBarcodeDetector(video) {
  let detector;
  try {
    detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_39', 'code_128', 'upc_a', 'upc_e'] });
  } catch(e) {
    // Fallback als formaten niet ondersteund worden
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
    } catch(e) { /* frame mislukt, volgende proberen */ }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
}

// ─── Engine 2: ZXing (fallback via CDN) ──────────────────────────────────────
function scanMetZXing(video) {
  // Bepaal welke ZXing-global beschikbaar is
  const ZX = window.ZXingBrowser || window.ZXing || null;

  if (!ZX) {
    setStatus('Barcode-library niet geladen. Gebruik handmatige ISBN-invoer.', 'error');
    stopCamera();
    return;
  }

  let reader;
  try {
    // ZXing ≥0.1.x
    if (ZX.BrowserMultiFormatReader) {
      reader = new ZX.BrowserMultiFormatReader();
    } else if (typeof ZX === 'function') {
      reader = new ZX();
    } else {
      throw new Error('Onbekend ZXing formaat');
    }
  } catch(e) {
    setStatus('ZXing initialisatie mislukt. Gebruik handmatige invoer.', 'error');
    stopCamera();
    return;
  }

  // Gebruik canvas-gebaseerde scanning
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const tick = () => {
    if (!scannerActive) return;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const luminance = new ZX.ZXing?.Uint8ClampedArrayLuminanceSource
        ? new ZX.ZXing.Uint8ClampedArrayLuminanceSource(imageData.data, canvas.width, canvas.height)
        : null;

      if (luminance) {
        const binarizer = new ZX.ZXing.HybridBinarizer(luminance);
        const bitmap = new ZX.ZXing.BinaryBitmap(binarizer);
        try {
          const result = new ZX.ZXing.MultiFormatReader().decode(bitmap);
          const isbn = result.getText().replace(/[^0-9X]/gi, '');
          if (isbn.length === 10 || isbn.length === 13) {
            scannerActive = false;
            stopCamera();
            setStatus('ISBN gevonden: ' + isbn, 'success');
            zoekBoekByISBN(isbn);
            return;
          }
        } catch(_) { /* geen barcode in dit frame */ }
      }
    } catch(e) { }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
}

// ─── Camera stoppen ───────────────────────────────────────────────────────────
function stopCamera() {
  scannerActive = false;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

  const video = document.getElementById('preview');
  video.srcObject = null;

  document.getElementById('camera-area').classList.add('hidden');
  document.getElementById('btn-camera').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');

  const status = document.getElementById('scan-status');
  if (!status.classList.contains('success')) setStatus('');
}

// ─── Handmatige invoer ────────────────────────────────────────────────────────
function zoekBoek() {
  const invoer = document.getElementById('isbn-input').value;
  // Strips spaties, koppelstreepjes, punten — houdt cijfers en X over
  const isbn = invoer.replace(/[\s\-\.]/g, '').replace(/[^0-9Xx]/g, '').toUpperCase();

  if (!isbn) {
    setStatus('Voer een ISBN in.', 'error');
    return;
  }
  if (isbn.length !== 10 && isbn.length !== 13) {
    setStatus(`Ongeldig ISBN (${isbn.length} tekens). Een ISBN heeft 10 of 13 cijfers.`, 'error');
    return;
  }
  zoekBoekByISBN(isbn);
}

document.getElementById('isbn-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') zoekBoek();
});

// ─── Open Library lookup ──────────────────────────────────────────────────────
async function zoekBoekByISBN(isbn) {
  setStatus(`Zoeken naar ISBN ${isbn}…`, 'loading');
  document.getElementById('result-section').classList.add('hidden');

  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const key = `ISBN:${isbn}`;

    if (data[key]) {
      toonResultaat(isbn, data[key]);
    } else {
      await zoekViaSearch(isbn);
    }
  } catch (e) {
    setStatus('Netwerkfout: ' + e.message + '. Controleer je verbinding.', 'error');
  }
}

async function zoekViaSearch(isbn) {
  try {
    setStatus('Zoeken in Open Library index…', 'loading');
    const res = await fetch(`https://openlibrary.org/search.json?isbn=${isbn}&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.docs || !data.docs.length) {
      // Toon alsnog een resultaat met alleen de bol.com links
      toonOnbekendBoek(isbn);
      return;
    }

    const doc = data.docs[0];
    toonResultaat(isbn, {
      title: doc.title,
      authors: (doc.author_name || []).map(n => ({ name: n })),
      publish_date: doc.first_publish_year ? String(doc.first_publish_year) : '',
      cover: doc.cover_i ? { medium: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` } : null,
      number_of_pages: doc.number_of_pages_median || null,
      _ratings: doc.ratings_average || 0,
      _ratingsCount: doc.ratings_count || 0,
      _wantToRead: doc.want_to_read_count || 0,
      _alreadyRead: doc.already_read_count || 0,
    });
  } catch (e) {
    setStatus('Zoeken mislukt: ' + e.message, 'error');
  }
}

// Boek niet in Open Library — toon toch bol.com links
function toonOnbekendBoek(isbn) {
  document.getElementById('book-cover').innerHTML = '<div class="cover-placeholder">❓</div>';
  document.getElementById('book-title').textContent  = 'Boek niet gevonden in database';
  document.getElementById('book-author').textContent = 'Open Library heeft geen data voor dit ISBN';
  document.getElementById('book-year').textContent   = '';
  document.getElementById('tag-isbn').textContent    = isbn;

  renderStars('populariteit-stars', 0);
  document.getElementById('populariteit-text').textContent = 'Onbekend';
  document.getElementById('verkoopkans-fill').style.width  = '10%';
  document.getElementById('verkoopkans-text').textContent  = 'Onbekend';
  document.getElementById('bol-ranking').textContent       = '❓ ONBEKEND';
  document.getElementById('advies').textContent =
    '❓ Geen data beschikbaar. Klik hieronder om het boek op bol.com op te zoeken en de prijs zelf te beoordelen.';

  const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
  document.getElementById('bol-nieuw-link').href       = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;
  document.getElementById('bol-tweedehands-link').href = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}&filterSelected=used--USED`;
  document.getElementById('bol-search-link').href      = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;

  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('');
}

// ─── Resultaat tonen ──────────────────────────────────────────────────────────
function toonResultaat(isbn, boek) {
  const titel   = boek.title || 'Onbekende titel';
  const auteurs = (boek.authors || []).map(a => a.name || a.personal_name).filter(Boolean).join(', ') || 'Onbekende auteur';
  const jaar    = boek.publish_date || '';

  // Cover
  const coverEl = document.getElementById('book-cover');
  if (boek.cover && boek.cover.medium) {
    const img = document.createElement('img');
    img.src = boek.cover.medium;
    img.alt = titel;
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

  // ─── Scores ───
  const ratingsGem    = boek._ratings || 0;
  const aantalRatings = boek._ratingsCount || 0;
  const wilLezen      = boek._wantToRead || 0;
  const alGelezen     = boek._alreadyRead || 0;
  const totaal        = wilLezen + alGelezen + aantalRatings;

  let pop;
  if      (ratingsGem >= 4.2 && aantalRatings > 50)  pop = 5;
  else if (ratingsGem >= 3.8 && aantalRatings > 20)  pop = 4;
  else if (ratingsGem >= 3.2 || totaal > 100)        pop = 3;
  else if (ratingsGem >= 2.5 || totaal > 20)         pop = 2;
  else                                                pop = totaal > 5 ? 2 : 1;

  let verkoop;
  if      (totaal > 500 && ratingsGem >= 4)  verkoop = 90;
  else if (pop >= 4)                         verkoop = 75;
  else if (pop === 3)                        verkoop = 55;
  else if (aantalRatings > 0)                verkoop = 35;
  else                                       verkoop = 20;

  const paginas = boek.number_of_pages || 0;
  if (paginas > 50 && paginas < 600) verkoop = Math.min(95, verkoop + 5);

  const rankings = ['', '❓ ONBEKEND', '📗 NICHE', '📘 GEMIDDELD', '⭐ POPULAIR', '🏆 TOP BOEK'];
  const rankingLabel = verkoop >= 80 ? rankings[5]
                     : verkoop >= 65 ? rankings[4]
                     : verkoop >= 45 ? rankings[3]
                     : verkoop >= 30 ? rankings[2]
                     : rankings[1];

  let advies;
  if (aantalRatings === 0 && wilLezen === 0) {
    advies = '❓ Onvoldoende data. Zoek handmatig op bol.com om populariteit te checken.';
  } else if (verkoop >= 80) {
    advies = '✅ Zeker kopen! Verkoopt snel. Vergelijk prijs met bol.com.';
  } else if (verkoop >= 60) {
    advies = '👍 Goede koop. Redelijke verkoopkans. Check tweedehandsprijzen.';
  } else if (verkoop >= 40) {
    advies = '🤔 Twijfelgeval. Kopen als de kringloopprijs erg laag is.';
  } else if (verkoop >= 20) {
    advies = '⚠️ Weinig vraag. Alleen kopen als je het zelf wil lezen.';
  } else {
    advies = '❌ Moeilijk verkoopbaar. Sla over, tenzij je het zelf wil.';
  }

  const popLabels = ['', 'Niet bekend', 'Weinig gevraagd', 'Beetje populair', 'Populair', 'Bestseller'];
  renderStars('populariteit-stars', pop);
  document.getElementById('populariteit-text').textContent = popLabels[pop] || '';
  document.getElementById('verkoopkans-fill').style.width = verkoop + '%';
  document.getElementById('verkoopkans-text').textContent = verkoop + '% kans';
  document.getElementById('bol-ranking').textContent = rankingLabel;
  document.getElementById('advies').textContent = advies;

  // ─── Bol.com links ───
  const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
  const slug   = encodeURIComponent(titel + ' ' + auteurs);
  document.getElementById('bol-nieuw-link').href          = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;
  document.getElementById('bol-tweedehands-link').href    = `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}&filterSelected=used--USED`;
  document.getElementById('bol-search-link').href         = `https://www.bol.com/nl/nl/s/?searchtext=${slug}`;

  voegToeAanGeschiedenis({ isbn, titel, auteurs, score: verkoop, rankingLabel });

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
  el.className = 'scan-status' + (type ? ' ' + type : '');
}

function resetScanner() {
  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('isbn-input').value = '';
  setStatus('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Geschiedenis ─────────────────────────────────────────────────────────────
function voegToeAanGeschiedenis(item) {
  history = history.filter(h => h.isbn !== item.isbn);
  history.unshift(item);
  if (history.length > 20) history = history.slice(0, 20);
  try { localStorage.setItem('kringloop_history', JSON.stringify(history)); } catch(e) {}
  renderGeschiedenis();
}

function renderGeschiedenis() {
  const section = document.getElementById('history-section');
  const list    = document.getElementById('history-list');
  if (!history.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = '';
  history.forEach(item => {
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
  history = [];
  try { localStorage.removeItem('kringloop_history'); } catch(e) {}
  renderGeschiedenis();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderGeschiedenis();

// ─── Event listeners (na DOM-load) ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-camera').addEventListener('click', startCamera);
  document.getElementById('btn-stop').addEventListener('click', stopCamera);
  document.getElementById('btn-zoek').addEventListener('click', zoekBoek);
  document.getElementById('btn-reset').addEventListener('click', resetScanner);
  document.getElementById('btn-clear-history').addEventListener('click', clearHistory);
});
