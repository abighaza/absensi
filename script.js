// --- Konfigurasi Supabase ---
const SUPABASE_URL = "https://hylyorucbruyauahshyl.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5bHlvcnVjYnJ1eWF1YWhzaHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNjQzNjQsImV4cCI6MjEwMTg0MDM2NH0.-LPnYPwstUDS2YD_8I_E1AIHtSXLJAHkpCujflJXDu8";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Array penampung data lokal
let dataSiswaList = [];
let dataGuruList = [];
let currentUser = null;

// --- 1. FUNGSI LOGIN ---
function handleLogin(e) {
  if (e) e.preventDefault();
  const role = document.getElementById("login-role").value;
  const user = document.getElementById("login-user").value;

  currentUser = { role, user };
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("app-wrapper").classList.remove("hidden");
  document.getElementById("user-role-badge").innerText = role.toUpperCase();
  document.getElementById("current-username").innerText = user;

  if (role === "siswa") {
    const namaCard = document.getElementById("siswa-card-nama");
    const nisnCard = document.getElementById("siswa-card-nisn");

    const prosesDataSiswa = () => {
      const siswaData = dataSiswaList.find(
        (s) => String(s.nisn).trim() === String(user).trim(),
      );

      if (siswaData) {
        if (namaCard) namaCard.innerText = siswaData.nama;
        if (nisnCard) nisnCard.innerText = "NISN: " + siswaData.nisn;
        document.getElementById("current-username").innerText = siswaData.nama;
      } else {
        if (namaCard) namaCard.innerText = "Siswa (" + user + ")";
        if (nisnCard) nisnCard.innerText = "NISN: " + user;
      }
    };

    if (dataSiswaList.length === 0) {
      if (namaCard) namaCard.innerText = "Memuat data...";
      supabase
        .from("siswa")
        .select("*")
        .then(({ data }) => {
          dataSiswaList = data || [];
          prosesDataSiswa();
        })
        .catch(() => prosesDataSiswa());
    } else {
      prosesDataSiswa();
    }
  }

  setupNavigation(role);
}

function logout() {
  location.reload();
}

// --- 2. NAVIGASI ---
function setupNavigation(role) {
  const navLinks = document.getElementById("nav-links");
  navLinks.innerHTML = "";

  let menus = [];
  if (role === "admin") {
    menus = [
      { id: "dir-dashboard", name: "Dashboard", icon: "fa-chart-pie" },
      { id: "dir-data-siswa", name: "Data Siswa", icon: "fa-users" },
      { id: "dir-guru", name: "Data Guru", icon: "fa-chalkboard-user" },
      { id: "dir-laporan", name: "Laporan", icon: "fa-file-lines" },
      { id: "dir-kelola-absen", name: "Kelola Absen", icon: "fa-gear" },
      { id: "dir-scan-absen", name: "Scan Absen", icon: "fa-qrcode" },
    ];
  } else if (role === "guru") {
    menus = [
      {
        id: "dir-guru-monitoring",
        name: "Monitoring & Rekap",
        icon: "fa-clipboard-user",
      },
      { id: "dir-scan-absen", name: "Scan Barcode", icon: "fa-qrcode" },
    ];
  } else if (role === "siswa") {
    menus = [{ id: "dir-siswa-panel", name: "Portal Siswa", icon: "fa-user" }];
  }

  menus.forEach((menu, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#" onclick="switchView('${menu.id}', this)"><i class="fa-solid ${menu.icon}"></i> ${menu.name}</a>`;
    if (index === 0) li.classList.add("active");
    navLinks.appendChild(li);
  });

  if (menus.length > 0) switchView(menus[0].id);
}

function switchView(viewId, element) {
  document
    .querySelectorAll(".view-section")
    .forEach((sec) => sec.classList.add("hidden"));
  const target = document.getElementById(viewId);
  if (target) target.classList.remove("hidden");

  if (element) {
    document
      .querySelectorAll(".nav-menu li")
      .forEach((li) => li.classList.remove("active"));
    element.parentElement.classList.add("active");
  }
}

// --- 3. JAM & TANGGAL REALTIME ---
setInterval(() => {
  const now = new Date();
  const clockEl = document.getElementById("live-clock");
  const dateEl = document.getElementById("live-date");
  if (clockEl) clockEl.innerText = now.toLocaleTimeString();
  if (dateEl)
    dateEl.innerText = now.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
}, 1000);

// --- 4. INISIALISASI HALAMAN & GRAFIK ---
window.addEventListener("DOMContentLoaded", () => {
  const ctx = document.getElementById("attendanceChart");
  if (ctx) {
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Hadir", "Sakit", "Izin", "Alpa"],
        datasets: [
          {
            label: "# Statistik Kehadiran Minggu Ini",
            data: [120, 5, 2, 3],
            backgroundColor: ["#2ecc71", "#f1c40f", "#3498db", "#e74c3c"],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
      },
    });
  }

  // Muat data dari Supabase
  loadDataSiswaDariServer();
});

