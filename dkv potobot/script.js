// ==========================================================================
// 1. ENGINE DETEKSI HP PENGUNJUNG: MEMBONGKAR DATA MINI COMPRESSED VIA URL
// ==========================================================================
function checkVisitorMode() {
  if (window.location.hash && window.location.hash.startsWith('#p-')) {
    document.addEventListener("DOMContentLoaded", () => {
      const appEl = document.getElementById('photobooth-app');
      const dlEl = document.getElementById('download-page');
      if (appEl) appEl.style.display = 'none';
      if (dlEl) dlEl.style.display = 'flex';
      
      try {
        const compressedData = window.location.hash.substring(3);
        const originalBase64 = LZString.decompressFromEncodedURIComponent(compressedData);
        
        const visitorImg = document.getElementById('visitor-img');
        const visitorDl = document.getElementById('btn-visitor-download');
        
        if (originalBase64 && originalBase64.startsWith('data:image')) {
          if (visitorImg) visitorImg.src = originalBase64;
          if (visitorDl) visitorDl.href = originalBase64;
        } else {
          alert("Waduh, data foto terlalu besar atau tidak terbaca di HP ini.");
        }
      } catch (err) {
        alert("Gagal memproses gambar.");
      }
    });
    return true; 
  }
  return false; 
}

const isVisitor = checkVisitorMode();

if (!isVisitor) {
  document.addEventListener("DOMContentLoaded", () => {
    initPhotoboothStudio();
  });
}

