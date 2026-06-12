/**
 * KringloopBoek Scanner — app.js
 * Barcode scanning via ZXing, boekdata via Open Library API
 */

// ─── State ───────────────────────────────────────────────────────────────────
let codeReader = null;
let scannerActive = false;
let history = JSON.parse(localStorage.getItem('kringloop_history') || '[]');

// ─── Camera & Scan ───────────────────────────────────────────────────────────
async function startCamera() {
  setStatus('Camera starten…', 'loading');

  try {
    codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    const devices = await ZXingBrowser.BrowserMultiFormatReader.listVideoInputDevices();

    if (!devices.length) {
      setStatus('Geen camera gevonden. Gebruik handmatige invoer.', 'error');
      return;
    }

    // Voorkeur: achtercamera
    const device =
      devices.find(d => /back|rear|environment/i.test(d.label)) || devices[devices.length - 1];

    document.getElementById('camera-area').classList.remove('hidden');
    document.getElementById('btn-camera').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');

    scannerActive = true;
    setStatus('Camera actief — wijs op barcode…', 'loading');

    await codeReader.decodeFromVideoDevice(device.deviceId, 'preview', (result, err) => {
      if (result && scannerActive) {
        const isbn = result.getText().replace(/[^0-9X]/gi, '');
        if (isbn.length === 10 || isbn.length === 13) {
          scannerActive = false;
          stopCamera();
          setStatus(`ISBN gevonden: ${isbn}`, 'success');
          zoekBoekByISBN(isbn);
        }
      }
    });
  } catch (e) {
    setStatus('Camera niet beschikbaar: ' + e.message, 'error');
    stopCamera();
  }
}

function stopCamera() {
  scannerActive = false;
  if (codeReader) {
    codeReader.reset();
    codeReader = null;
  }
  document.getElementById('camera-area').classList.add('hidden');
  document.getElementById('btn-camera').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  if (!document.getElementById('scan-status').classList.contains('success')) {
    setStatus('');
  }
}

// ─── Handmatige invoer ────────────────────────────────────────────────────────
function zoekBoek() {
  const input = document.getElementById('isbn-input').value.trim().replace(/[^0-9X]/gi, '');
  if (!input) { setStatus('Voer een ISBN in.', 'error'); return; }
  if (input.length !== 10 && input.length !== 13) {
    setStatus('ISBN moet 10 of 13 cijfers zijn.', 'error');
    return;
  }
  zoekBoekByISBN(input);
}

// Enter-toets in invoerveld
document.getElementById('isbn-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') zoekBoek();
});

// ─── Open Library lookup ─────────────────────────────────────────────────────
async function zoekBoekByISBN(isbn) {
  setStatus('Boekgegevens ophalen…', 'loading');
  document.getElementById('result-section').classList.add('hidden');

  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const res = await fetch(url);
    const data = await res.json();
    const key = `ISBN:${isbn}`;

    if (!data[key]) {
      // Probeer Open Library zoeken op ISBN als fallback
      await zoekViaSearch(isbn);
      return;
    }

    const boek = data[key];
    toonResultaat(isbn, boek);
  } catch (e) {
    setStatus('Fout bij ophalen: ' + e.message, 'error');
  }
}

