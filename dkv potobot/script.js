document.addEventListener("DOMContentLoaded", () => {
  initPhotoboothStudio();
});

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
  const stripPreview = document.getElementById('strip-preview');
  const flash = document.getElementById('flash');
  const printResult = document.getElementById('print-result');
  const printImg = document.getElementById('print-img');
  const printIframe = document.getElementById('print-iframe');
  const qrStatusText = document.getElementById('qr-status-text');

  const btnFilterColor = document.getElementById('btn-filter-color');
  const btnFilterBW = document.getElementById('btn-filter-bw');
  const btnFilterDither = document.getElementById('btn-filter-dither');

  let shots = [];
  let shooting = false;
  let stream = null;
  let rawStrukCanvas = null; // Menyimpan master kanvas berwarna asli
  let currentFilter = 'color'; 

  const CAM_ASPECT = 4 / 3; 
  const BASE_WIDTH = 420;   // Lebar cetak struk kasir
  const SCALE_FACTOR = 2.5; // Keseimbangan ketajaman print dan performa filter dither

  const LAYOUTS = {
    strip3: { count: 3, cols: 1, rows: 3 }, 
    grid4:  { count: 4, cols: 2, rows: 2 }, 
    single: { count: 1, cols: 1, rows: 1 }
  };

  function getLayout() { return LAYOUTS[layoutSel.value]; }

  // ALGORITMA FILTER HALFTONE / FLOYD-STEINBERG DITHERING KASIR MURNI
  function applyDitherFilter(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    
    for (let i = 0; i < d.length; i += 4) {
      // Hitung luminance grayscale standar kasir
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      
      // Tambahkan pola struktur kontras buatan (Halftone simulated threshold)
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      const pattern = ((x % 2 === 0 && y % 2 === 0) || (x % 3 === 0 && y % 3 === 0)) ? 15 : -15;
      
      const finalVal = (gray + pattern) > 128 ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = finalVal;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ALGORITMA FILTER RETRO HITAM PUTIH (B&W) HIGH CONTRAST
  function applyGrayscaleFilter(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2]);
      // Sederhanakan kontras hitam putih kasir retro
      const contrast = 1.2;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      const finalVal = factor * (v - 128) + 128;
      d[i] = d[i+1] = d[i+2] = finalVal;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // DETEKSI & STRUKTUR AKTIVASI FILTER
  function processActiveFilter() {
    if (!rawStrukCanvas) return;
    
    const finalCanvas = document.getElementById('filter-canvas');
    finalCanvas.width = rawStrukCanvas.width;
    finalCanvas.height = rawStrukCanvas.height;
    const fCtx = finalCanvas.getContext('2d');
    
    // Copy kanvas master berwarna ke kanvas pemrosesan filter
    fCtx.drawImage(rawStrukCanvas, 0, 0);

    if (currentFilter === 'bw') {
      applyGrayscaleFilter(fCtx, finalCanvas.width, finalCanvas.height);
    } else if (currentFilter === 'dither') {
      applyDitherFilter(fCtx, finalCanvas.width, finalCanvas.height);
    }

    const outputDataURL = finalCanvas.toDataURL('image/jpeg', 0.85);
    printImg.src = outputDataURL;
    return outputDataURL;
  }

  function setFilterUI(type) {
    currentFilter = type;
    btnFilterColor.classList.remove('active-filter');
    btnFilterBW.classList.remove('active-filter');
    btnFilterDither.classList.remove('active-filter');
    
    if (type === 'color') btnFilterColor.classList.add('active-filter');
    if (type === 'bw') btnFilterBW.classList.add('active-filter');
    if (type === 'dither') btnFilterDither.classList.add('active-filter');
    
    processActiveFilter();
  }

  btnFilterColor.addEventListener('click', () => setFilterUI('color'));
  btnFilterBW.addEventListener('click', () => setFilterUI('bw'));
  btnFilterDither.addEventListener('click', () => setFilterUI('dither'));

  // KAMERA CORE
  async function startCam(deviceId) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 1280 } },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
    } catch (e) { console.log('Kamera error'); }
  }

  async function loadCameras() {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`).join('');
      if (cams.length) startCam(cams[0].deviceId);
    } catch (e) {}
  }

  camSel.addEventListener('change', () => startCam(camSel.value));
  layoutSel.addEventListener('change', () => resetSesiTotal());
  frameSel.addEventListener('change', () => { if (shots.length === getLayout().count) buildMasterStruk(); });

  function resetSesiTotal() {
    shots = [];
    shootText.textContent = "Ambil Semua Foto (Spasi)";
    statusEl.textContent = "Sesi kosong. Siap mengambil foto baru.";
    btnDownload.style.display = 'none'; btnPrint.style.display = 'none'; btnReset.style.display = 'none';
    printResult.style.display = 'none'; 
    rawStrukCanvas = null; currentFilter = 'color';
    btnFilterColor.classList.add('active-filter');
    btnFilterBW.classList.remove('active-filter');
    btnFilterDither.classList.remove('active-filter');
    renderThumbs();
  }

  btnReset.addEventListener('click', resetSesiTotal);

  function renderThumbs() {
    const layout = getLayout();
    stripPreview.innerHTML = '';
    for (let i = 0; i < layout.count; i++) {
      const container = document.createElement('div'); container.className = 'thumb-container';
      const badge = document.createElement('div'); badge.className = 'thumb-badge'; badge.textContent = `#${i + 1}`; container.appendChild(badge);
      if (shots[i]) {
        const img = document.createElement('img'); img.className = 'thumb'; img.src = shots[i]; container.appendChild(img);
      } else {
        const emptyBox = document.createElement('div'); emptyBox.className = 'thumb empty'; container.appendChild(emptyBox);
      }
      stripPreview.appendChild(container);
    }
  }

  function captureFrame() {
    const c = document.getElementById('shot-canvas');
    const vw = video.videoWidth || 1280; const vh = video.videoHeight || 960;
    c.width = vw; c.height = vh;
    const ctx = c.getContext('2d');
    ctx.save(); ctx.translate(vw, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh); ctx.restore();
    return c.toDataURL('image/jpeg', 0.9);
  }

  async function handleShootAction() {
    if (shooting) return;
    const layout = getLayout(); shooting = true; btnShoot.disabled = true;
    shots = []; renderThumbs();
    btnDownload.style.display = 'none'; btnPrint.style.display = 'none'; printResult.style.display = 'none';

    const timerDelay = parseInt(timerSel.value) || 0;
    for (let i = 0; i < layout.count; i++) {
      if (timerDelay > 0) {
        countdownEl.style.opacity = '1';
        for (let t = timerDelay; t > 0; t--) {
          countdownEl.textContent = t;
          statusEl.textContent = `Foto ke-${i + 1} bersiap dalam ${t}...`;
          await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.style.opacity = '0';
      }
      flash.style.opacity = '0.9'; setTimeout(() => flash.style.opacity = '0', 120);
      shots.push(captureFrame()); renderThumbs();
      statusEl.textContent = `Foto ${i + 1}/${layout.count} aman ✓`;
      if (i < layout.count - 1) await new Promise(r => setTimeout(r, 1200));
    }
    statusEl.textContent = "Menyusun struk belanja kasir...";
    shooting = false; btnShoot.disabled = false;
    buildMasterStruk();
  }

  // PENYUSUNAN STRUK UTAMA
  function buildMasterStruk() {
    const layout = getLayout();
    const isCalendar = (frameSel.value === 'calendar-2026');
    
    const totalW = BASE_WIDTH * SCALE_FACTOR;
    const padX = 32 * SCALE_FACTOR; const gap = 14 * SCALE_FACTOR; const headerH = 150 * SCALE_FACTOR;
    const footerH = (isCalendar ? 250 : 110) * SCALE_FACTOR;
    
    const availableW = totalW - (padX * 2) - ((layout.cols - 1) * gap);
    const cellW = Math.floor(availableW / layout.cols); const cellH = Math.floor(cellW / CAM_ASPECT);
    const actualGridH = (layout.rows * cellH) + ((layout.rows - 1) * gap);
    const totalH = headerH + actualGridH + footerH;

    rawStrukCanvas = document.getElementById('result-canvas');
    rawStrukCanvas.width = totalW; rawStrukCanvas.height = totalH;
    const ctx = rawStrukCanvas.getContext('2d');

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, totalW, totalH);
    ctx.fillStyle = '#000000'; ctx.textAlign = 'center';
    ctx.font = `bold ${30 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('RECEIPT', totalW / 2, 55 * SCALE_FACTOR);
    ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('------------------------------------------', totalW / 2, 85 * SCALE_FACTOR);
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    ctx.font = `${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText(`ORDER #DKV-${Math.floor(1000 + Math.random() * 9000)}`, totalW / 2, 105 * SCALE_FACTOR);
    ctx.fillText(`${dateStr}   ${timeStr}`, totalW / 2, 125 * SCALE_FACTOR);
    ctx.fillText('------------------------------------------', totalW / 2, 142 * SCALE_FACTOR);

    let loaded = 0;
    shots.forEach((src, i) => {
      const img = new Image();
      img.onload = () => {
        const col = i % layout.cols; const row = Math.floor(i / layout.cols);
        const x = padX + col * (cellW + gap); const y = headerH + row * (cellH + gap);
        ctx.drawImage(img, x, y, cellW, cellH);
        ctx.strokeStyle = '#000000'; ctx.lineWidth = 2 * SCALE_FACTOR; ctx.strokeRect(x, y, cellW, cellH);
        
        loaded++;
        if (loaded === shots.length) {
          drawMasterFooter(ctx, totalW, headerH + actualGridH, isCalendar);
        }
      }; img.src = src;
    });
  }

  function drawMasterFooter(ctx, totalW, startFooterY, isCalendar) {
    ctx.fillStyle = '#000000'; ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('------------------------------------------', totalW / 2, startFooterY + (15 * SCALE_FACTOR));

    if (isCalendar) {
      ctx.font = `bold ${15 * SCALE_FACTOR}px "Courier New", Courier, monospace`; ctx.fillText('✨ JUNI 2026 ✨', totalW / 2, startFooterY + (40 * SCALE_FACTOR));
      ctx.font = `bold ${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`; ctx.fillText('S   M   T   W   T   F   S', totalW / 2, startFooterY + (65 * SCALE_FACTOR));
      const days = ["    1   2   3   4   5   6", "7   8   9  10  11  12  13", "14 15  16  17  18  19  20", "21 22  23  24  25  26  27", "28 29  30"];
      let lineY = startFooterY + (85 * SCALE_FACTOR);
      days.forEach(rowStr => { ctx.fillText(rowStr, totalW / 2, lineY); lineY += (18 * SCALE_FACTOR); });
    } else {
      ctx.font = `bold ${16 * SCALE_FACTOR}px "Courier New", Courier, monospace`; ctx.fillText('★ ★ ★ ★ ★', totalW / 2, startFooterY + (45 * SCALE_FACTOR));
      ctx.font = `italic ${12 * SCALE_FACTOR}px "Courier New", Courier, monospace`; ctx.fillText('* THANK YOU FOR VISITING *', totalW / 2, startFooterY + (68 * SCALE_FACTOR));
      ctx.font = `${9 * SCALE_FACTOR}px "Courier New", Courier, monospace`; ctx.fillText('HIMPUNAN MAHASISWA DKV', totalW / 2, startFooterY + (88 * SCALE_FACTOR));
    }

    printResult.style.display = 'block';
    btnDownload.style.display = 'inline-flex'; btnPrint.style.display = 'inline-flex'; btnReset.style.display = 'inline-flex';
    statusEl.textContent = "Struk dimuat! Set filter kasir Anda di bawah.";

    // Otomatis pasang filter dither halftone saat selesai render pertama kali agar siap cetak kasir
    setFilterUI('dither'); 
    buatQRCodeTautan();
  }

  // MEMBUAT QR CODE AMAN & FUNGSIONAL
  function buatQRCodeTautan() {
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = "";
    qrStatusText.textContent = "Tautan unduhan aktif.";
    
    // Alamat URL lokal atau online tempat aplikasi ditaruh
    const appUrl = window.location.origin + window.location.pathname;

    new QRCode(qrContainer, {
      text: appUrl,
      width: 100,
      height: 100,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.M
    });
    qrStatusText.textContent = "QR Code lokal siap scan. Printer mendeteksi filter terpilih secara live.";
  }

  // OPERASIONAL TOMBOL DOWNLOAD & PRINT
  btnDownload.addEventListener('click', () => {
    const finalImageURL = processActiveFilter();
    if (!finalImageURL) return;
    const a = document.createElement('a');
    a.download = `photobooth-kasir-${Date.now()}.jpg`;
    a.href = finalImageURL; a.click();
  });

  btnPrint.addEventListener('click', () => {
    const imageToPrint = processActiveFilter();
    if (!imageToPrint) return;
    
    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(`
      <html>
      <head>
        <style>
          @page { margin: 0; }
          html, body { margin: 0; padding: 0; width: 100%; display: flex; justify-content: center; background: #fff; }
          .print-box { width: 420px; }
          img { width: 100%; height: auto; display: block; }
        </style>
      </head>
      <body>
        <div class="print-box"><img src="${imageToPrint}"></div>
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 250);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  });

  document.body.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !shooting && !btnShoot.disabled) {
      e.preventDefault(); handleShootAction();
    }
  });

  loadCameras();
  renderThumbs();
}