// --- 5. AMBIL & SIMPAN DATA DARI SUPABASE ---
async function loadDataSiswaDariServer() {
  const { data, error } = await supabase.from("siswa").select("*");

  if (error) {
    console.error("Gagal load siswa:", error);
  } else {
    dataSiswaList = data || [];
    renderTabelSiswa();
    const statTotal = document.getElementById("stat-total");
    if (statTotal) statTotal.innerText = dataSiswaList.length;
  }
}

async function submitDataSiswa(e) {
  e.preventDefault();
  const nama = document.getElementById("input-nama-siswa").value;
  const nisn = document.getElementById("input-nisn-siswa").value;
  const kelas = document.getElementById("input-kelas-siswa").value;

  const { error } = await supabase
    .from("siswa")
    .insert([{ nama, nisn, kelas }]);

  if (error) {
    console.error("Gagal menyimpan data siswa:", error);
    alert("Terjadi kesalahan saat menyimpan ke database.");
  } else {
    alert("Data Siswa Berhasil Disimpan!");
    document.getElementById("form-tambah-siswa").reset();
    closeModalTambahSiswa();
    loadDataSiswaDariServer(); // Refresh tabel otomatis
  }
}

// --- RENDER TABEL ---
function renderTabelSiswa() {
  const tbody = document.getElementById("table-siswa-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!dataSiswaList || dataSiswaList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #6b7280; padding: 15px;">Belum ada data siswa.</td></tr>`;
    return;
  }

  dataSiswaList.forEach((siswa, index) => {
    tbody.innerHTML += `
      <tr>
        <td>${index + 1}</td>
        <td>${siswa.nama}</td>
        <td>${siswa.nisn}</td>
        <td>${siswa.kelas}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="hapusSiswa(${siswa.id})">
            <i class="fa-solid fa-trash"></i> Hapus
          </button>
        </td>
      </tr>
    `;
  });
}

function refreshDataSiswa() {
  loadDataSiswaDariServer();
  alert("Data siswa berhasil dimuat ulang dari database!");
}

function refreshDashboard() {
  loadDataSiswaDariServer();
  alert("Data dashboard berhasil diperbarui!");
}

// --- FUNGSI HAPUS DARI SUPABASE ---
async function hapusSiswa(id) {
  if (!confirm("Yakin ingin menghapus data siswa ini?")) return;

  const { error } = await supabase.from("siswa").delete().eq("id", id);
  if (error) {
    console.error("Gagal menghapus siswa:", error);
    alert("Gagal menghapus data.");
  } else {
    loadDataSiswaDariServer();
  }
}

// --- 6. FUNGSI SCANNER & ABSEN ---
let html5QrCode = null;

function initScanner() {
  const scanSection = document.getElementById("dir-scan-absen");
  if (scanSection && !scanSection.classList.contains("hidden")) {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
    html5QrCode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          alert("Berhasil Scan: " + decodedText);
          kirimDataAbsenOtomatis(decodedText);
        },
      )
      .catch((err) => console.error("Kamera gagal:", err));
  } else if (html5QrCode) {
    html5QrCode.stop().catch((err) => console.log(err));
  }
}

async function kirimDataAbsenOtomatis(nisn) {
  const cleanNisn = String(nisn).trim();
  const siswa = dataSiswaList.find((s) => String(s.nisn).trim() === cleanNisn);

  const namaSiswa = siswa ? siswa.nama : "Siswa (" + cleanNisn + ")";
  const kelasSiswa = siswa ? siswa.kelas : "-";

  const { error } = await supabase.from("absen").insert([
    {
      nama: namaSiswa,
      nisn: cleanNisn,
      kelas: kelasSiswa,
      keterangan: "Hadir",
    },
  ]);

  if (error) {
    console.error("Gagal mengirim data absen:", error);
  } else {
    const resEl = document.getElementById("scan-result");
    if (resEl) {
      resEl.innerHTML = `
        <div class="alert alert-success p-2" style="background: #d4edda; color: #155724; border-radius: 5px;">
            <i class="fa-solid fa-check-circle"></i> Berhasil Absen!<br>
            <strong>${namaSiswa}</strong> (NISN: ${cleanNisn})<br>
            Kelas: ${kelasSiswa}
        </div>
      `;
    }
  }
}

function switchCamera(mode) {
  if (html5QrCode) html5QrCode.stop().then(() => initScanner());
}

// --- 7. FUNGSI MODAL & HELPERS ---
function openModalTambahSiswa() {
  document.getElementById("modal-tambah-siswa").classList.remove("hidden");
}
function closeModalTambahSiswa() {
  document.getElementById("modal-tambah-siswa").classList.add("hidden");
}
function backToDashboard() {
  switchView("dir-dashboard");
}

// Observer untuk Scanner
const observer = new MutationObserver(() => initScanner());
const scanSection = document.getElementById("dir-scan-absen");
if (scanSection)
  observer.observe(scanSection, {
    attributes: true,
    attributeFilter: ["class"],
  });
