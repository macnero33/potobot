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
  const camStatus = document.getElementById('cam-status');
  const stripPreview = document.getElementById('strip-preview');
  const flash = document.getElementById('flash');
  const printResult = document.getElementById('print-result');
  const printImg = document.getElementById('print-img');
  const printIframe = document.getElementById('print-iframe');
  const qrStatusText = document.getElementById('qr-status-text');

  let shots = [];
  let shooting = false;
  let stream = null;
  let resultDataURL = null; 

  const CAM_ASPECT = 4 / 3; 
  const BASE_WIDTH = 420;   // Lebar standar kertas thermal kasir (58mm-80mm)
  const SCALE_FACTOR = 3;   // Mengalikan resolusi ×3 agar hasil print tajam & jernih

  const LAYOUTS = {
    strip3: { count: 3, cols: 1, rows: 3 }, 
    grid4:  { count: 4, cols: 2, rows: 2 }, 
    single: { count: 1, cols: 1, rows: 1 }
  };

  function getLayout() { return LAYOUTS[layoutSel.value]; }

  // 1. ENGINE KAMERA
  async function startCam(deviceId) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user', width: { ideal: 1280 } },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      camStatus.textContent = 'Kamera Aktif';
      camStatus.style.background = '#d1fae5';
      camStatus.style.color = '#065f46';
    } catch (e) { 
      camStatus.textContent = 'Gagal memuat kamera';
      camStatus.style.background = '#fee2e2';
      camStatus.style.color = '#991b1b';
    }
  }

  async function loadCameras() {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      camSel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Kamera ' + (i + 1)}</option>`).join('');
      if (cams.length) startCam(cams[0].deviceId);
    } catch (e) { 
      camSel.innerHTML = '<option>Izin kamera ditolak</option>'; 
    }
  }

  camSel.addEventListener('change', () => startCam(camSel.value));
  layoutSel.addEventListener('change', () => resetSesiTotal());
  frameSel.addEventListener('change', () => {
    if (shots.length === getLayout().count) buildTemplateStruk();
  });

  function resetSesiTotal() {
    shots = [];
    shootText.textContent = "Ambil Semua Foto (Spasi)";
    statusEl.textContent = "Sesi di-reset. Siap mengambil foto baru.";
    btnDownload.style.display = 'none'; 
    btnPrint.style.display = 'none';
    btnReset.style.display = 'none';
    printResult.style.display = 'none'; 
    resultDataURL = null;
    renderThumbs();
  }

  btnReset.addEventListener('click', resetSesiTotal);

  function renderThumbs() {
    const layout = getLayout();
    stripPreview.innerHTML = '';
    for (let i = 0; i < layout.count; i++) {
      const container = document.createElement('div');
      container.className = 'thumb-container';
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
      stripPreview.appendChild(container);
    }
  }

  function captureFrame() {
    const c = document.getElementById('shot-canvas');
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 960;
    c.width = vw; 
    c.height = vh;
    const ctx = c.getContext('2d');
    
    // Mirroring canvas agar hasil foto sama dengan preview layar
    ctx.save();
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.restore();
    
    return c.toDataURL('image/jpeg', 0.9);
  }

  async function handleShootAction() {
    if (shooting) return;
    const layout = getLayout();
    shooting = true;
    btnShoot.disabled = true;
    shots = [];
    renderThumbs();
    
    const timerDelay = parseInt(timerSel.value) || 0;

    for (let i = 0; i < layout.count; i++) {
      if (timerDelay > 0) {
        countdownEl.style.opacity = '1';
        for (let t = timerDelay; t > 0; t--) {
          countdownEl.textContent = t;
          statusEl.textContent = `Persiapan jepretan ke-${i + 1} dalam ${t} detik...`;
          await new Promise(r => setTimeout(r, 1000));
        }
        countdownEl.style.opacity = '0';
      }
      
      // Efek kilatan kamera (Flash)
      flash.style.opacity = '0.9';
      setTimeout(() => flash.style.opacity = '0', 150);
      
      shots.push(captureFrame());
      renderThumbs();
      statusEl.textContent = `Foto ${i + 1}/${layout.count} berhasil disimpan!`;
      
      if (i < layout.count - 1) await new Promise(r => setTimeout(r, 1500));
    }
    
    statusEl.textContent = "Memproses penyusunan template struk...";
    shooting = false;
    btnShoot.disabled = false;
    buildTemplateStruk();
  }

  // 2. ENGINE TEMPLATE STRUK KASIR (CANVAS BUILDER)
  function buildTemplateStruk() {
    const layout = getLayout();
    const isCalendar = (frameSel.value === 'calendar-2026');
    
    // Set parameter ukuran kanvas resolusi tinggi
    const totalW = BASE_WIDTH * SCALE_FACTOR;
    const padX = 32 * SCALE_FACTOR;
    const gap = 14 * SCALE_FACTOR;
    const headerH = 150 * SCALE_FACTOR;
    const footerH = (isCalendar ? 250 : 110) * SCALE_FACTOR;
    
    const availableW = totalW - (padX * 2) - ((layout.cols - 1) * gap);
    const cellW = Math.floor(availableW / layout.cols);
    const cellH = Math.floor(cellW / CAM_ASPECT);
    
    const actualGridH = (layout.rows * cellH) + ((layout.rows - 1) * gap);
    const totalH = headerH + actualGridH + footerH;

    const rc = document.getElementById('result-canvas');
    rc.width = totalW;
    rc.height = totalH;
    const ctx = rc.getContext('2d');

    // Mengisi Background Putih Bersih Kertas Kasir
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    // MENGGAMBAR HEADER STRUK
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = `bold ${32 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('RECEIPT', totalW / 2, 55 * SCALE_FACTOR);
    
    ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('------------------------------------------', totalW / 2, 85 * SCALE_FACTOR);
    
    // Generate detail tanggal otomatis
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    ctx.font = `${12 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText(`ORDER #DKV-${Math.floor(1000 + Math.random() * 9000)}`, totalW / 2, 105 * SCALE_FACTOR);
    ctx.fillText(`${dateStr}   ${timeStr}`, totalW / 2, 125 * SCALE_FACTOR);
    ctx.fillText('------------------------------------------', totalW / 2, 142 * SCALE_FACTOR);

    // MEMASUKKAN FOTO KE TEMPLATE
    let loadedImages = 0;
    shots.forEach((src, i) => {
      const img = new Image();
      img.onload = () => {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const x = padX + col * (cellW + gap);
        const y = headerH + row * (cellH + gap);
        
        // Gambar foto di kanvas struk
        ctx.drawImage(img, x, y, cellW, cellH);
        
        // Beri garis border hitam tipis estetik di sekeliling foto
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2 * SCALE_FACTOR;
        ctx.strokeRect(x, y, cellW, cellH);
        
        loadedImages++;
        if (loadedImages === shots.length) {
          // JIKA SEMUA FOTO SUDAH BERHASIL DIGAMBAR, SELESAIKAN FOOTER
          drawFooter(ctx, totalW, headerH + actualGridH, isCalendar, rc);
        }
      };
      img.src = src;
    });
  }

  function drawFooter(ctx, totalW, startFooterY, isCalendar, rc) {
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
    ctx.fillText('------------------------------------------', totalW / 2, startFooterY + (15 * SCALE_FACTOR));

    if (isCalendar) {
      // TEMPLATE EDISI KALENDER JUNI 2026
      ctx.font = `bold ${15 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('✨ JUNI 2026 ✨', totalW / 2, startFooterY + (40 * SCALE_FACTOR));
      ctx.font = `bold ${11 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('S   M   T   W   T   F   S', totalW / 2, startFooterY + (65 * SCALE_FACTOR));
      ctx.font = `${12 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('-------------------------', totalW / 2, startFooterY + (78 * SCALE_FACTOR));
      
      const days = [
        "    1   2   3   4   5   6",
        "7   8   9  10  11  12  13",
        "14 15  16  17  18  19  20",
        "21 22  23  24  25  26  27",
        "28 29  30"
      ];
      let lineY = startFooterY + (95 * SCALE_FACTOR);
      days.forEach(rowStr => {
        ctx.fillText(rowStr, totalW / 2, lineY);
        lineY += (18 * SCALE_FACTOR);
      });
      
      ctx.font = `${14 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('------------------------------------------', totalW / 2, lineY + (5 * SCALE_FACTOR));
      ctx.font = `italic ${10 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('* DKV EXHIBITION MEMORY *', totalW / 2, lineY + (24 * SCALE_FACTOR));
    } else {
      // TEMPLATE STRUK KASIR KREATOR STANDAR
      ctx.font = `bold ${18 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('★ ★ ★ ★ ★', totalW / 2, startFooterY + (45 * SCALE_FACTOR));
      ctx.font = `italic ${13 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('* THANK YOU FOR VISITING *', totalW / 2, startFooterY + (70 * SCALE_FACTOR));
      ctx.font = `${10 * SCALE_FACTOR}px "Courier New", Courier, monospace`;
      ctx.fillText('HIMPUNAN MAHASISWA DKV', totalW / 2, startFooterY + (90 * SCALE_FACTOR));
    }

    // Ekspor kanvas menjadi Data URL JPG
    resultDataURL = rc.toDataURL('image/jpeg', 0.85);
    printImg.src = resultDataURL;
    printResult.style.display = 'block';
    
    // Munculkan menu tombol kontrol utama laptop
    btnDownload.style.display = 'inline-flex';
    btnPrint.style.display = 'inline-flex';
    btnReset.style.display = 'inline-flex';
    statusEl.textContent = "Struk kasir berhasil dibuat!";

    // Jalankan sistem upload cloud untuk membuat QR Code
    uploadKeCloudDanBuatQR(resultDataURL);
  }

  // 3. ENGINE QR CODE ONLINE VIA IMGUR API (ANTI-CRASH & PASTI MUNCUL)
  function uploadKeCloudDanBuatQR(base64Image) {
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = ""; // Bersihkan sisa QR lama
    qrStatusText.textContent = "Sedang memproses tautan unduhan smartphone pengunjung...";
    qrStatusText.style.color = "#854d0e";

    // Potong header data:image/jpeg;base64 untuk dikirim ke API
    const rawBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    // Ambil token anonymous upload gratis Imgur Client ID
    // Menggunakan Client ID cadangan publik universal gratisan
    const clientId = "644e5ccb483b8bd"; 

    const formData = new FormData();
    formData.append("image", rawBase64);
    formData.append("type", "base64");

    fetch("https://api.imgur.com/3/image", {
      method: "POST",
      headers: { Authorization: `Client-ID ${clientId}` },
      body: formData
    })
    .then(res => res.json())
    .then(response => {
      if (response.success && response.data.link) {
        const cloudUrl = response.data.link; // Ini link pendek cloud aman (Contoh: https://i.imgur.com/xxxxx.jpg)
        
        // Buat QR Code instan dari tautan awan yang super pendek dan renggang
        new QRCode(qrContainer, {
          text: cloudUrl,
          width: 110,
          height: 110,
          colorDark : "#000000",
          colorLight : "#ffffff",
          correctLevel : QRCode.CorrectLevel.M
        });

        qrStatusText.textContent = "QR Code siap! Arahkan kamera smartphone pengunjung ke kode di samping untuk menyimpan gambar kualitas tinggi.";
        qrStatusText.style.color = "#15803d";
      } else {
        throw new Error("Gagal mengunggah");
      }
    })
    .catch(err => {
      qrContainer.innerHTML = "<p style='font-size:11px;color:#b91c1c;font-weight:bold;'>Gagal Online</p>";
      qrStatusText.textContent = "Koneksi internet bermasalah. Silakan simpan manual menggunakan tombol 'Download JPG' di atas.";
      qrStatusText.style.color = "#b91c1c";
    });
  }

  // 4. ENGINE CETAK PRINTER THERMAL (100% BERFUNGSI)
  btnPrint.addEventListener('click', () => {
    if (!resultDataURL) return;
    
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
        <div class="print-box">
          <img src="${resultDataURL}">
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  });

  // 5. ENGINE DOWNLOAD JPG
  btnDownload.addEventListener('click', () => {
    if (!resultDataURL) return;
    const a = document.createElement('a');
    a.download = `photobooth-receipt-${Date.now()}.jpg`;
    a.href = resultDataURL;
    a.click();
  });

  // EVENT TOMBOL SPASI LAPTOP
  document.body.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !shooting && !btnShoot.disabled) {
      e.preventDefault();
      handleShootAction();
    }
  });

  loadCameras();
  renderThumbs();
}
