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
  const btnPrint = document.getElementById('btnPrint') || document.getElementById('btn-print');
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
  const qrStatusText = document.getElementById('qr-status-text');

  const btnRetake = document.getElementById('btn-action-retake');
  const btnNext = document.getElementById('btn-action-next');

  let shots = [];       
  let gifShots = [];    
  let shooting = false;
  let stream = null;
  let rawStrukCanvas = null; 
  let currentFilter = 'dither'; 
  
  let currentActiveSlot = 0; 
  let isWaitingConfirmation = false; 

  const CAM_ASPECT = 4 / 3; 
  const BASE_WIDTH = 420;   
  const SCALE_FACTOR = 2.5; 

  const LAYOUTS = {
    strip3: { count: 3, cols: 1, rows: 3 }, 
    grid4:  { count: 4, cols: 2, rows: 2 }, 
    single: { count: 1, cols: 1, rows: 1 }
  };

  function getLayout() { return LAYOUTS[layoutSel.value]; }

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

  function applyDitherFilter(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      const x = (i / 4) % width;
      const y = Math.floor((i / 4) / width);
      const pattern = ((x % 2 === 0 && y % 2 === 0) || (x % 3 === 0 && y % 3 === 0)) ? 15 : -15;
      const finalVal = (gray + pattern) > 128 ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = finalVal;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // RETRO GRAYSCALE CONTRAST
  function applyGrayscaleFilter(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (0.2126 * d[i] + 0.7152 * d[i+1] + 0.0722 * d[i+2]);
      const contrast = 1.2;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      const finalVal = factor * (v - 128) + 128;
      d[i] = d[i+1] = d[i+2] = finalVal;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function processActiveFilter() {
    if (!rawStrukCanvas) return null;
    const finalCanvas = document.getElementById('filter-canvas');
    finalCanvas.width = rawStrukCanvas.width;
    finalCanvas.height = rawStrukCanvas.height;
    const fCtx = finalCanvas.getContext('2d');
    fCtx.drawImage(rawStrukCanvas, 0, 0);

    if (currentFilter === 'bw') {
      applyGrayscaleFilter(fCtx, finalCanvas.width, finalCanvas.height);
    } else if (currentFilter === 'dither') {
      applyDitherFilter(fCtx, finalCanvas.width, finalCanvas.height);
    }

    const outputDataURL = finalCanvas.toDataURL('image/jpeg', 0.85);
    if(printImg) printImg.src = outputDataURL;
    return outputDataURL;
  }

  function setFilterUI(type) {
    currentFilter = type;
    const btnFilterColor = document.getElementById('btn-filter-color');
    const btnFilterBW = document.getElementById('btn-filter-bw');
    const btnFilterDither = document.getElementById('btn-filter-dither');
    
    if(btnFilterColor) btnFilterColor.classList.remove('active-filter');
    if(btnFilterBW) btnFilterBW.classList.remove('active-filter');
    if(btnFilterDither) btnFilterDither.classList.remove('active-filter');
    
    if (type === 'color' && btnFilterColor) btnFilterColor.classList.add('active-filter');
    if (type === 'bw' && btnFilterBW) btnFilterBW.classList.add('active-filter');
    if (type === 'dither' && btnFilterDither) btnFilterDither.classList.add('active-filter');
    
    processActiveFilter();
  }

  const btnFilterColor = document.getElementById('btn-filter-color');
  const btnFilterBW = document.getElementById('btn-filter-bw');
  const btnFilterDither = document.getElementById('btn-filter-dither');
  if(btnFilterColor) btnFilterColor.addEventListener('click', () => setFilterUI('color'));
  if(btnFilterBW) btnFilterBW.addEventListener('click', () => setFilterUI('bw'));
  if(btnFilterDither) btnFilterDither.addEventListener('click', () => setFilterUI('dither'));

  // CAMERA ENGINE
  async function startCam(deviceId) {
    if (shooting || isWaitingConfirmation) return; 

    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    
    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
        audio: false
      };
      
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      
      video.onloadedmetadata = () => {
        video.play().catch(e => console.log("Play interrupted"));
        if (camStatus) camStatus.textContent = 'Kamera Aktif';
      };
    } catch (e) {
      console.error("Gagal startCam:", e);
      if (camStatus) camStatus.textContent = 'Kamera error / sibuk';
    }
  }

  async function loadCameras() {
    if (camStatus) camStatus.textContent = 'Mendeteksi...';
    try {
      const initialStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      initialStream.getTracks().forEach(track => track.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      
      if (cams.length === 0) {
        if (camSel) camSel.innerHTML = '<option value="">Kamera tidak ditemukan</option>';
        if (camStatus) camStatus.textContent = 'No Camera';
        return;
      }

      if (camSel) {
        camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`).join('');
      }
      
      await startCam(cams[0].deviceId);
    } catch (e) {
      console.error("Gagal loadCameras:", e);
      if (camStatus) camStatus.textContent = 'Izin kamera ditolak';
      if (camSel) camSel.innerHTML = '<option value="">Akses Kamera Ditolak</option>';
    }
  }

  camSel.addEventListener('change', () => startCam(camSel.value));
  layoutSel.addEventListener('change', () => resetSesiTotal());
  frameSel.addEventListener('change', () => { if (shots.length === getLayout().count) buildMasterStruk(); });

  function resetSesiTotal() {
    shots = [];
    gifShots = [];
    currentActiveSlot = 0;
    isWaitingConfirmation = false;
    
    btnShoot.style.display = "inline-flex";
    btnShoot.disabled = false;
    shootText.textContent = "Ambil Foto #1 (Spasi)";
    
    if(btnRetake) btnRetake.style.display = "none";
    if(btnNext) btnNext.style.display = "none";
    
    statusEl.textContent = "Kamera siap. Tekan tombol atau spasi untuk mulai foto.";
    if(btnDownload) btnDownload.style.display = 'none'; 
    if(btnPrint) btnPrint.style.display = 'none'; 
    if(btnReset) btnReset.style.display = 'none';
    if(printResult) printResult.style.display = 'none'; 
    rawStrukCanvas = null; currentFilter = 'dither';
    setFilterUI('dither');
    renderThumbs();
  }

  if(btnReset) btnReset.addEventListener('click', resetSesiTotal);

  function renderThumbs() {
    const layout = getLayout();
    stripPreview.innerHTML = '';
    for (let i = 0; i < layout.count; i++) {
      const container = document.createElement('div'); container.className = 'thumb-container';
      if (i === currentActiveSlot && !isWaitingConfirmation) {
        container.style.borderColor = "#0076ff";
        container.style.boxShadow = "0 0 0 3px rgba(0, 118, 255, 0.2)";
      }
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
    const targetAspect = 4 / 3;
    let sWidth = vw; let sHeight = vh; let sx = 0; let sy = 0;
    if (vw / vh > targetAspect) { sWidth = vh * targetAspect; sx = (vw - sWidth) / 2; } 
    else { sHeight = vw / targetAspect; sy = (vh - sHeight) / 2; }

    c.width = 400; c.height = 300; 
    const ctx = c.getContext('2d');
    ctx.save(); ctx.translate(400, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, 400, 300); ctx.restore();
    return c.toDataURL('image/jpeg', 0.8);
  }

  async function captureBurstFrames() {
    const currentSlotFrames = [];
    for (let i = 0; i < 5; i++) {
      currentSlotFrames.push(captureFrame());
      await new Promise(r => setTimeout(r, 120));
    }
    const reversed = [...currentSlotFrames].reverse().slice(1, -1);
    gifShots[currentActiveSlot] = currentSlotFrames.concat(reversed);
  }

  async function handleShootAction() {
    if (shooting) return; 
    shooting = true;
    btnShoot.disabled = true;
    
    if(btnDownload) btnDownload.style.display = 'none'; 
    if(btnPrint) btnPrint.style.display = 'none'; 
    if(printResult) printResult.style.display = 'none';

    const timerDelay = parseInt(timerSel.value) || 0;
    if (timerDelay > 0 && countdownEl) {
      countdownEl.style.opacity = '1';
      for (let t = timerDelay; t > 0; t--) {
        countdownEl.textContent = t;
        statusEl.textContent = `Foto ke-${currentActiveSlot + 1} bersiap dalam ${t}...`;
        playBeepSound(false); 
        await new Promise(r => setTimeout(r, 1000));
      }
      countdownEl.style.opacity = '0';
    }
    
    playBeepSound(true); 
    if (flash) {
      flash.style.opacity = '0.9'; 
      setTimeout(() => flash.style.opacity = '0', 120);
    }
    
    shots[currentActiveSlot] = captureFrame(); 
    renderThumbs();

    await captureBurstFrames();

    shooting = false;
    isWaitingConfirmation = true;
    btnShoot.style.display = "none";
    if(btnRetake) btnRetake.style.display = "inline-flex";
    if(btnNext) btnNext.style.display = "inline-flex";
    
    statusEl.innerHTML = `Foto #${currentActiveSlot + 1} tertangkap!`;
  }

  function handleNextAction() {
    if (!isWaitingConfirmation) return;
    const layout = getLayout();
    isWaitingConfirmation = false;
    
    if(btnRetake) btnRetake.style.display = "none";
    if(btnNext) btnNext.style.display = "none";
    btnShoot.style.display = "inline-flex";
    
    currentActiveSlot++;
    
    if (currentActiveSlot < layout.count) {
      shootText.textContent = `Ambil Foto #${currentActiveSlot + 1} (Spasi)`;
      renderThumbs();
      setTimeout(() => { handleShootAction(); }, 200);
    } else {
      btnShoot.disabled = true;
      shootText.textContent = "Selesai!";
      statusEl.textContent = "Menyusun struk belanja kasir & merender GIF...";
      buildMasterStruk();
    }
  }

  function handleRetakeAction() {
    if (!isWaitingConfirmation) return;
    isWaitingConfirmation = false;
    
    if(btnRetake) btnRetake.style.display = "none";
    if(btnNext) btnNext.style.display = "none";
    btnShoot.style.display = "inline-flex";
    
    shootText.textContent = `Foto Ulang #${currentActiveSlot + 1} (Spasi)`;
    renderThumbs();
    setTimeout(() => { handleShootAction(); }, 200);
  }

  if(btnNext) btnNext.addEventListener('click', (e) => { e.preventDefault(); handleNextAction(); });
  if(btnRetake) btnRetake.addEventListener('click', (e) => { e.preventDefault(); handleRetakeAction(); });
  if(btnNext) btnNext.addEventListener('touchstart', (e) => { e.preventDefault(); handleNextAction(); }, { passive: false });
  if(btnRetake) btnRetake.addEventListener('touchstart', (e) => { e.preventDefault(); handleRetakeAction(); }, { passive: false });

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

    if(printResult) printResult.style.display = 'block';
    if(btnDownload) btnDownload.style.display = 'inline-flex'; 
    if(btnPrint) btnPrint.style.display = 'inline-flex'; 
    if(btnReset) btnReset.style.display = 'inline-flex';
    btnShoot.style.display = "inline-flex";
    btnShoot.disabled = false;
    shootText.textContent = "Sesi Selesai ✓";
    statusEl.textContent = "Struk dimuat! Mengonversi Boomerang ke QR...";

    processActiveFilter();
    compileAllShotsToGif();
  }

  function compileAllShotsToGif() {
    if (qrStatusText) qrStatusText.textContent = "⏳ Merangkai Animasi Boomerang (GIF)...";
    
    let allFlattenedFrames = [];
    gifShots.forEach(slotFrames => {
      if(slotFrames && slotFrames.length) {
        allFlattenedFrames = allFlattenedFrames.concat(slotFrames);
      }
    });

    if(!allFlattenedFrames.length) return;

    if (typeof gifshot === 'undefined') {
      if (qrStatusText) qrStatusText.textContent = "⚠️ Library Gifshot belum masuk. Menggunakan backup gambar.";
      uploadKeCloudDanBuatQR(processActiveFilter());
      return;
    }

    gifshot.createGIF({
      images: allFlattenedFrames,
      gifWidth: 400,
      gifHeight: 300,
      interval: 0.12, 
      numWorkers: 2
    }, function (obj) {
      if (!obj.error) {
        uploadKeCloudDanBuatQR(obj.image);
      } else {
        uploadKeCloudDanBuatQR(processActiveFilter());
      }
    });
  }

  // ==========================================================================
  // LOGIKA CORE UPLOAD SUPABASE CLOUD (PERBAIKAN TOTAL)
  // ==========================================================================
  function uploadKeCloudDanBuatQR(base64GifData) {
    const qrContainer = document.getElementById("qrcode");
    if (!qrContainer) return;
    qrContainer.innerHTML = ""; 

    if (qrStatusText) { 
      qrStatusText.textContent = "⏳ Mengamankan Foto & Boomerang ke Supabase Cloud..."; 
      qrStatusText.style.color = "#2563eb"; 
    }

    const SUPABASE_URL = "https://xwismjpikwenkqrfeykn.supabase.co"; 
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXNtanBpa3dlbmtxcmZleWtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTY5NjYsImV4cCI6MjA5NzE3Mjk2Nn0.aRtM5WdBAZJE0Ma-UcqlkG5hnmqOqpUDiv3UUvi19r8";
    
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const base64ToBlob = (base64Str, contentType) => {
      const byteCharacters = atob(base64Str.split(',')[1] || base64Str);
      const byteArrays = [];
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      return new Blob(byteArrays, { type: contentType });
    };

    const fileId = `dkv-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const blobFoto = base64ToBlob(processActiveFilter(), "image/jpeg");
    const blobGif = base64ToBlob(base64GifData, "image/gif");

    Promise.all([
      supabaseClient.storage.from('Photoboth').upload(`photos/${fileId}.jpg`, blobFoto, { contentType: 'image/jpeg' }),
      supabaseClient.storage.from('Photoboth').upload(`videos/${fileId}.gif`, blobGif, { contentType: 'image/gif' })
    ])
    .then(([resFoto, resGif]) => {
      if (resFoto.error || resGif.error) {
        throw new Error(resFoto.error?.message || resGif.error?.message);
      }

      const pathFoto = encodeURIComponent(`photos/${fileId}.jpg`);
      const pathGif = encodeURIComponent(`videos/${fileId}.gif`);

      const baseAppUrl = window.location.origin + window.location.pathname;
      const finalUrlWithParams = `${baseAppUrl}#dl?f=${pathFoto}&v=${pathGif}`;

      new QRCode(qrContainer, { 
        text: finalUrlWithParams, 
        width: 100, 
        height: 100, 
        colorDark : "#000000", 
        colorLight : "#ffffff", 
        correctLevel : QRCode.CorrectLevel.M 
      });

      if (qrStatusText) { 
        qrStatusText.textContent = "✓ QR Code Cloud Aktif! Scan untuk download file."; 
        qrStatusText.style.color = "#15803d"; 
      }
    })
    .catch((err) => {
      console.error("Supabase Error:", err);
      qrContainer.innerHTML = "<b style='color:#b91c1c;font-size:11px;'>OFFLINE</b>";
      if (qrStatusText) { 
        qrStatusText.textContent = "⚠️ Jaringan sibuk. Silakan download manual via laptop."; 
        qrStatusText.style.color = "#b91c1c"; 
      }
    });
  }

  // ==========================================================================
  // JALUR BONGKAR DI HP: Ambil File dari Supabase Storage
  // ==========================================================================
  function periksaModePengunjungHP() {
    const hash = window.location.hash;
    if (hash && (hash.startsWith('#dl') || hash.includes('?f='))) {
      const appStudio = document.getElementById('Photoboth-app');
      const pageDownloadHP = document.getElementById('visitor-download-page');
      
      if (appStudio) appStudio.style.display = 'none';
      if (pageDownloadHP) pageDownloadHP.style.display = 'flex';

      try {
        const bagianParameter = hash.includes('?') ? hash.split('?')[1] : '';
        if (!bagianParameter) return;

        const searchParams = new URLSearchParams(bagianParameter);
        const pathFoto = searchParams.get('f');
        const pathGif = searchParams.get('v');

        const btnDlPhoto = document.getElementById('btn-dl-photo');
        const btnDlVideo = document.getElementById('btn-dl-video');

        const SUPABASE_URL = "https://xwismjpikwenkqrfeykn.supabase.co";

        if (pathFoto && btnDlPhoto) {
          btnDlPhoto.href = `${SUPABASE_URL}/storage/v1/object/public/Photoboth/${pathFoto}`;
        }
        if (pathGif && btnDlVideo) {
          btnDlVideo.href = `${SUPABASE_URL}/storage/v1/object/public/Photoboth/${pathGif}`;
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  function triggerShoot() {
    if (!shooting && !btnShoot.disabled && !isWaitingConfirmation) { handleShootAction(); }
  }

  btnShoot.addEventListener('click', (e) => { e.preventDefault(); triggerShoot(); });
  btnShoot.addEventListener('touchstart', (e) => { e.preventDefault(); triggerShoot(); }, { passive: false });

  document.body.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        if (isWaitingConfirmation) { handleNextAction(); } else { triggerShoot(); }
      }
    }
  });

  if(btnDownload) {
    btnDownload.addEventListener('click', () => {
      const finalImageURL = processActiveFilter();
      if (!finalImageURL) return;
      const a = document.createElement('a'); a.download = `photobooth-dkv-${Date.now()}.jpg`; a.href = finalImageURL; a.click();
    });
  }

  if(btnPrint) {
    btnPrint.addEventListener('click', () => {
      const imageToPrint = processActiveFilter();
      if (!imageToPrint) return;
      const doc = printIframe.contentWindow.document; doc.open();
      doc.write(`<html><head><style>@page{margin:0;}html,body{margin:0;padding:0;width:100%;display:flex;justify-content:center;} .box{width:420px;} img{width:100%;height:auto;display:block;}</style></head><body><div class="box"><img src="${imageToPrint}"></div><script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`);
      doc.close();
    });
  }

  // Eksekusi fungsi utama di paling bawah
  loadCameras();
  periksaModePengunjungHP();
  renderThumbs();
}