function initPhotoboothStudio() {
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
  const SCALE_FACTOR = 2; // Diturunkan dari 3 ke 2 agar ukuran file tidak membuat QR Code Crash

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
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + (isFinal ? 0.3 : 0.08));
    } catch (e) {}
  }

  function getLayout() { return LAYOUTS[layoutSel.value]; }

  async function startCam(deviceId) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 640 } },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (video) video.srcObject = stream;
      if (camStatus) camStatus.textContent = 'Kamera aktif';
    } catch (e) { 
      if (camStatus) camStatus.textContent = 'Kamera bermasalah'; 
    }
  }

  async function loadCameras() {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (camSel) {
        camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`).join('');
        if (cams.length) startCam(cams[0].deviceId);
      }
    } catch (e) { 
      if (camSel) camSel.innerHTML = '<option>Akses ditolak</option>'; 
    }
  }

  if (camSel) camSel.addEventListener('change', () => startCam(camSel.value));
  if (layoutSel) layoutSel.addEventListener('change', () => { resetSesiTotal(); });

  function resetOutput() {
    if (btnDownload) btnDownload.style.display = 'none'; 
    if (btnPrint) btnPrint.style.display = 'none';
    if (btnReset) btnReset.style.display = 'none';
    if (printResult) printResult.style.display = 'none'; 
    resultDataURL = null;
  }

  function resetSesiTotal() {
    shots = []; selectedSlotIndex = null; 
    if (shootText) shootText.textContent = "Ambil Semua Foto (Spasi)";
    renderThumbs(); resetOutput();
  }

  if (btnReset) btnReset.addEventListener('click', () => { resetSesiTotal(); });

  function renderThumbs() {
    if (!stripPreview) return;
    const layout = getLayout(); stripPreview.innerHTML = '';
    for (let i = 0; i < layout.count; i++) {
      const container = document.createElement('div'); container.className = `thumb-container`;
      if (selectedSlotIndex === i) container.classList.add('active');
      const badge = document.createElement('div'); badge.className = 'thumb-badge'; badge.textContent = `#${i + 1}`; container.appendChild(badge);
      if (shots[i]) {
        const img = document.createElement('img'); img.className = 'thumb'; img.src = shots[i]; container.appendChild(img);
      } else {
        const emptyBox = document.createElement('div'); emptyBox.className = 'thumb empty'; container.appendChild(emptyBox);
      }
      stripPreview.appendChild(container);
    }
  }

  function doFlash() { if (flash) { flash.style.opacity = '0.95'; setTimeout(() => flash.style.opacity = '0', 140); } }

  function captureFrame() {
    const c = document.getElementById('shot-canvas');
    c.width = 400; c.height = 300; // Perkecil resolusi frame mentah agar tidak overload
    const ctx = c.getContext('2d');
    ctx.save(); ctx.translate(400, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, 400, 300); ctx.restore();
    return c.toDataURL('image/jpeg', 0.60); // Turunkan kualitas ke 60% khusus pengiriman data QR
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function takeOneShot(idx) {
    const delay = parseInt(timerSel.value) || 0;
    if (delay > 0 && countdownEl) {
      countdownEl.style.opacity = '1';
      for (let t = delay; t > 0; t--) { countdownEl.textContent = t; playBeepSound(false); await wait(1000); }
      countdownEl.style.opacity = '0';
    }
    playBeepSound(true); doFlash(); shots[idx] = captureFrame(); renderThumbs();
  }

  async function handleShootAction() {
    if (shooting) return; const layout = getLayout(); shooting = true; if (btnShoot) btnShoot.disabled = true;
    shots = []; renderThumbs(); resetOutput(); 
    for (let i = 0; i < layout.count; i++) { await takeOneShot(i); if (i < layout.count - 1) await wait(1200); }
    shooting = false; if (btnShoot) btnShoot.disabled = false;
    if (shots.filter(Boolean).length === layout.count) buildResult(layout);
  }

  function buildResult(layout) {
    const totalW = BASE_WIDTH * SCALE_FACTOR; const padX = 35 * SCALE_FACTOR; const gap = 16 * SCALE_FACTOR; const headerH = 145 * SCALE_FACTOR;
    const isCalendar = (frameSel.value === 'calendar-2026'); const footerH = (isCalendar ? 240 : 105) * SCALE_FACTOR;
    
    const availableW = totalW - (padX * 2) - ((layout.cols - 1) * gap);
    const cellW = Math.floor(availableW / layout.cols); const cellH = Math.floor(cellW / CAM_ASPECT);
    const actualGridH = (layout.rows * cellH) + ((layout.rows - 1) * gap); const totalH = headerH + actualGridH + footerH;

    const rc = document.getElementById('result-canvas'); rc.width = totalW; rc.height = totalH; const ctx = rc.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, totalW, totalH);

    ctx.fillStyle = '#000000'; ctx.textAlign = 'center'; ctx.font = `bold ${24 * SCALE_FACTOR}px monospace`;
    ctx.fillText('RECEIPT', totalW / 2, 52 * SCALE_FACTOR);

    let loadedCount = 0;
    const activeShots = shots.filter(Boolean);

    activeShots.forEach((src, i) => {
      const img = new Image();
      img.onload = () => {
        const col = i % layout.cols; const row = Math.floor(i / layout.cols);
        const x = padX + col * (cellW + gap); const y = headerH + row * (cellH + gap);
        ctx.save(); ctx.drawImage(img, x, y, cellW, cellH); ctx.restore();
        
        loadedCount++;
        if (loadedCount === activeShots.length) {
          resultDataURL = rc.toDataURL('image/jpeg', 0.50); // Kompresi maksimal 50% agar QR CODE PASTI MUNCUL
          if (printImg) printImg.src = resultDataURL; 
          if (printResult) printResult.style.display = 'block';
          if (btnDownload) btnDownload.style.display = 'flex'; 
          if (btnPrint) btnPrint.style.display = 'flex'; 
          if (btnReset) btnReset.style.display = 'flex';
          
          generateCleanQRCode(resultDataURL);
        }
      }; img.src = src;
    });
  }

  // ==========================================================================
  // GENERATOR QR CODE DENGAN VALIDASI KAPASITAS (ANTI-CRASH)
  // ==========================================================================
  function generateCleanQRCode(base64Data) {
    const qrContainer = document.getElementById("qrcode");
    const qrWrap = document.getElementById("qr-wrap");
    if (!qrContainer || !qrWrap) return;
    
    qrContainer.innerHTML = ""; 
    
    try {
      // Mengompres string gambar
      const compressedToken = LZString.compressToEncodedURIComponent(base64Data);
      const universalUrl = window.location.origin + window.location.pathname + "#p-" + compressedToken;
      
      // Keamanan deteksi panjang karakter: Jika terlalu besar, gunakan fallback otomatis
      if (universalUrl.length > 2500) {
        // Fallback jika string melampaui limit QRCodeJS standar:
        qrContainer.innerHTML = "<p style='font-size:11px;color:red;font-weight:bold;'>Foto Terlalu Padat untuk QR Offline.<br>Silakan Klik Tombol 'Download' di Laptop Panitia.</p>";
        qrWrap.style.display = "block";
        return;
      }

      new QRCode(qrContainer, {
        text: universalUrl,
        width: 120,
        height: 120,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L // Low correction level agar menampung data besar
      });
      
      qrWrap.style.display = "block";
    } catch (e) {
      qrContainer.innerHTML = "<p style='font-size:11px;color:red;'>Gagal memuat QR Code.</p>";
    }
  }

  if (btnShoot) btnShoot.addEventListener('click', handleShootAction);

  if (btnDownload) btnDownload.addEventListener('click', () => {
    if (!resultDataURL) return; const a = document.createElement('a');
    a.download = `photobooth.jpg`; a.href = resultDataURL; a.click();
  });

  loadCameras();
  renderThumbs();
}
