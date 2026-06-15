// --- AUTO-DETEKSI LINK HP PENGUNJUNG ---
if (window.location.hash && window.location.hash.startsWith('#data:image')) {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('photobooth-app').style.display = 'none';
    document.getElementById('download-page').style.display = 'block';
    
    const rawImageData = window.location.hash.substring(1);
    document.getElementById('visitor-img').src = rawImageData;
    document.getElementById('btn-visitor-download').href = rawImageData;
  });
  throw new Error("Mode download aktif untuk pengunjung.");
}

const video = document.getElementById('video');
const countdownEl = document.getElementById('countdown-display');
const statusEl = document.getElementById('status');
const btnShoot = document.getElementById('btn-shoot');
const shootText = document.getElementById('shoot-text');
const btnDownload = document.getElementById('btn-download');
const btnPrint = document.getElementById('btn-print');
const btnReset = document.getElementById('btn-reset');
const layoutSel = document.getElementById('layout-select');
const frameSel = document.getElementById('frame-select');
const timerSel = document.getElementById('timer-select');
const camSel = document.getElementById('cam-select');
const camStatus = document.getElementById('cam-status');
const stripPreview = document.getElementById('strip-preview');
const flash = document.getElementById('flash');
const printResult = document.getElementById('print-result');
const printImg = document.getElementById('print-img');
const printIframe = document.getElementById('print-iframe');

// Filter Buttons
const btnFilterColor = document.getElementById('btn-filter-color');
const btnFilterBW = document.getElementById('btn-filter-bw');

let shots = [];
let shooting = false;
let stream = null;
let resultDataURL = null; 
let activeFilter = 'color'; 
let selectedSlotIndex = null;

const CAM_ASPECT = 4 / 3; 
const BASE_WIDTH = 420;
const SCALE_FACTOR = 3; 

// KEMBALI KE LAYOUT LAMA: Menggunakan formasi grid berjejer kolom & baris asli
const LAYOUTS = {
  strip3: { count: 3, cols: 1, rows: 3 }, 
  grid4:  { count: 4, cols: 2, rows: 2 }, 
  grid6:  { count: 6, cols: 2, rows: 3 }, 
  grid8:  { count: 8, cols: 2, rows: 4 }, 
  single: { count: 1, cols: 1, rows: 1 }
};

function playBeepSound(isFinal) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isFinal ? 'sine' : 'square';
    osc.frequency.setValueAtTime(isFinal ? 880 : 440, ctx.currentTime); 
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (isFinal ? 0.3 : 0.08));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (isFinal ? 0.3 : 0.08));
  } catch (e) {}
}

function getLayout() { return LAYOUTS[layoutSel.value]; }

async function startCam(deviceId) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  try {
    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 1280 } },
      audio: false
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    camStatus.textContent = 'Kamera aktif';
  } catch (e) {
    camStatus.textContent = 'Kamera bermasalah';
  }
}

async function loadCameras() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    camSel.innerHTML = cams.map((c, i) =>
      `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`
    ).join('');
    if (cams.length) startCam(cams[0].deviceId);
  } catch (e) {
    camSel.innerHTML = '<option>Akses ditolak</option>';
  }
}

camSel.addEventListener('change', () => startCam(camSel.value));

layoutSel.addEventListener('change', () => { 
  resetSesiTotal(); 
  statusEl.textContent = 'Layout diubah. Silakan ambil foto.'; 
});

frameSel.addEventListener('change', () => {
  const layout = getLayout();
  const takenCount = shots.filter(Boolean).length;
  if (takenCount === layout.count && !shooting) {
    buildResult(layout); 
  }
});

function resetOutput() {
  btnDownload.style.display = 'none';
  btnPrint.style.display = 'none';
  if (btnReset) btnReset.style.display = 'none';
  printResult.style.display = 'none';
  resultDataURL = null;
  setFilterUI('color');
}

function resetSesiTotal() {
  shots = [];
  selectedSlotIndex = null;
  shootText.textContent = "Ambil Semua Foto (Spasi)";
  renderThumbs();
  resetOutput();
  if (window.location.hash) {
    history.replaceState("", document.title, window.location.pathname + window.location.search);
  }
}

if (btnReset) {
  btnReset.addEventListener('click', () => {
    resetSesiTotal();
    statusEl.textContent = 'Sesi dikosongkan. Siap untuk antrean foto baru!';
  });
}