async function zoekViaSearch(isbn) {
  try {
    const url = `https://openlibrary.org/search.json?isbn=${isbn}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.docs || !data.docs.length) {
      setStatus('Boek niet gevonden. Controleer het ISBN.', 'error');
      return;
    }

    const doc = data.docs[0];
    const boek = {
      title: doc.title,
      authors: doc.author_name ? doc.author_name.map(n => ({ name: n })) : [],
      publish_date: doc.first_publish_year ? String(doc.first_publish_year) : '',
      cover: doc.cover_i ? {
        medium: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
        large: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      } : null,
      subject_places: [],
      number_of_pages: doc.number_of_pages_median || null,
      _readinglog: doc.readinglog_count || 0,
      _ratings: doc.ratings_average || 0,
      _ratingsCount: doc.ratings_count || 0,
      _wantToRead: doc.want_to_read_count || 0,
      _alreadyRead: doc.already_read_count || 0,
    };

    toonResultaat(isbn, boek);
  } catch (e) {
    setStatus('Boek niet gevonden. Controleer het ISBN.', 'error');
  }
}

// ─── Resultaat tonen ──────────────────────────────────────────────────────────
function toonResultaat(isbn, boek) {
  const titel   = boek.title || 'Onbekende titel';
  const auteurs = (boek.authors || []).map(a => a.name || a.personal_name).filter(Boolean).join(', ') || 'Onbekende auteur';
  const jaar    = boek.publish_date || '';

  // Cover
  const coverEl = document.getElementById('book-cover');
  if (boek.cover && (boek.cover.medium || boek.cover.large)) {
    const img = document.createElement('img');
    img.src = boek.cover.medium || boek.cover.large;
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

  // ─── Beoordelingslogica ───
  // Gebruik beschikbare data van Open Library:
  // ratings_average (0-5), ratings_count, want_to_read_count, already_read_count
  const ratingsGemiddeld  = boek._ratings || 0;
  const aantalRatings     = boek._ratingsCount || 0;
  const wilLezen          = boek._wantToRead || 0;
  const alGelezen         = boek._alreadyRead || 0;
  const totalBetrokken    = wilLezen + alGelezen + aantalRatings;

  // Populariteitsscore (1–5 sterren)
  let populariteitsScore;
  if (ratingsGemiddeld >= 4.2 && aantalRatings > 50)  populariteitsScore = 5;
  else if (ratingsGemiddeld >= 3.8 && aantalRatings > 20) populariteitsScore = 4;
  else if (ratingsGemiddeld >= 3.2 || totalBetrokken > 100) populariteitsScore = 3;
  else if (ratingsGemiddeld >= 2.5 || totalBetrokken > 20)  populariteitsScore = 2;
  else populariteitsScore = totalBetrokken > 5 ? 2 : 1;

  // Verkoopkans (0–100%)
  let verkoopkansScore;
  const isNL = /neder|dutch|nl/i.test(JSON.stringify(boek));
  const isBestseller = aantalRatings > 200 || totalBetrokken > 500;
  const heeftRatings = aantalRatings > 0;

  if (isBestseller && ratingsGemiddeld >= 4) verkoopkansScore = 90;
  else if (populariteitsScore >= 4)          verkoopkansScore = 75;
  else if (populariteitsScore === 3)         verkoopkansScore = 55;
  else if (heeftRatings)                     verkoopkansScore = 35;
  else                                       verkoopkansScore = 20;

  // Kleine variatie op basis van pagina's
  const paginas = boek.number_of_pages || 0;
  if (paginas > 50 && paginas < 600) verkoopkansScore = Math.min(95, verkoopkansScore + 5);

  // Ranking label
  let rankingLabel, rankingKleur;
  if (verkoopkansScore >= 80)      { rankingLabel = '🏆 TOP BOEK'; }
  else if (verkoopkansScore >= 65) { rankingLabel = '⭐ POPULAIR'; }
  else if (verkoopkansScore >= 45) { rankingLabel = '📘 GEMIDDELD'; }
  else if (verkoopkansScore >= 30) { rankingLabel = '📗 NICHE'; }
  else                             { rankingLabel = '❓ ONBEKEND'; }

  // Popularteit tekst
  const populariteitLabels = ['Niet bekend', 'Weinig gevraagd', 'Beetje populair', 'Populair', 'Erg populair', 'Bestseller'];

  // Advies
  let adviesTekst;
  if (verkoopkansScore >= 80) {
    adviesTekst = `✅ Zeker kopen! Verkoopt snel. Kijk of de prijs op bol.com hoger ligt dan de kringloopprijs.`;
  } else if (verkoopkansScore >= 60) {
    adviesTekst = `👍 Goede koop. Redelijke kans op doorverkoop. Controleer de tweedehandsprijzen op bol.com.`;
  } else if (verkoopkansScore >= 40) {
    adviesTekst = `🤔 Twijfelgeval. Kopen als je het zelf interessant vindt of als de kringloopprijs erg laag is.`;
  } else if (verkoopkansScore >= 20) {
    adviesTekst = `⚠️ Weinig vraag. Alleen kopen als je het zelf wil lezen — doorverkopen lastig.`;
  } else {
    adviesTekst = `❌ Moeilijk verkoopbaar. Boek is weinig bekend — sla over, tenzij je het zelf wil.`;
  }

  if (aantalRatings === 0 && wilLezen === 0) {
    adviesTekst = `❓ Onvoldoende data. Zoek handmatig op bol.com om de populariteit te checken.`;
  }

  // ─── UI updaten ───
  renderStars('populariteit-stars', populariteitsScore);
  document.getElementById('populariteit-text').textContent = populariteitLabels[populariteitsScore] || '';

  document.getElementById('verkoopkans-fill').style.width = verkoopkansScore + '%';
  document.getElementById('verkoopkans-text').textContent = verkoopkansScore + '% kans';

  document.getElementById('bol-ranking').textContent = rankingLabel;
  document.getElementById('advies').textContent = adviesTekst;

  // ─── Bol.com links ───
  const isbn13 = isbn.length === 10 ? isbn10To13(isbn) : isbn;
  const titelSlug = encodeURIComponent(titel + ' ' + auteurs);

  document.getElementById('bol-nieuw-link').href =
    `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}`;
  document.getElementById('bol-tweedehands-link').href =
    `https://www.bol.com/nl/nl/s/?searchtext=${isbn13}&filterSelected=used--USED`;
  document.getElementById('bol-search-link').href =
    `https://www.bol.com/nl/nl/s/?searchtext=${titelSlug}`;

  // ─── Geschiedenis bijhouden ───
  voegToeAanGeschiedenis({ isbn, titel, auteurs, score: verkoopkansScore, rankingLabel });

  // ─── Tonen ───
  document.getElementById('result-section').classList.remove('hidden');
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function renderStars(containerId, score) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className = 'star ' + (i <= score ? 'filled' : 'empty');
    s.textContent = '★';
    el.appendChild(s);
  }
}

function isbn10To13(isbn10) {
  const digits = isbn10.slice(0, 9);
  const with978 = '978' + digits;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(with978[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return with978 + check;
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
  // Vermijd duplicaten (zelfde ISBN)
  history = history.filter(h => h.isbn !== item.isbn);
  history.unshift(item);
  if (history.length > 20) history = history.slice(0, 20);
  localStorage.setItem('kringloop_history', JSON.stringify(history));
  renderGeschiedenis();
}

function renderGeschiedenis() {
  const section = document.getElementById('history-section');
  const list    = document.getElementById('history-list');

  if (!history.length) {
    section.classList.add('hidden');
    return;
  }

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
      <span class="history-score">${item.rankingLabel.split(' ')[0]} ${item.score}%</span>
    `;
    li.addEventListener('click', () => zoekBoekByISBN(item.isbn));
    list.appendChild(li);
  });
}

function clearHistory() {
  history = [];
  localStorage.removeItem('kringloop_history');
  renderGeschiedenis();
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderGeschiedenis();