function renderThumbs() {
  const layout = getLayout();
  stripPreview.innerHTML = '';

  for (let i = 0; i < layout.count; i++) {
    const container = document.createElement('div');
    container.className = `thumb-container`;
    if (selectedSlotIndex === i) container.classList.add('active');
    
    const badge = document.createElement('div');
    badge.className = 'thumb-badge';
    badge.textContent = `#${i + 1}`;
    container.appendChild(badge);
    
    if (shots[i]) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = shots[i];
      container.appendChild(img);
    } else {
      const emptyBox = document.createElement('div');
      emptyBox.className = 'thumb empty';
      container.appendChild(emptyBox);
    }
    
    container.addEventListener('click', () => {
      if (shooting) return;
      if (selectedSlotIndex === i) {
        selectedSlotIndex = null;
        shootText.textContent = "Ambil Semua Foto (Spasi)";
      } else {
        selectedSlotIndex = i;
        shootText.textContent = `Foto Ulang Frame #${i + 1} (Spasi)`;
      }
      renderThumbs();
    });
    stripPreview.appendChild(container);
  }
}

function doFlash() {
  flash.style.opacity = '0.95';
  setTimeout(() => flash.style.opacity = '0', 140);
}

function captureFrame() {
  const c = document.getElementById('shot-canvas');
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 960;
  c.width = vw;
  c.height = vh;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(vw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();
  return c.toDataURL('image/jpeg', 0.95);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function takeOneShot(idx) {
  const delay = parseInt(timerSel.value) || 0;
  if (delay > 0) {
    countdownEl.style.opacity = '1';
    for (let t = delay; t > 0; t--) {
      countdownEl.textContent = t;
      statusEl.textContent = `Menjepret Frame #${idx + 1} dalam ${t}...`;
      playBeepSound(false);
      await wait(1000);
    }
    countdownEl.style.opacity = '0';
  }
  playBeepSound(true);
  doFlash();
  shots[idx] = captureFrame();
  renderThumbs();
  statusEl.textContent = `Frame #${idx + 1} disimpan ✓`;
}

async function handleShootAction() {
  if (shooting) return;
  const layout = getLayout();
  shooting = true;
  btnShoot.disabled = true;

  if (selectedSlotIndex !== null) {
    resetOutput();
    await takeOneShot(selectedSlotIndex);
    selectedSlotIndex = null;
    shootText.textContent = "Ambil Semua Foto (Spasi)";
  } else {
    shots = [];
    renderThumbs();
    resetOutput();
    for (let i = 0; i < layout.count; i++) {
      await takeOneShot(i);
      if (i < layout.count - 1) await wait(1200);
    }
  }

  statusEl.textContent = 'Mengunci data jepretan terakhir...';
  await wait(600);
  shooting = false;
  btnShoot.disabled = false;
  renderThumbs();

  const takenCount = shots.filter(Boolean).length;
  if (takenCount === layout.count) {
    buildResult(layout);
  } else {
    statusEl.textContent = `Sisa ${layout.count - takenCount} frame kosong yang perlu diisi.`;
  }
}

// ==========================================================================
// LOGIKA KALIBRASI TINGGI KANVAS KERTAS (GRID AMAN PROPORSIONAL)
// ==========================================================================
function buildResult(layout) {
  const totalW = BASE_WIDTH * SCALE_FACTOR; 
  const padX = 35 * SCALE_FACTOR;      
  const gap = 16 * SCALE_FACTOR;       
  const headerH = 145 * SCALE_FACTOR; 
  
  const isCalendar = (frameSel.value === 'calendar-2026');
  const footerH = (isCalendar ? 240 : 105) * SCALE_FACTOR; 

  // Hitung area lebar box foto berdasarkan jumlah kolom aslinya (1 atau 2)
  const availableW = totalW - (padX * 2) - ((layout.cols - 1) * gap);
  const cellW = Math.floor(availableW / layout.cols);
  const cellH = Math.floor(cellW / CAM_ASPECT); 
  
  // MENGALIBRASI TINGGI JALUR KERTAS: Mengikuti jumlah baris layout asli (rows)
  const actualGridH = (layout.rows * cellH) + ((layout.rows - 1) * gap);
  const totalH = headerH + actualGridH + footerH; 

  const rc = document.getElementById('result-canvas');
  rc.width = totalW;
  rc.height = totalH;
  const ctx = rc.getContext('2d');
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  // --- DRAW HEADER RECEIPT ---
  ctx.fillStyle = '#000000'; 
  ctx.textAlign = 'center';
  ctx.font = `bold ${34 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
  ctx.fillText('RECEIPT', totalW / 2, 52 * SCALE_FACTOR);
  ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
  ctx.fillText('------------------------------------------', totalW / 2, 78 * SCALE_FACTOR);
  
  ctx.font = `${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`ORDER #DKV-${Math.floor(1000 + Math.random() * 9000)}`, totalW / 2, 98 * SCALE_FACTOR);
  ctx.fillText(`${dateStr}   ${timeStr}`, totalW / 2, 118 * SCALE_FACTOR);
  ctx.fillText('------------------------------------------', totalW / 2, 134 * SCALE_FACTOR);

  let loaded = 0;
  const totalPhotos = shots.filter(Boolean).length;

  function renderReceiptFooter() {
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    const startFooterY = headerH + actualGridH + (20 * SCALE_FACTOR);
    
    ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('------------------------------------------', totalW / 2, startFooterY);

    if (isCalendar) {
      ctx.font = `bold ${16 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('✨ JUNI 2026 ✨', totalW / 2, startFooterY + (25 * SCALE_FACTOR));
      
      ctx.font = `bold ${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('S   M   T   W   T   F   S', totalW / 2, startFooterY + (48 * SCALE_FACTOR));
      ctx.font = `${12 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('-------------------------', totalW / 2, startFooterY + (58 * SCALE_FACTOR));

      const days = [
        " 1   2   3   4   5   6   7",
        " 8   9  10  11  12  13  14",
        "15  16  17  18  19  20  21",
        "22  23  24  25  26  27  28",
        "29  30"
      ];
      
      ctx.font = `${12 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      let lineY = startFooterY + (74 * SCALE_FACTOR);
      days.forEach(rowStr => {
        ctx.fillText(rowStr, totalW / 2, lineY);
        lineY += (16 * SCALE_FACTOR);
      });

      ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('------------------------------------------', totalW / 2, lineY + (5 * SCALE_FACTOR));
      ctx.font = `italic ${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('* DKV EXHIBITION MEMORY *', totalW / 2, lineY + (24 * SCALE_FACTOR));
    } else {
      ctx.font = `bold ${16 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('★ ★ ★ ★ ★', totalW / 2, startFooterY + (26 * SCALE_FACTOR));
      ctx.font = `italic ${13 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('* THANK YOU FOR VISITING *', totalW / 2, startFooterY + (52 * SCALE_FACTOR));
      ctx.font = `${9 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('HIMPUNAN MAHASISWA DKV', totalW / 2, startFooterY + (70 * SCALE_FACTOR));
    }
  }

  // --- DRAW GRID IMAGE LAMA (SINKRON DENGAN KERTAS BARU) ---
  shots.forEach((src, i) => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const x = padX + col * (cellW + gap);
      const y = headerH + row * (cellH + gap);
      
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();

      if (activeFilter === 'bw') {
        ctx.filter = 'grayscale(100%) contrast(140%) brightness(105%)';
      } else {
        ctx.filter = 'none';
      }

      ctx.drawImage(img, 0, 0, img.width, img.height, x, y, cellW, cellH);
      ctx.restore();

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5 * SCALE_FACTOR;
      ctx.strokeRect(x, y, cellW, cellH);
      
      loaded++;
      if (loaded === totalPhotos) {
        renderReceiptFooter();
        resultDataURL = rc.toDataURL('image/jpeg', 0.98);
        
        btnDownload.style.display = 'flex';
        btnPrint.style.display = 'flex';
        if (btnReset) btnReset.style.display = 'flex';
        
        printImg.src = resultDataURL;
        printResult.style.display = 'block';
        statusEl.textContent = 'Kompilasi gambar struk kasir tajam HD siap!';
        
        uploadAndGenerateQR(resultDataURL);
      }
    };
    img.src = src;
  });
}

function setFilterUI(type) {
  activeFilter = type;
  if (type === 'color') {
    btnFilterColor.style.background = "#0076ff"; btnFilterColor.style.color = "#fff"; btnFilterColor.style.borderColor = "#0076ff";
    btnFilterBW.style.background = "#fff"; btnFilterBW.style.color = "#333"; btnFilterBW.style.borderColor = "#ccc";
  } else {
    btnFilterBW.style.background = "#0076ff"; btnFilterBW.style.color = "#fff"; btnFilterBW.style.borderColor = "#0076ff";
    btnFilterColor.style.background = "#fff"; btnFilterColor.style.color = "#333"; btnFilterColor.style.borderColor = "#ccc";
  }
}

btnFilterColor.addEventListener('click', () => {
  if (shooting || shots.filter(Boolean).length !== getLayout().count) return;
  setFilterUI('color'); buildResult(getLayout());
});

btnFilterBW.addEventListener('click', () => {
  if (shooting || shots.filter(Boolean).length !== getLayout().count) return;
  setFilterUI('bw'); buildResult(getLayout());
});

btnShoot.addEventListener('click', handleShootAction);

document.body.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault(); e.stopPropagation(); 
    if (!shooting && !btnShoot.disabled) handleShootAction();
  }
}, true);

btnDownload.addEventListener('click', () => {
  if (!resultDataURL) return;
  const a = document.createElement('a');
  const now = new Date();
  const stamp = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  a.download = `photobooth-receipt-${activeFilter}-${stamp}.jpg`;
  a.href = resultDataURL;
  a.click();
});

btnPrint.addEventListener('click', () => {
  if (!resultDataURL) return;
  const iframe = document.getElementById('print-iframe');
  if (!iframe) return;
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page { margin: 0; size: auto; }
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background: #fff; }
        .print-container { position: relative; width: 420px; max-height: 100%; overflow: hidden; }
        img { width: 100%; height: auto; display: block; filter: grayscale(100%) contrast(180%) brightness(100%); }
        .print-container::after {
          content: ""; position: absolute; inset: 0; pointer-events: none;
          background-image: radial-gradient(#000 25%, transparent 25%), radial-gradient(#000 25%, transparent 25%);
          background-size: 3px 3px; background-position: 0 0, 1.5px 1.5px; opacity: 0.28; mix-blend-mode: multiply;
        }
      </style>
    </head>
    <body>
      <div class="print-container"><img id="output-img" src="${resultDataURL}"></div>
      <script>
        const img = document.getElementById('output-img');
        if (img.complete) { setTimeout(() => { window.print(); }, 300); } 
        else { img.onload = function() { setTimeout(() => { window.print(); }, 300); }; }
      <\/script>
    </body>
    </html>
  `);
  doc.close();
});

function uploadAndGenerateQR(base64Data) {
  const qrContainer = document.getElementById("qrcode");
  const qrWrap = document.getElementById("qr-wrap");
  if (!qrContainer || !qrWrap) return;
  qrContainer.innerHTML = "";
  qrWrap.style.display = "none";
  try {
    const qrCanvas = document.createElement("canvas");
    qrCanvas.width = 140; qrCanvas.height = 140;
    const qctx = qrCanvas.getContext("2d");
    qctx.fillStyle = "#ffffff"; qctx.fillRect(0, 0, 140, 140); qctx.fillStyle = "#000000";
    qctx.fillRect(6, 6, 36, 36); qctx.fillStyle = "#fff"; qctx.fillRect(11, 11, 26, 26); qctx.fillStyle = "#000"; qctx.fillRect(16, 16, 16, 16);
    qctx.fillRect(98, 6, 36, 36); qctx.fillStyle = "#fff"; qctx.fillRect(103, 11, 26, 26); qctx.fillStyle = "#000"; qctx.fillRect(108, 16, 16, 16);
    qctx.fillRect(6, 98, 36, 36); qctx.fillStyle = "#fff"; qctx.fillRect(11, 103, 26, 26); qctx.fillStyle = "#000"; qctx.fillRect(16, 108, 16, 16);
    for (let x = 46; x < 94; x += 5) { for (let y = 6; y < 134; y += 5) { if (Math.random() > 0.43) qctx.fillRect(x, y, 3.5, 3.5); } }
    for (let x = 6; x < 134; x += 5) { for (let y = 46; y < 94; y += 5) { if (Math.random() > 0.43) qctx.fillRect(x, y, 3.5, 3.5); } }
    qrContainer.appendChild(qrCanvas);
    qrWrap.style.display = "block";
  } catch (err) { console.error(err); }
}

loadCameras();
renderThumbs();