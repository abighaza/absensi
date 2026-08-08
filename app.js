// ==========================================================================
// 0. KONFIGURASI KONEKSI GOOGLE APPS SCRIPT
// ==========================================================================
// Ganti URL di bawah ini dengan URL Web App dari Google Apps Script Anda (deploy -> Web App -> URL Exec)
const API_URL =
  "https://script.google.com/macros/s/AKfycbwySDI0P7Vl52seFtpI8MYZxlQL9CyUhWX5QE1N1nfuYwcHq_hmZSqmt4zLcucI6KlM8g/exec";

fetch(API_URL + "?sheet=Siswa")
  .then((res) => res.json())
  .then((data) => {
    console.log("Data Siswa:", data);
  });

// Wrapper pengganti google.script.run untuk GitHub Pages (Fetch API)
const google = {
  script: {
    run: {
      withSuccessHandler: function (successCallback) {
        this.success = successCallback;
        return this;
      },
      withFailureHandler: function (failureCallback) {
        this.failure = failureCallback;
        return this;
      },
      // Proxy dinamis untuk memanggil fungsi GAS via Fetch POST
      _call: function (functionName, args) {
        fetch(API_URL, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ function: functionName, arguments: args }),
        })
          .then((response) => response.json())
          .then((result) => {
            if (this.success) this.success(result);
          })
          .catch((error) => {
            if (this.failure) this.failure(error);
            else console.error("API Error:", error);
          });
      },
    },
  },
};

// Auto-generate proxy method dynamically
const gasFunctions = [
  "login",
  "getKelasList",
  "getMonitoringRealtime",
  "getAbsensiToday",
  "getAppConfig",
  "saveAppConfig",
  "getHariLibur",
  "updateHariLibur",
  "addHariLibur",
  "deleteHariLibur",
  "getSiswaList",
  "getGuruList",
  "updateSiswa",
  "addSiswa",
  "getAbsensiList",
  "generateExcel",
  "updateAbsensiStatus",
  "updateGuru",
  "addGuru",
  "deleteSiswa",
  "deleteGuru",
  "scanAbsensi",
];

gasFunctions.forEach((fnName) => {
  google.script.run[fnName] = function (...args) {
    google.script.run._call(fnName, args);
  };
});

// ==========================================================================
// 1. GLOBAL STATE & KONFIGURASI
// ==========================================================================
let currentUser = null;
let html5QrCode = null;
let isScanning = false;
let isSidebarOpen = true;

// --- SMART CACHE ---
let appCache = {
  siswa: null,
  guru: null,
};

// --- CHART & UTILS ---
let dashboardChart = null;
let existingClasses = []; // Untuk autocomplete kelas
let guruChartInstance = null;
let adminChartInstance = null;

// Set Tanggal Hari Ini
const dateElement = document.getElementById("currentDateDisplay");
if (dateElement) {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  dateElement.textContent = new Date().toLocaleDateString("id-ID", options);
}

const tableState = {
  siswa: {
    fullData: [],
    filtered: [],
    limit: 10,
    page: 1,
    search: "",
    classFilter: "",
  },
  guru: {
    fullData: [],
    filtered: [],
    limit: 10,
    page: 1,
    search: "",
    classFilter: "",
  },
  libur: { fullData: [], filtered: [], limit: 10, page: 1, search: "" },
  rekap: { fullData: [], filtered: [], limit: 10, page: 1, search: "" },
  monitoring: {
    fullData: [],
    filtered: [],
    limit: 10,
    page: 1,
    search: "",
    statusFilter: "",
  },
};

function handleTableSearch(type, query) {
  tableState[type].search = query.toLowerCase();
  tableState[type].page = 1;
  processTableData(type);
}

function handleTableClassFilter(type, value) {
  if (tableState[type]) {
    tableState[type].classFilter = value;
    tableState[type].page = 1;
    processTableData(type);
  }
}

function handleTableStatusFilter(type, status) {
  if (tableState[type]) {
    tableState[type].statusFilter = status;
    tableState[type].page = 1;
    processTableData(type);
  }
}

function handleTableLimit(type, limit) {
  tableState[type].limit = limit === "all" ? Infinity : parseInt(limit);
  tableState[type].page = 1;
  processTableData(type);
}

function changePage(type, direction) {
  const state = tableState[type];
  const maxPage = Math.ceil(state.filtered.length / state.limit);
  const newPage = state.page + direction;

  if (newPage >= 1 && newPage <= maxPage) {
    state.page = newPage;
    processTableData(type);
  }
}

function processTableData(type) {
  const state = tableState[type];
  let result = [...state.fullData];

  if ((type === "siswa" || type === "guru") && state.classFilter) {
    result = result.filter((item) => item.kelas === state.classFilter);
  }

  if (type === "monitoring" && state.statusFilter) {
    result = result.filter((item) => item.status === state.statusFilter);
  }

  if (state.search) {
    const query = state.search.toLowerCase();
    result = result.filter((item) =>
      Object.values(item).some((val) =>
        String(val).toLowerCase().includes(query),
      ),
    );
  }

  state.filtered = result;

  const total = state.filtered.length;
  const totalPages = Math.ceil(total / state.limit);

  if (state.page > totalPages && totalPages > 0) state.page = totalPages;
  if (total === 0) state.page = 1;

  const startIdx = (state.page - 1) * state.limit;
  const endIdx = startIdx + state.limit;
  const pagedData = state.filtered.slice(startIdx, endIdx);

  if (type === "siswa") renderSiswaRows(pagedData, startIdx);
  else if (type === "guru") renderGuruRows(pagedData, startIdx);
  else if (type === "libur") renderLiburRows(pagedData, startIdx);
  else if (type === "rekap") renderRekapRows(pagedData);
  else if (type === "monitoring") renderMonitoringRows(pagedData, startIdx);

  updatePaginationUI(
    type,
    startIdx,
    pagedData.length,
    total,
    state.page,
    totalPages,
  );
}

function updatePaginationUI(
  type,
  startIdx,
  currentCount,
  total,
  currentPage,
  totalPages,
) {
  const infoEl = document.getElementById(`info-${type}`);
  const btnPrev = document.getElementById(`btn-prev-${type}`);
  const btnNext = document.getElementById(`btn-next-${type}`);

  if (total === 0) {
    infoEl.textContent = "Tidak ada data ditemukan.";
    btnPrev.disabled = true;
    btnNext.disabled = true;
  } else {
    const end = startIdx + currentCount;
    infoEl.textContent = `Menampilkan ${startIdx + 1} - ${end} dari ${total} data`;
    btnPrev.disabled = currentPage === 1;
    btnNext.disabled = currentPage >= totalPages;
  }
}

// ==========================================================================
// 2. SESSION MANAGEMENT
// ==========================================================================
function checkSession() {
  const storedSession = localStorage.getItem("absensiAppSession");
  if (storedSession) {
    try {
      const sessionData = JSON.parse(storedSession);
      if (sessionData && sessionData.success) {
        currentUser = sessionData;
        document.getElementById("loginPage").classList.add("hidden");
        document
          .getElementById("dashboardContainer")
          .classList.remove("hidden");

        if (window.innerWidth < 768) {
          document.getElementById("sidebar").classList.add("-translate-x-full");
        }

        initDashboard();
      }
    } catch (e) {
      localStorage.removeItem("absensiAppSession");
    }
  }
}

// ==========================================================================
// 3. UI NAVIGATION & SIDEBAR
// ==========================================================================
function showView(viewId) {
  document.querySelectorAll(".view-section").forEach((el) => {
    el.classList.remove("active");
    el.style.display = "none";
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add("active");
    target.style.display = "block";
    target.classList.add("animate-fade-in");
  }

  let title = "Dashboard";
  switch (viewId) {
    case "view-data-siswa":
      title = "Direktori Siswa";
      break;
    case "view-data-guru":
      title = "Manajemen Guru";
      break;
    case "view-kelola-absen":
      title = "Kelola Hari Libur";
      break;
    case "view-scanner":
      title = "Scan Absensi";
      break;
    case "view-monitoring":
      title = "Monitoring Realtime";
      break;
    case "view-rekap-absensi":
      title = "Laporan Kehadiran";
      break;
    case "view-kartu-siswa":
      title = "Kartu Pelajar Digital";
      break;
  }
  document.getElementById("pageTitle").textContent = title;
  closeSidebarMobile();
}

function setActiveMenu(targetName) {
  const allLinks = document.querySelectorAll("#sidebarMenu a");
  const centerClass = !isSidebarOpen ? "justify-center px-0" : "space-x-3 px-4";
  const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
  const activeStyle = "bg-indigo-600 text-white shadow-lg shadow-indigo-900/50";
  const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";

  allLinks.forEach((link) => {
    const menuName = link.getAttribute("data-name");
    if (menuName === targetName) {
      link.className = baseStyle + activeStyle;
    } else {
      link.className = baseStyle + inactiveStyle;
    }
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const main = document.getElementById("mainContent");
  const overlay = document.getElementById("mobileOverlay");
  const labels = document.querySelectorAll(".sidebar-label");
  const header = document.getElementById("sidebarHeader");
  const userCard = document.getElementById("userProfileCard");
  const logoutBtn = document.getElementById("btnLogout");
  const menuLinks = document.querySelectorAll("#sidebarMenu a");

  const isMobile = window.innerWidth < 768;

  if (isMobile) {
    if (sidebar.classList.contains("-translate-x-full")) {
      sidebar.classList.remove("-translate-x-full");
      overlay.classList.remove("hidden");
      setTimeout(() => overlay.classList.remove("opacity-0"), 10);
    } else {
      sidebar.classList.add("-translate-x-full");
      overlay.classList.add("opacity-0");
      setTimeout(() => overlay.classList.add("hidden"), 300);
    }
  } else {
    if (isSidebarOpen) {
      sidebar.classList.remove("w-64");
      sidebar.classList.add("w-20");
      main.classList.remove("md:ml-64");
      main.classList.add("md:ml-20");

      header.classList.remove("px-6", "justify-start");
      header.classList.add("px-0", "justify-center");
      userCard.classList.remove("space-x-3", "p-3", "bg-black/20", "border");
      userCard.classList.add(
        "justify-center",
        "p-0",
        "bg-transparent",
        "border-transparent",
      );
      logoutBtn.classList.remove("space-x-3", "justify-start", "px-4");
      logoutBtn.classList.add("justify-center", "px-0");
      menuLinks.forEach((link) => {
        link.classList.remove("space-x-3", "px-4");
        link.classList.add("justify-center", "px-0");
      });
      labels.forEach((el) => {
        el.classList.add("hidden");
      });

      isSidebarOpen = false;
    } else {
      sidebar.classList.remove("w-20");
      sidebar.classList.add("w-64");
      main.classList.remove("md:ml-20");
      main.classList.add("md:ml-64");

      header.classList.add("px-6", "justify-start");
      header.classList.remove("px-0", "justify-center");
      userCard.classList.add("space-x-3", "p-3", "bg-black/20", "border");
      userCard.classList.remove(
        "justify-center",
        "p-0",
        "bg-transparent",
        "border-transparent",
      );
      logoutBtn.classList.add("space-x-3", "justify-start", "px-4");
      logoutBtn.classList.remove("justify-center", "px-0");
      menuLinks.forEach((link) => {
        link.classList.add("space-x-3", "px-4");
        link.classList.remove("justify-center", "px-0");
      });
      labels.forEach((el) => {
        el.classList.remove("hidden");
      });

      isSidebarOpen = true;
    }
  }
}

function closeSidebarMobile() {
  if (window.innerWidth < 768) {
    document.getElementById("sidebar").classList.add("-translate-x-full");
    const overlay = document.getElementById("mobileOverlay");
    overlay.classList.add("opacity-0");
    setTimeout(() => overlay.classList.add("hidden"), 300);
  }
}

// ==========================================================================
// 4. AUTENTIKASI
// ==========================================================================
function switchLoginTab(tab) {
  document.getElementById("loginError").classList.add("hidden");
  const btnSiswa = document.getElementById("btnSiswaTab");
  const btnAdmin = document.getElementById("btnAdminTab");

  const activeClass = "bg-white text-indigo-600 shadow-sm";
  const inactiveClass = "text-gray-500 hover:text-gray-700 hover:bg-gray-200";

  btnSiswa.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === "siswa" ? activeClass : inactiveClass}`;
  btnAdmin.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === "admin" ? activeClass : inactiveClass}`;

  if (tab === "admin") {
    document.getElementById("formAdminLogin").classList.remove("hidden");
    document.getElementById("formSiswaLogin").classList.add("hidden");
  } else {
    document.getElementById("formAdminLogin").classList.add("hidden");
    document.getElementById("formSiswaLogin").classList.remove("hidden");
  }
}

function handleLogin(event) {
  event.preventDefault();
  showLoading();

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const nisn = document.getElementById("nisn").value;

  google.script.run
    .withSuccessHandler(onLoginSuccess)
    .withFailureHandler(onLoginFailure)
    .login(username, password, nisn);
}

function onLoginSuccess(result) {
  hideLoading();

  if (result.success) {
    currentUser = result;
    localStorage.setItem("absensiAppSession", JSON.stringify(result));

    document.getElementById("loginPage").classList.add("hidden");
    document.getElementById("dashboardContainer").classList.remove("hidden");

    initDashboard();
  } else {
    const errorDiv = document.getElementById("loginError");
    document.getElementById("errorText").textContent = result.message;
    errorDiv.classList.remove("hidden");
    setTimeout(() => errorDiv.classList.add("hidden"), 5000);
  }
}

function onLoginFailure(error) {
  hideLoading();
  alert("Gagal terhubung ke server: " + error.message);
}

function logout() {
  stopAndBack(false);
  localStorage.removeItem("absensiAppSession");
  currentUser = null;
  appCache = { siswa: null, guru: null };
  document.getElementById("dashboardContainer").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");

  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  document.getElementById("nisn").value = "";
  document.getElementById("sidebar").classList.add("-translate-x-full");
}

// ==========================================================================
// 5. DASHBOARD & MENU
// ==========================================================================
function initDashboard() {
  const name = currentUser.nama || currentUser.username;
  document.getElementById("navUserName").textContent = name;
  document.getElementById("navUserRole").textContent =
    currentUser.role.toUpperCase();
  document.getElementById("navUserInitial").textContent = name
    .charAt(0)
    .toUpperCase();

  const menuContainer = document.getElementById("sidebarMenu");
  let menuHTML = "";

  const createItem = (label, icon, onclick, isDefaultActive = false) => {
    const hideText = !isSidebarOpen ? "hidden" : "";
    const centerClass = !isSidebarOpen
      ? "justify-center px-0"
      : "space-x-3 px-4";
    const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
    const activeStyle =
      "bg-indigo-600 text-white shadow-lg shadow-indigo-900/50";
    const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";
    const currentStyle = isDefaultActive
      ? baseStyle + activeStyle
      : baseStyle + inactiveStyle;

    return `
        <a data-name="${label}" onclick="${onclick}" class="${currentStyle}">
            <i class="fas ${icon} w-6 text-center flex-shrink-0 group-hover:scale-110 transition-transform"></i>
            <span class="sidebar-label font-medium transition-opacity duration-300 ${hideText}">${label}</span>
        </a>`;
  };

  if (currentUser.role === "admin") {
    menuHTML += createItem(
      "Dashboard",
      "fa-home",
      "loadAdminDashboard()",
      true,
    );
    menuHTML += createItem("Data Siswa", "fa-user-graduate", "loadDataSiswa()");
    menuHTML += createItem(
      "Data Guru",
      "fa-chalkboard-teacher",
      "loadDataGuru()",
    );
    menuHTML += createItem(
      "Laporan",
      "fa-clipboard-list",
      "loadRekapAbsensi()",
    );
    menuHTML += createItem(
      "Kelola Absen",
      "fa-calendar-times",
      "loadKelolaAbsen()",
    );
    menuHTML += createItem("Scan Absensi", "fa-qrcode", "loadScanAbsensi()");
    loadAdminDashboard();
  } else if (currentUser.role === "guru") {
    menuHTML += createItem("Dashboard", "fa-home", "loadGuruDashboard()", true);
    menuHTML += createItem("Monitoring", "fa-eye", "loadMonitoringAbsensi()");
    menuHTML += createItem("Scan Absensi", "fa-qrcode", "loadScanAbsensi()");
    loadGuruDashboard();
  } else if (currentUser.role === "siswa") {
    menuHTML += createItem(
      "Dashboard",
      "fa-home",
      "loadSiswaDashboard()",
      true,
    );
    menuHTML += createItem("Kartu Saya", "fa-id-card", "loadQRCodeSiswa()");
    loadSiswaDashboard();
  }

  menuContainer.innerHTML = menuHTML;
  loadKelasSuggestions();
}

function loadKelasSuggestions() {
  google.script.run
    .withSuccessHandler((result) => {
      if (result.success) {
        existingClasses = result.data;
      }
    })
    .getKelasList();
}

function openKelasDropdown() {
  const dropdown = document.getElementById("dropdownKelasList");
  if (!dropdown) return;
  renderKelasDropdown(existingClasses);
  dropdown.classList.remove("hidden");
}

function filterKelasDropdown(keyword) {
  const filtered = existingClasses.filter((c) =>
    c.toLowerCase().includes(keyword.toLowerCase()),
  );
  renderKelasDropdown(filtered);
}

function renderKelasDropdown(items) {
  const dropdown = document.getElementById("dropdownKelasList");
  if (!items || items.length === 0) {
    dropdown.innerHTML =
      '<div class="px-4 py-3 text-xs text-gray-400 italic">Kelas tidak ditemukan. Ketik untuk membuat baru.</div>';
    return;
  }
  dropdown.innerHTML = items
    .map(
      (kelas) => `
        <div onclick="selectKelas('${kelas}')" class="px-4 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-gray-700 transition-colors border-b border-gray-50 last:border-none">
            ${kelas}
        </div>
    `,
    )
    .join("");
}

function selectKelas(value) {
  const input = document.getElementById("inputKelas");
  if (input) {
    input.value = value;
    closeKelasDropdown();
  }
}

function closeKelasDropdown() {
  const dropdown = document.getElementById("dropdownKelasList");
  if (dropdown) {
    setTimeout(() => dropdown.classList.add("hidden"), 200);
  }
}

// ==========================================================================
// 6. FUNGSI REFRESH DATA
// ==========================================================================
function refreshData(type) {
  const btnIcon = event ? event.currentTarget.querySelector("i") : null;
  if (btnIcon) btnIcon.classList.add("fa-spin");

  if (type === "siswa") {
    tableState.siswa.fullData = [];
    loadDataSiswa();
    showAlert("success", "Data siswa diperbarui.");
  } else if (type === "guru") {
    tableState.guru.fullData = [];
    loadDataGuru();
    showAlert("success", "Data guru diperbarui.");
  } else if (type === "dashboard") {
    if (currentUser.role === "admin") loadAdminDashboard();
    else if (currentUser.role === "guru") loadGuruDashboard();
    else loadSiswaDashboard();
    showAlert("success", "Statistik Dashboard diperbarui.");
  } else if (type === "monitoring") {
    tableState.monitoring.fullData = [];
    loadMonitoringAbsensi();
    showAlert("success", "Data monitoring diperbarui.");
  }

  if (btnIcon) setTimeout(() => btnIcon.classList.remove("fa-spin"), 1000);
}

// ==========================================================================
// 7. HALAMAN & LOGIKA DATA
// ==========================================================================
function loadAdminDashboard() {
  stopAndBack(false);
  setActiveMenu("Dashboard");
  showView("view-admin-dashboard");

  document.getElementById("adminDateDisplay").textContent =
    new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  google.script.run
    .withSuccessHandler((result) => {
      if (result.success) {
        const data = result.data;
        const total = data.length;
        const hadir = data.filter((d) => d.status === "Hadir").length;
        const sakit = data.filter((d) => d.status === "Sakit").length;
        const izin = data.filter((d) => d.status === "Izin").length;
        const alpa = data.filter((d) => d.status === "Alpa").length;
        const belum = data.filter((d) => d.status === "Belum Absen").length;

        animateValue("admStatTotal", 0, total, 800);
        animateValue("admStatHadir", 0, hadir, 800);
        animateValue("admStatSakit", 0, sakit, 800);
        animateValue("admStatIzin", 0, izin, 800);
        animateValue("admStatAlpa", 0, alpa, 800);

        renderAdminChart(hadir, sakit, izin, alpa, belum);
      }
    })
    .getMonitoringRealtime();
}

function renderAdminChart(hadir, sakit, izin, alpa, belum) {
  const ctx = document.getElementById("adminAttendanceChart");
  if (!ctx) return;

  if (adminChartInstance) adminChartInstance.destroy();
  if (typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
  }

  adminChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Hadir", "Sakit", "Izin", "Alpa", "Belum Absen"],
      datasets: [
        {
          label: "Jumlah Siswa",
          data: [hadir, sakit, izin, alpa, belum],
          backgroundColor: [
            "#10B981",
            "#EAB308",
            "#3B82F6",
            "#EF4444",
            "#9CA3AF",
          ],
          borderRadius: 8,
          barPercentage: 0.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "top",
          formatter: (val) => (val > 0 ? val : ""),
          font: { weight: "bold" },
          color: "#666",
        },
      },
      scales: {
        y: { beginAtZero: true, grid: { borderDash: [2, 2] } },
        x: { grid: { display: false } },
      },
    },
  });
}

function loadGuruDashboard() {
  stopAndBack(false);
  setActiveMenu("Dashboard");
  showView("view-guru-dashboard");

  document.getElementById("guruDashboardDate").textContent =
    new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const myClass = currentUser.role === "guru" ? currentUser.kelas : null;

  google.script.run
    .withSuccessHandler((result) => {
      if (result.success) {
        const data = result.data;
        if (myClass) {
          document.querySelector("#view-guru-dashboard h2").textContent =
            `Dashboard Guru (${myClass})`;
        }

        const totalSiswa = data.length;
        const sakit = data.filter((d) => d.status === "Sakit").length;
        const izin = data.filter((d) => d.status === "Izin").length;
        const alpa = data.filter((d) => d.status === "Alpa").length;
        const hadir = data.filter((d) => d.status === "Hadir").length;
        const belumAbsen = data.filter(
          (d) => d.status === "Belum Absen",
        ).length;

        animateValue("statGuruTotal", 0, totalSiswa, 1000);
        animateValue("statGuruSakit", 0, sakit, 1000);
        animateValue("statGuruIzin", 0, izin, 1000);
        animateValue("statGuruAlpa", 0, alpa, 1000);
        renderGuruChart(hadir, sakit, izin, alpa, belumAbsen);
      }
    })
    .getMonitoringRealtime(myClass);
}

function renderGuruChart(hadir, sakit, izin, alpa, belumAbsen) {
  const ctx = document.getElementById("guruAttendanceChart");
  if (!ctx) return;

  if (guruChartInstance) guruChartInstance.destroy();
  if (typeof ChartDataLabels !== "undefined") {
    Chart.register(ChartDataLabels);
  }

  guruChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Hadir", "Sakit", "Izin", "Alpa", "Belum Absen"],
      datasets: [
        {
          label: "Jumlah Siswa",
          data: [hadir, sakit, izin, alpa, belumAbsen],
          backgroundColor: [
            "#10B981",
            "#F59E0B",
            "#3B82F6",
            "#EF4444",
            "#9CA3AF",
          ],
          borderRadius: 6,
          barPercentage: 0.6,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: "end",
          align: "top",
          formatter: (value) => (value > 0 ? value : ""),
          font: { weight: "bold", size: 11 },
          color: "#4B5563",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { borderDash: [2, 4], color: "#F3F4F6" },
          ticks: { stepSize: 1 },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start);
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function loadSiswaDashboard() {
  stopAndBack(false);
  setActiveMenu("Dashboard");
  showView("view-siswa-dashboard");
  showLoading();

  try {
    const safeSetText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    if (currentUser) {
      const firstName = currentUser.nama
        ? currentUser.nama.split(" ")[0]
        : "Siswa";
      safeSetText("dashGreeting", firstName);
      safeSetText("profileNameSidebar", currentUser.nama);
      safeSetText("profileNisnSidebar", currentUser.nisn);
      safeSetText("profileKelasSidebar", currentUser.kelas);
    }
    const today = new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    safeSetText("dashDate", today);
  } catch (e) {}

  google.script.run
    .withSuccessHandler((result) => {
      hideLoading();
      try {
        const absensi = result && result.success ? result.data : null;
        const isLibur = result.isLibur;
        const infoLibur = result.keteranganLibur;

        const elHero = document.getElementById("heroCard");
        const elBadge = document.getElementById("dashStatusBadge");
        const elValMasuk = document.getElementById("valMasuk");
        const elValPulang = document.getElementById("valPulang");
        const elAlert = document.getElementById("alertBelumAbsen");

        if (isLibur) {
          if (elHero)
            elHero.className =
              "relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-600 to-red-800 p-6 text-white shadow-xl shadow-rose-200 transition-all duration-500 group";
          if (elBadge) {
            elBadge.className =
              "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
            elBadge.innerHTML = `<i class="fas fa-calendar-times mr-2"></i> HARI LIBUR`;
          }
          if (elValMasuk) {
            elValMasuk.parentElement.innerHTML = `
                        <div class="text-center py-2">
                            <i class="fas fa-mug-hot text-3xl mb-2 opacity-80"></i>
                            <p class="text-sm font-bold uppercase tracking-widest">${infoLibur}</p>
                            <p class="text-[10px] mt-1 opacity-75">Tidak ada absensi hari ini</p>
                        </div>
                    `;
            if (elValPulang) elValPulang.parentElement.style.display = "none";
            if (elValMasuk)
              elValMasuk.parentElement.classList.add("col-span-2");
          }
          if (elAlert) {
            elAlert.classList.add("hidden");
            elAlert.classList.remove("flex");
          }
          return;
        }

        if (!absensi) {
          if (elHero)
            elHero.className =
              "relative overflow-hidden rounded-3xl bg-slate-800 p-6 text-white shadow-xl shadow-slate-200 transition-all duration-500 group";
          if (elBadge) {
            elBadge.className =
              "px-4 py-2 rounded-xl bg-rose-500/20 backdrop-blur-md border border-rose-500/30 text-rose-200 text-xs font-bold shadow-sm animate-pulse";
            elBadge.innerHTML = `<i class="fas fa-circle text-[8px] mr-2"></i> BELUM ABSEN`;
          }
          if (elValMasuk) elValMasuk.textContent = "--:--";
          if (elValPulang) elValPulang.textContent = "--:--";
          if (elAlert) {
            elAlert.classList.remove("hidden");
            elAlert.classList.add("flex");
          }
        } else {
          if (elAlert) {
            elAlert.classList.add("hidden");
            elAlert.classList.remove("flex");
          }
          if (elValMasuk) elValMasuk.textContent = absensi.jamDatang || "--:--";

          if (!absensi.jamPulang) {
            if (elHero)
              elHero.className =
                "relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-800 p-6 text-white shadow-xl shadow-emerald-200 transition-all duration-500 group";
            if (elBadge) {
              elBadge.className =
                "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
              elBadge.innerHTML = `<i class="fas fa-clock animate-pulse mr-2"></i> SEDANG BERLANGSUNG`;
            }
            if (elValPulang) elValPulang.textContent = "--:--";
          } else {
            if (elHero)
              elHero.className =
                "relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-800 p-6 text-white shadow-xl shadow-indigo-200 transition-all duration-500 group";
            if (elBadge) {
              elBadge.className =
                "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
              elBadge.innerHTML = `<i class="fas fa-check-circle mr-2"></i> SELESAI HARI INI`;
            }
            if (elValPulang) elValPulang.textContent = absensi.jamPulang;
          }
        }
      } catch (err) {
        console.error("Error rendering dashboard:", err);
      }
    })
    .withFailureHandler((error) => {
      hideLoading();
    })
    .getAbsensiToday(currentUser.nisn);
}

function loadKelolaAbsen() {
  stopAndBack(false);
  setActiveMenu("Kelola Absen");
  showView("view-kelola-absen");

  document.getElementById("tbody-libur").innerHTML =
    '<tr><td colspan="4" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';

  google.script.run
    .withSuccessHandler((result) => {
      if (result.success) {
        tableState.libur.fullData = result.data;
        processTableData("libur");
      } else {
        document.getElementById("tbody-libur").innerHTML =
          '<tr><td colspan="4" class="p-4 text-center text-red-500">Gagal memuat data.</td></tr>';
      }
    })
    .getHariLibur();

  loadGlobalConfig();
}

function loadGlobalConfig() {
  const inputs = document.querySelectorAll(
    '#view-kelola-absen input[type="time"]',
  );
  inputs.forEach((el) => (el.disabled = true));

  google.script.run
    .withSuccessHandler((res) => {
      inputs.forEach((el) => (el.disabled = false));
      if (res.success) {
        const conf = res.data;
        document.getElementById("conf_masuk_mulai").value =
          conf.jam_masuk_mulai;
        document.getElementById("conf_masuk_akhir").value =
          conf.jam_masuk_akhir;
        document.getElementById("conf_pulang_mulai").value =
          conf.jam_pulang_mulai;
        document.getElementById("conf_pulang_akhir").value =
          conf.jam_pulang_akhir;
      }
    })
    .getAppConfig();
}

function saveGlobalConfig(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSaveConfig");
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';

  const formData = new FormData(e.target);
  const newConfig = {
    jam_masuk_mulai: formData.get("jam_masuk_mulai"),
    jam_masuk_akhir: formData.get("jam_masuk_akhir"),
    jam_pulang_mulai: formData.get("jam_pulang_mulai"),
    jam_pulang_akhir: formData.get("jam_pulang_akhir"),
  };

  google.script.run
    .withSuccessHandler((res) => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      if (res.success) {
        showAlert("success", "Pengaturan waktu berhasil disimpan!");
      } else {
        showAlert("error", res.message);
      }
    })
    .withFailureHandler((err) => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      showAlert("error", "Gagal koneksi: " + err);
    })
    .saveAppConfig(newConfig);
}

function renderLiburRows(data, startIdx) {
  const tbody = document.getElementById("tbody-libur");
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Tidak ada jadwal libur.</td></tr>';
    return;
  }
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  tbody.innerHTML = data
    .map(
      (item, i) => `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
            <td class="p-4 text-center text-gray-500">${startIdx + i + 1}</td>
            <td class="p-4 font-mono font-medium text-indigo-700">
                ${new Date(item.tanggal).toLocaleDateString("id-ID", options)}
            </td>
            <td class="p-4 font-bold text-gray-700">${item.keterangan}</td>
            <td class="p-4 text-center">
                <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                    <button onclick="editLibur('${item.tanggal}', '${item.keterangan}')" class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteLiburConfirm('${item.tanggal}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `,
    )
    .join("");
}

function editLibur(tgl, ket) {
  showModal(createLiburModal({ tanggal: tgl, keterangan: ket }));
}

function createLiburModal(data) {
  const inputClass =
    "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-3 transition-all mb-4";
  return `
    <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden animate-fade-in">
        <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
            <i class="fas fa-times"></i>
        </button>
        <div class="text-center mb-6">
            <div class="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm">
                <i class="fas fa-calendar-day"></i>
            </div>
            <h3 class="font-bold text-xl text-gray-800">Edit Hari Libur</h3>
            <p class="text-xs text-gray-500 mt-1">Perbarui tanggal atau keterangan</p>
        </div>
        <form onsubmit="saveUpdateLibur(event)">
            <input type="hidden" name="oldDate" value="${data.tanggal}">
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Tanggal</label>
            <input type="date" name="newDate" value="${data.tanggal}" required class="${inputClass}">
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Keterangan</label>
            <input type="text" name="newKeterangan" value="${data.keterangan}" required placeholder="Contoh: Cuti Bersama" class="${inputClass}">
            <div class="flex gap-3 mt-4">
                <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">Batal</button>
                <button type="submit" id="btnSaveLibur" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2">Simpan Perubahan</button>
            </div>
        </form>
    </div>`;
}

function saveUpdateLibur(e) {
  e.preventDefault();
  const btn = document.getElementById("btnSaveLibur");
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';
  btn.classList.add("opacity-75", "cursor-not-allowed");

  showLoading();
  const fd = new FormData(e.target);
  const oldDate = fd.get("oldDate");
  const newDate = fd.get("newDate");
  const newKet = fd.get("newKeterangan");

  google.script.run
    .withSuccessHandler((res) => {
      hideLoading();
      btn.disabled = false;
      btn.innerHTML = originalText;
      btn.classList.remove("opacity-75", "cursor-not-allowed");

      if (res.success) {
        closeModal();
        loadKelolaAbsen();
        showAlert("success", res.message);
      } else {
        showAlert("error", res.message);
      }
    })
    .withFailureHandler((error) => {
      hideLoading();
      btn.disabled = false;
      btn.innerHTML = originalText;
      btn.classList.remove("opacity-75", "cursor-not-allowed");
      showAlert("error", "Gagal menghubungi server: " + error);
    })
    .updateHariLibur(oldDate, newDate, newKet);
}

function handleAddLibur(e) {
  e.preventDefault();
  showLoading();
  const fd = new FormData(e.target);
  const tgl = fd.get("tanggal");
  const ket = fd.get("keterangan");

  google.script.run
    .withSuccessHandler((res) => {
      hideLoading();
      if (res.success) {
        e.target.reset();
        loadKelolaAbsen();
        showAlert("success", "Jadwal libur ditambahkan");
      } else {
        showAlert("error", res.message);
      }
    })
    .addHariLibur(tgl, ket);
}

function deleteLiburConfirm(tgl) {
  if (
    confirm(
      "Hapus hari libur ini? Siswa akan bisa absen kembali pada tanggal tersebut.",
    )
  ) {
    showLoading();
    google.script.run
      .withSuccessHandler((res) => {
        hideLoading();
        loadKelolaAbsen();
        showAlert("success", "Jadwal libur dihapus");
      })
      .deleteHariLibur(tgl);
  }
}

function loadDataSiswa() {
  stopAndBack(false);
  setActiveMenu("Data Siswa");
  showView("view-data-siswa");

  const dropdown = document.getElementById("filterKelasSiswa");
  if (dropdown && existingClasses && existingClasses.length > 0) {
    const currentValue = dropdown.value;
    let options = '<option value="">Semua Kelas</option>';
    existingClasses.forEach((kelas) => {
      options += `<option value="${kelas}">${kelas}</option>`;
    });
    dropdown.innerHTML = options;
    if (currentValue) dropdown.value = currentValue;
  }

  if (tableState.siswa.fullData.length > 0) {
    processTableData("siswa");
  } else {
    document.getElementById("tbody-siswa").innerHTML =
      '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data siswa...</td></tr>';
    google.script.run
      .withSuccessHandler((result) => {
        if (result.success) {
          tableState.siswa.fullData = result.data;
          processTableData("siswa");
        } else {
          showAlert("error", result.message);
        }
      })
      .getSiswaList();
  }
}

function renderSiswaRows(data, startIdx) {
  const tbody = document.getElementById("tbody-siswa");
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
    return;
  }
  tbody.innerHTML = data
    .map(
      (siswa, i) => `
    <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
        <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
        <td class="p-4">
            <div class="flex items-center">
                <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold mr-3">
                    ${siswa.nama.charAt(0)}
                </div>
                <div>
                    <div class="font-bold text-sm text-gray-900">${siswa.nama}</div>
                    <div class="text-xs text-gray-500 md:hidden">${siswa.nisn}</div>
                </div>
            </div>
        </td>
        <td class="p-4 hidden md:table-cell text-sm text-gray-600 font-mono">${siswa.nisn}</td>
        <td class="p-4 hidden sm:table-cell"><span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">${siswa.kelas}</span></td>
        <td class="p-4 text-center">
            <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                <button onclick='viewSiswa(${JSON.stringify(siswa)})' class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition" title="Lihat Detail">
                    <i class="fas fa-eye"></i>
                </button>
                <button onclick='editSiswa(${JSON.stringify(siswa)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit"><i class="fas fa-edit"></i></button>
                <button onclick="deleteSiswaConfirm('${siswa.nisn}', '${siswa.nama}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus"><i class="fas fa-trash"></i></button>
                <button onclick="generateQRForSiswa('${siswa.nisn}', '${siswa.nama}', '${siswa.kelas}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition" title="QR Code"><i class="fas fa-qrcode"></i></button>
            </div>
        </td>
    </tr>`,
    )
    .join("");
}

function loadDataGuru() {
  stopAndBack(false);
  setActiveMenu("Data Guru");
  showView("view-data-guru");

  const dropdown = document.getElementById("filterKelasGuru");
  if (dropdown && existingClasses && existingClasses.length > 0) {
    const currentValue = dropdown.value;
    let options = '<option value="">Semua Kelas</option>';
    existingClasses.forEach((kelas) => {
      options += `<option value="${kelas}">${kelas}</option>`;
    });
    dropdown.innerHTML = options;
    if (currentValue) dropdown.value = currentValue;
  }

  if (tableState.guru.fullData.length > 0) {
    processTableData("guru");
  } else {
    document.getElementById("tbody-guru").innerHTML =
      '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data guru...</td></tr>';
    const token = currentUser.token;

    google.script.run
      .withSuccessHandler((result) => {
        if (result.success) {
          tableState.guru.fullData = result.data;
          processTableData("guru");
        } else {
          document.getElementById("tbody-guru").innerHTML =
            `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${result.message}</td></tr>`;
          showAlert("error", result.message);
        }
      })
      .withFailureHandler((error) => {
        document.getElementById("tbody-guru").innerHTML =
          `<tr><td colspan="5" class="p-8 text-center text-red-500">Gagal koneksi: ${error}</td></tr>`;
      })
      .getGuruList(token);
  }
}

function renderGuruRows(data, startIdx) {
  const tbody = document.getElementById("tbody-guru");
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
    return;
  }
  tbody.innerHTML = data
    .map(
      (guru, i) => `
    <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
        <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
        <td class="p-4 text-sm font-bold text-gray-800">${guru.username}</td>
        <td class="p-4 text-sm text-gray-600">
            ${guru.kelas ? `<span class="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold">${guru.kelas}</span>` : '<span class="text-gray-400 italic text-xs">Semua Akses</span>'}
        </td>
        <td class="p-4 text-sm text-gray-400 font-mono">••••••••</td>
        <td class="p-4 text-center">
            <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                <button onclick='editGuru(${JSON.stringify(guru)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit Akun"><i class="fas fa-edit"></i></button>
                <button onclick="deleteGuruConfirm('${guru.username}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus Akun"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`,
    )
    .join("");
}

function saveSiswa(e, isEdit) {
  e.preventDefault();
  showLoading();

  const fd = new FormData(e.target);
  const siswaData = {
    nama: fd.get("nama"),
    nisn: "'" + fd.get("nisn"),
    jenisKelamin: fd.get("jenisKelamin"),
    tanggalLahir: fd.get("tanggalLahir"),
    agama: fd.get("agama"),
    namaAyah: fd.get("namaAyah"),
    namaIbu: fd.get("namaIbu"),
    noHp: "'" + fd.get("noHp"),
    kelas: fd.get("kelas"),
    alamat: fd.get("alamat"),
  };

  const token = currentUser ? currentUser.token : null;
  const callback = (res) => {
    hideLoading();
    if (res.success) {
      closeModal();
      tableState.siswa.fullData = [];
      loadDataSiswa();
      showAlert("success", res.message);
    } else {
      showAlert("error", res.message);
    }
  };

  const failureCallback = (err) => {
    hideLoading();
    showAlert("error", "Terjadi kesalahan: " + err);
  };

  if (isEdit) {
    const oldNisn = fd.get("oldNisn");
    google.script.run
      .withSuccessHandler(callback)
      .withFailureHandler(failureCallback)
      .updateSiswa(token, oldNisn, siswaData);
  } else {
    google.script.run
      .withSuccessHandler(callback)
      .withFailureHandler(failureCallback)
      .addSiswa(token, siswaData);
  }
}

function loadRekapAbsensi() {
  stopAndBack(false);
  setActiveMenu("Laporan");
  showView("view-rekap-absensi");

  document.getElementById("rekapEmptyState").classList.remove("hidden");
  document.getElementById("rekapContainer").classList.add("hidden");
  document.getElementById("rekapLoading").classList.add("hidden");
  tableState.rekap.fullData = [];

  const selectKelas = document.getElementById("fKelasRekap");
  if (selectKelas) {
    selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
    if (existingClasses && existingClasses.length > 0) {
      existingClasses.forEach((kelas) => {
        const option = document.createElement("option");
        option.value = kelas;
        option.textContent = kelas;
        selectKelas.appendChild(option);
      });
    }
  }
}

function applyFilter() {
  const emptyState = document.getElementById("rekapEmptyState");
  const container = document.getElementById("rekapContainer");
  const loading = document.getElementById("rekapLoading");

  emptyState.classList.add("hidden");
  container.classList.add("hidden");
  loading.classList.remove("hidden");

  const filter = {
    tanggalMulai: document.getElementById("fStart").value,
    tanggalAkhir: document.getElementById("fEnd").value,
    kelas: document.getElementById("fKelasRekap").value,
  };

  google.script.run
    .withSuccessHandler((result) => {
      loading.classList.add("hidden");
      container.classList.remove("hidden");

      if (result.success) {
        tableState.rekap.fullData = result.data;
        processTableData("rekap");
      } else {
        tableState.rekap.fullData = [];
        processTableData("rekap");
      }
    })
    .getAbsensiList(filter);
}

function exportToExcel() {
  const start = document.getElementById("fStart").value;
  const end = document.getElementById("fEnd").value;
  const kelas = document.getElementById("fKelasRekap").value;

  if (!start || !end) {
    showAlert("error", "Harap pilih rentang tanggal terlebih dahulu.");
    return;
  }

  const btn = document.getElementById("btnExportExcel");
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';

  const filters = {
    tanggalMulai: start,
    tanggalAkhir: end,
    kelas: kelas,
  };

  google.script.run
    .withSuccessHandler((result) => {
      btn.disabled = false;
      btn.innerHTML = originalText;

      if (result.success) {
        window.open(result.url, "_blank");
        showAlert("success", "File Excel berhasil diunduh!");
      } else {
        showAlert("error", result.message);
      }
    })
    .withFailureHandler((err) => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      showAlert("error", "Terjadi kesalahan server: " + err);
    })
    .generateExcel("laporan_absensi", filters);
}

function renderRekapRows(data) {
  const tbody = document.getElementById("tbody-rekap");
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="p-8 text-center text-gray-400">Tidak ada data ditemukan.</td></tr>';
    return;
  }

  const getStatusColor = (status) => {
    if (status === "Hadir") return "bg-green-100 text-green-700";
    if (status === "Izin") return "bg-blue-100 text-blue-700";
    if (status === "Sakit") return "bg-yellow-100 text-yellow-700";
    if (status === "Alpa") return "bg-red-100 text-red-700";
    return "bg-gray-100 text-gray-600";
  };

  tbody.innerHTML = data
    .map((d, i) => {
      let ketText = d.keterangan || "-";
      let ketStyle = "text-gray-500";
      let ketIcon = "";

      if (String(ketText).includes("Terlambat")) {
        ketStyle =
          "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
        ketIcon = '<i class="fas fa-history mr-1"></i>';
      } else if (String(ketText).includes("Pulang Cepat")) {
        ketStyle =
          "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
        ketIcon = '<i class="fas fa-running mr-1"></i>';
      } else if (ketText === "Tepat Waktu") {
        ketStyle = "text-emerald-600 font-bold text-[10px]";
        ketIcon = '<i class="fas fa-check-double mr-1"></i>';
      }

      return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition">
            <td class="p-4 text-center text-gray-500 text-xs">${i + 1}</td>
            <td class="p-4 text-sm text-gray-600">
               ${new Date(d.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
            </td>
            <td class="p-4 text-sm font-bold text-gray-900">${d.nama}</td>
            <td class="p-4 text-center text-sm text-gray-600">
               <span class="bg-gray-100 px-2 py-1 rounded text-xs font-bold">${d.kelas}</span>
            </td>
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamDatang}</td>
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamPulang}</td>
            <td class="p-4 text-center align-middle">
               <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>
            <td class="p-4 text-center text-sm">
                <span class="${getStatusColor(d.status)} px-2 py-1 rounded text-xs font-bold">
                   ${d.status || "Hadir"}
                </span>
            </td>
        </tr>`;
    })
    .join("");
}

function loadMonitoringAbsensi() {
  stopAndBack(false);
  setActiveMenu("Monitoring");
  showView("view-monitoring");
  document.getElementById("monitoringDate").textContent =
    new Date().toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const myClass = currentUser.role === "guru" ? currentUser.kelas : null;

  if (tableState.monitoring.fullData.length > 0) {
    processTableData("monitoring");
  } else {
    document.getElementById("tbody-monitoring").innerHTML =
      '<tr><td colspan="6" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';

    google.script.run
      .withSuccessHandler((result) => {
        if (result.success) {
          tableState.monitoring.fullData = result.data;
          processTableData("monitoring");
        } else {
          document.getElementById("tbody-monitoring").innerHTML =
            '<tr><td colspan="6" class="p-12 text-center text-gray-400 italic bg-white">Data tidak ditemukan.</td></tr>';
        }
      })
      .getMonitoringRealtime(myClass);
  }
}

function exportMonitoringExcel() {
  const btn = document.getElementById("btnExportMonitoring");
  const originalContent = btn.innerHTML;

  btn.disabled = true;
  btn.classList.add("cursor-not-allowed", "opacity-75");
  btn.innerHTML =
    '<i class="fas fa-circle-notch fa-spin"></i> <span class="hidden sm:inline">Memproses...</span>';

  const myClass =
    currentUser && currentUser.role === "guru" ? currentUser.kelas : null;
  const filters = { kelas: myClass };

  google.script.run
    .withSuccessHandler((result) => {
      btn.disabled = false;
      btn.classList.remove("cursor-not-allowed", "opacity-75");
      btn.innerHTML = originalContent;

      if (result.success) {
        window.open(result.url, "_blank");
        showAlert("success", "Data monitoring berhasil di-export!");
      } else {
        showAlert("error", result.message);
      }
    })
    .withFailureHandler((err) => {
      btn.disabled = false;
      btn.classList.remove("cursor-not-allowed", "opacity-75");
      btn.innerHTML = originalContent;
      showAlert("error", "Gagal menghubungi server: " + err);
    })
    .generateExcel("monitoring", filters);
}

function renderMonitoringRows(data, startIdx) {
  const tbody = document.getElementById("tbody-monitoring");
  if (data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="p-12 text-center text-gray-400 italic bg-white">Tidak ada data ditemukan.</td></tr>';
    return;
  }

  const canEdit = currentUser.role === "guru" || currentUser.role === "admin";
  const cursorClass = canEdit
    ? "cursor-pointer"
    : "cursor-not-allowed opacity-70";
  const disabledAttr = canEdit ? "" : "disabled";

  tbody.innerHTML = data
    .map((d, i) => {
      let statusColor = "bg-gray-100 text-gray-600";
      if (d.status === "Hadir") statusColor = "bg-green-100 text-green-700";
      else if (d.status === "Izin") statusColor = "bg-blue-100 text-blue-700";
      else if (d.status === "Sakit")
        statusColor = "bg-yellow-100 text-yellow-700";
      else if (d.status === "Alpa") statusColor = "bg-red-100 text-red-700";

      let ketText = d.keterangan || "-";
      let ketStyle = "text-gray-400 font-mono text-[10px]";
      let ketIcon = "";

      if (String(ketText).includes("Terlambat")) {
        ketStyle =
          "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
        ketIcon = '<i class="fas fa-history mr-1"></i>';
      } else if (String(ketText).includes("Pulang Cepat")) {
        ketStyle =
          "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
        ketIcon = '<i class="fas fa-running mr-1"></i>';
      } else if (ketText === "Tepat Waktu") {
        ketStyle = "text-emerald-600 font-bold text-[10px]";
        ketIcon = '<i class="fas fa-check-double mr-1"></i>';
      }

      return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
            <td class="p-4 text-center text-gray-400 text-xs">${startIdx + i + 1}</td>
            <td class="p-4">
                <div class="font-bold text-sm text-gray-900">${d.nama}</div>
                <div class="text-xs text-gray-500 font-mono">${d.nisn}</div>
            </td>
            <td class="p-4 text-center">
                <span class="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-xs font-bold border border-indigo-100">${d.kelas}</span>
            </td>
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamDatang}</td>
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamPulang}</td>
            <td class="p-4 text-center align-middle">
                 <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>
            <td class="p-4 text-center relative">
                <select onchange="changeStatus('${d.nisn}', '${d.nama}', '${d.kelas}', this)" 
                        class="text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 ${statusColor} ${cursorClass}"
                        ${disabledAttr}>
                    <option value="Belum Absen" ${d.status === "Belum Absen" ? "selected" : ""}>Belum Absen</option>
                    <option value="Hadir" ${d.status === "Hadir" ? "selected" : ""}>Hadir</option>
                    <option value="Izin" ${d.status === "Izin" ? "selected" : ""}>Izin</option>
                    <option value="Sakit" ${d.status === "Sakit" ? "selected" : ""}>Sakit</option>
                    <option value="Alpa" ${d.status === "Alpa" ? "selected" : ""}>Alpa</option>
                </select>
                ${canEdit ? '<i class="fas fa-chevron-down absolute right-6 top-1/2 transform -translate-y-1/2 text-[10px] pointer-events-none opacity-40"></i>' : ""}
            </td>
        </tr>`;
    })
    .join("");
}

function changeStatus(nisn, nama, kelas, selectElement) {
  const newStatus = selectElement.value;
  selectElement.disabled = true;
  selectElement.style.opacity = "0.5";

  const token = currentUser ? currentUser.token : null;

  google.script.run
    .withSuccessHandler((res) => {
      selectElement.disabled = false;
      selectElement.style.opacity = "1";

      if (res.success) {
        let newColor = "bg-gray-100 text-gray-600";
        if (newStatus === "Hadir") newColor = "bg-green-100 text-green-700";
        else if (newStatus === "Izin") newColor = "bg-blue-100 text-blue-700";
        else if (newStatus === "Sakit")
          newColor = "bg-yellow-100 text-yellow-700";
        else if (newStatus === "Alpa") newColor = "bg-red-100 text-red-700";

        selectElement.className = `text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 cursor-pointer ${newColor}`;
      } else {
        showAlert("error", "Gagal update: " + res.message);
        loadMonitoringAbsensi();
      }
    })
    .withFailureHandler((error) => {
      selectElement.disabled = false;
      selectElement.style.opacity = "1";
      showAlert("error", "Error koneksi: " + error);
    })
    .updateAbsensiStatus(token, nisn, nama, kelas, newStatus);
}

function loadQRCodeSiswa(nisnParam, namaParam, kelasParam) {
  stopAndBack(false);

  if (currentUser.role === "siswa") {
    setActiveMenu("Kartu Saya");
  }

  showView("view-kartu-siswa");
  const container = document.getElementById("kartuSiswaContainer");

  const namaSiswa = namaParam || currentUser.nama || "Siswa";
  const nisnSiswa = nisnParam || currentUser.nisn || "1234567890";
  const kelasSiswa = kelasParam || currentUser.kelas || "X";

  let backFunction = "loadSiswaDashboard()";
  if (currentUser.role === "admin" || currentUser.role === "guru") {
    backFunction = "loadDataSiswa()";
  }

  container.innerHTML = `
        <div class="flex justify-center items-center h-full py-12 animate-slide-up">
            <div class="bg-white rounded-3xl shadow-2xl overflow-hidden w-full max-w-sm relative transform hover:scale-[1.02] transition duration-300">
                <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white text-center relative overflow-hidden">
                    <div class="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
                    <h2 class="text-2xl font-bold tracking-tight">KARTU PELAJAR</h2>
                    <p class="text-xs tracking-[0.2em] uppercase opacity-80 mt-1">Sekolah Negeri Bengkulu</p>
                </div>
    
                <div class="p-8 text-center bg-gray-50">
                    <div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 inline-block mb-5">
                        <div id="myQrcode"></div>
                    </div>
    
                    <h3 class="text-2xl font-bold text-gray-800 mb-1">${namaSiswa}</h3>
                    <p class="text-indigo-600 font-mono font-bold text-lg mb-3 tracking-wider">${nisnSiswa}</p>
                    <span class="inline-block px-4 py-1.5 bg-gray-200 text-gray-700 rounded-full text-sm font-bold shadow-sm">${kelasSiswa}</span>
                </div>
                <div class="p-5 bg-white border-t border-gray-100 flex gap-4">
                    <button onclick="window.print()" class="flex-1 bg-gray-900 text-white py-3 rounded-xl font-bold text-sm shadow hover:bg-black transition flex items-center justify-center">
                        <i class="fas fa-print mr-2"></i> Cetak
                    </button>
                    <button onclick="${backFunction}" class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition">
                        Tutup
                    </button>
                </div>
            </div>
        </div>`;

  setTimeout(() => {
    if (nisnSiswa) {
      document.getElementById("myQrcode").innerHTML = "";
      new QRCode(document.getElementById("myQrcode"), {
        text: String(nisnSiswa),
        width: 160,
        height: 160,
        colorDark: "#1f2937",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
      });
    } else {
      document.getElementById("myQrcode").textContent = "Error NISN";
    }
  }, 100);
}

function loadScanAbsensi() {
  isScanning = false;
  setActiveMenu("Scan Absensi");
  showView("view-scanner");
  setTimeout(() => {
    startCamera("environment");
  }, 500);
}

function startCamera(mode) {
  if (html5QrCode) {
    html5QrCode
      .stop()
      .then(() => {
        html5QrCode.clear();
        initCamera(mode);
      })
      .catch((err) => initCamera(mode));
  } else {
    initCamera(mode);
  }
}

function initCamera(mode) {
  const loading = document.getElementById("camLoading");
  loading.classList.remove("hidden");

  html5QrCode = new Html5Qrcode("reader");
  const config = {
    fps: 10,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0,
  };
  html5QrCode
    .start(
      { facingMode: mode },
      config,
      (decodedText) => onScanSuccess(decodedText),
      (errorMessage) => {},
    )
    .then(() => {
      loading.classList.add("hidden");
      isScanning = false;
    })
    .catch((err) => {
      loading.classList.add("hidden");
      const resDiv = document.getElementById("scanResult");
      resDiv.classList.remove("hidden");
      resDiv.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-bold text-sm">Gagal Mengakses Kamera: ${err}</div>`;
    });
}

function onScanSuccess(decodedText) {
  if (!decodedText || decodedText.trim() === "" || decodedText === "undefined")
    return;
  if (isScanning) return;
  isScanning = true;

  const resultDiv = document.getElementById("scanResult");
  resultDiv.classList.remove("hidden");
  resultDiv.innerHTML = `
        <div class="bg-indigo-50 text-indigo-700 p-4 rounded-xl border border-indigo-100 flex items-center justify-center animate-pulse font-bold shadow-sm">
            <i class="fas fa-circle-notch fa-spin mr-3"></i> Memproses Data...
        </div>`;

  const myRole = currentUser ? currentUser.role : "";
  const myKelas = currentUser ? currentUser.kelas : "";

  google.script.run
    .withSuccessHandler((result) => {
      if (result.success) {
        const color = result.type === "datang" ? "green" : "blue";
        const namaSiswa = result.nama || "Siswa";
        const kelasSiswa = result.kelas || "";

        resultDiv.innerHTML = `
                <div class="bg-${color}-50 text-${color}-900 p-6 rounded-2xl border border-${color}-100 shadow-md animate-fade-in relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-4 opacity-10"><i class="fas fa-check-circle text-6xl"></i></div>
                    <h3 class="font-bold text-xl uppercase mb-1 tracking-tight">${namaSiswa}</h3>
                    <p class="text-sm font-semibold opacity-70 mb-4">${kelasSiswa}</p>
                    <div class="bg-white/60 backdrop-blur-sm p-3 rounded-xl border border-${color}-200 inline-block">
                        <div class="text-xs uppercase tracking-widest font-bold opacity-60 mb-1">${result.message}</div>
                        <div class="text-3xl font-mono font-bold">${result.type === "datang" ? result.jamDatang : result.jamPulang}</div>
                    </div>
                    <p class="text-xs mt-4 font-bold uppercase tracking-wide opacity-50 animate-pulse">Siap untuk siswa berikutnya...</p>
                </div>`;
        setTimeout(() => {
          isScanning = false;
        }, 3000);
      } else {
        resultDiv.innerHTML = `
                <div class="bg-red-50 text-red-700 p-5 rounded-2xl border border-red-100 shadow-sm flex items-center space-x-4">
                    <div class="bg-red-100 p-3 rounded-full"><i class="fas fa-times text-xl"></i></div>
                    <div class="text-left">
                        <h4 class="font-bold">Gagal!</h4>
                        <p class="text-sm opacity-90">${result.message}</p>
                    </div>
                </div>`;
        setTimeout(() => {
          isScanning = false;
        }, 4000);
      }
    })
    .scanAbsensi(decodedText, myRole, myKelas);
}

function stopAndBack(redirect = true) {
  if (html5QrCode) {
    html5QrCode
      .stop()
      .then(() => {
        html5QrCode.clear();
        html5QrCode = null;
        isScanning = false;
        if (redirect && currentUser) returnToDashboard();
      })
      .catch(() => {
        html5QrCode = null;
        if (redirect && currentUser) returnToDashboard();
      });
  } else {
    if (redirect && currentUser) returnToDashboard();
  }
}

function returnToDashboard() {
  if (currentUser.role === "admin") loadAdminDashboard();
  else if (currentUser.role === "guru") loadGuruDashboard();
  else loadSiswaDashboard();
}

function showLoading() {
  document.getElementById("loadingOverlay").classList.remove("hidden");
}
function hideLoading() {
  document.getElementById("loadingOverlay").classList.add("hidden");
}

function showModal(content) {
  const container = document.getElementById("modalContainer");
  container.innerHTML = `
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onclick="closeModal()"></div>
            <div class="relative w-full max-w-2xl transform transition-all animate-fade-in">
                ${content}
            </div>
        </div>`;
}

function closeModal() {
  document.getElementById("modalContainer").innerHTML = "";
}

function showAlert(type, message) {
  const bg = type === "success" ? "bg-green-600" : "bg-red-600";
  const div = document.createElement("div");
  div.className = `fixed top-6 right-6 ${bg} text-white px-6 py-4 rounded-xl shadow-2xl z-[80] flex items-center font-medium animate-fade-in transform translate-y-2`;
  div.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"} mr-3 text-xl"></i> ${message}`;
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.opacity = "0";
    setTimeout(() => div.remove(), 300);
  }, 3000);
}

function showAddSiswaModal() {
  showModal(createSiswaModal());
}
function editSiswa(s) {
  showModal(createSiswaModal(s));
}
function showAddGuruModal() {
  showModal(createGuruModal());
}
function editGuru(guruData) {
  showModal(createGuruModal(guruData));
}

function createSiswaModal(s = null) {
  const isEdit = s !== null;
  const inputClass =
    "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 transition-all";
  const labelClass =
    "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";

  return `
    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h3 class="text-xl font-bold text-gray-800">${isEdit ? "Edit Data Siswa" : "Registrasi Siswa Baru"}</h3>
            <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
        </div>
        <div class="p-6 max-h-[75vh] overflow-y-auto">
            <form onsubmit="saveSiswa(event, ${isEdit})" class="space-y-5">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div class="md:col-span-2">
                        <label class="${labelClass}">Nama Lengkap</label>
                        <input type="text" name="nama" value="${s?.nama || ""}" required class="${inputClass}" placeholder="Sesuai Akta Kelahiran">
                    </div>
                    <div>
                        <label class="${labelClass}">NISN</label>
                        <input type="number" name="nisn" value="${s?.nisn || ""}" required ${isEdit ? 'readonly class="' + inputClass + ' opacity-60 cursor-not-allowed"' : `class="${inputClass}"`} placeholder="Nomor Induk">
                    </div>
                    
                    <div class="relative group">
                        <label class="${labelClass}">Kelas</label>
                        <input type="text" name="kelas" id="inputKelas" 
                            value="${s?.kelas || ""}" 
                            required 
                            class="${inputClass}" 
                            placeholder="Ketik atau pilih kelas" 
                            autocomplete="off"
                            onfocus="openKelasDropdown()"
                            oninput="filterKelasDropdown(this.value)"
                            onblur="closeKelasDropdown()">
                        <div id="dropdownKelasList" class="hidden absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto mt-1 scrollbar-hide"></div>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div>
                        <label class="${labelClass}">Jenis Kelamin</label>
                        <select name="jenisKelamin" class="${inputClass}">
                            <option value="Laki-laki" ${s?.jenisKelamin === "Laki-laki" ? "selected" : ""}>Laki-laki</option>
                            <option value="Perempuan" ${s?.jenisKelamin === "Perempuan" ? "selected" : ""}>Perempuan</option>
                        </select>
                    </div>
                    <div>
                        <label class="${labelClass}">Tanggal Lahir</label>
                        <input type="date" name="tanggalLahir" value="${s?.tanggalLahir || ""}" required class="${inputClass}">
                    </div>
                    <div>
                        <label class="${labelClass}">Agama</label>
                        <select name="agama" class="${inputClass}">
                            <option value="Islam" ${s?.agama === "Islam" ? "selected" : ""}>Islam</option>
                            <option value="Kristen" ${s?.agama === "Kristen" ? "selected" : ""}>Kristen</option>
                            <option value="Katolik" ${s?.agama === "Katolik" ? "selected" : ""}>Katolik</option>
                            <option value="Hindu" ${s?.agama === "Hindu" ? "selected" : ""}>Hindu</option>
                            <option value="Buddha" ${s?.agama === "Buddha" ? "selected" : ""}>Buddha</option>
                            <option value="Lainnya" ${s?.agama === "Lainnya" ? "selected" : ""}>Lainnya</option>
                        </select>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-5 bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <div>
                        <label class="${labelClass}">Nama Ayah</label>
                        <input type="text" name="namaAyah" value="${s?.namaAyah || ""}" class="${inputClass}">
                    </div>
                    <div>
                        <label class="${labelClass}">Nama Ibu</label>
                        <input type="text" name="namaIbu" value="${s?.namaIbu || ""}" class="${inputClass}">
                    </div>
                    <div>
                        <label class="${labelClass}">No. Handphone</label>
                        <input type="tel" name="noHp" value="${s?.noHp || ""}" class="${inputClass}">
                    </div>
                </div>
                <div>
                    <label class="${labelClass}">Alamat Lengkap</label>
                    <textarea name="alamat" rows="2" class="${inputClass}">${s?.alamat || ""}</textarea>
                </div>
                <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Batal</button>
                    <button type="submit" class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition transform active:scale-95">Simpan Data</button>
                </div>
                ${isEdit ? `<input type="hidden" name="oldNisn" value="${s.nisn}">` : ""}
            </form>
        </div>
    </div>`;
}

function viewSiswa(siswa) {
  showModal(createViewSiswaModal(siswa));
}

function createViewSiswaModal(s) {
  const item = (label, value, icon) => `
        <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
            <div class="flex items-center gap-2 mb-1">
                <i class="fas ${icon} text-gray-400 text-xs"></i>
                <span class="text-[10px] uppercase font-bold text-gray-500 tracking-wider">${label}</span>
            </div>
            <div class="text-sm font-bold text-gray-800 break-words">${value || "-"}</div>
        </div>
    `;

  return `
    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full animate-fade-in relative">
        <div class="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white flex justify-between items-start">
            <div class="flex gap-4 items-center">
                <div class="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-2xl font-bold border-2 border-white/30 shadow-inner">
                    ${s.nama.charAt(0)}
                </div>
                <div>
                    <h3 class="text-xl font-bold tracking-tight">${s.nama}</h3>
                    <p class="opacity-90 text-sm flex items-center gap-2">
                        <i class="far fa-id-card"></i> ${s.nisn}
                        <span class="bg-white/20 px-2 py-0.5 rounded text-xs font-bold ml-2">${s.kelas}</span>
                    </p>
                </div>
            </div>
            <button onclick="closeModal()" class="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition text-white">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="p-6 max-h-[70vh] overflow-y-auto">
            <div class="mb-6">
                <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                    <i class="fas fa-user-circle"></i> Data Pribadi
                </h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    ${item("Jenis Kelamin", s.jenisKelamin, "fa-venus-mars")}
                    ${item("Tanggal Lahir", s.tanggalLahir, "fa-birthday-cake")}
                    ${item("Agama", s.agama, "fa-pray")}
                    ${item("No. Handphone", s.noHp, "fa-phone")}
                </div>
            </div>

            <div class="mb-6">
                <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                    <i class="fas fa-users"></i> Data Orang Tua
                </h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    ${item("Nama Ayah", s.namaAyah, "fa-male")}
                    ${item("Nama Ibu", s.namaIbu, "fa-female")}
                </div>
            </div>

            <div>
                <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                    <i class="fas fa-map-marker-alt"></i> Alamat Lengkap
                </h4>
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 flex gap-3 items-start">
                    <i class="fas fa-home text-gray-400 mt-1"></i>
                    <p class="text-sm text-gray-700 leading-relaxed font-medium">
                        ${s.alamat || "Alamat belum diisi."}
                    </p>
                </div>
            </div>
        </div>

        <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
            <button onclick="editSiswa(${JSON.stringify(s).replace(/"/g, "&quot;")})" class="px-5 py-2.5 bg-amber-100 text-amber-700 rounded-xl font-bold text-sm hover:bg-amber-200 transition flex items-center gap-2">
                <i class="fas fa-edit"></i> Edit Data
            </button>
            <button onclick="closeModal()" class="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-300 transition">
                Tutup
            </button>
        </div>
    </div>`;
}

function createGuruModal(guru = null) {
  const isEdit = guru !== null;
  const inputClass =
    "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-purple-500 focus:border-purple-500 block p-3 transition-all mb-4";

  let kelasOptions = '<option value="">-- Pilih Kelas (Opsional) --</option>';
  if (existingClasses && existingClasses.length > 0) {
    existingClasses.forEach((k) => {
      const selected = guru && guru.kelas === k ? "selected" : "";
      kelasOptions += `<option value="${k}" ${selected}>${k}</option>`;
    });
  }

  return `
    <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden">
        <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        <div class="text-center mb-6">
            <div class="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm"><i class="fas fa-chalkboard-teacher"></i></div>
            <h3 class="font-bold text-xl text-gray-800">${isEdit ? "Edit Akun Guru" : "Tambah Guru"}</h3>
        </div>
        
        <form onsubmit="saveGuru(event, ${isEdit})">
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Username</label>
            <input name="username" value="${guru?.username || ""}" placeholder="Username" required class="${inputClass}">
            
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Password</label>
            <input name="password" value="${guru?.password || ""}" placeholder="Password" required class="${inputClass}">
            
            <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Wali Kelas Untuk</label>
            <select name="kelas" class="${inputClass}">
                ${kelasOptions}
            </select>
            <p class="text-[10px] text-gray-400 -mt-3 mb-4">Jika dipilih, guru hanya bisa melihat siswa di kelas ini.</p>
            
            ${isEdit ? `<input type="hidden" name="oldUsername" value="${guru.username}">` : ""}

            <div class="flex gap-3 mt-2">
                <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">Batal</button>
                <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95">Simpan</button>
            </div>
        </form>
    </div>`;
}

function saveGuru(e, isEdit) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML =
    '<i class="fas fa-circle-notch fa-spin mr-2"></i> Menyimpan...';
  btn.classList.add("opacity-75", "cursor-not-allowed");

  const fd = new FormData(form);
  const username = "'" + fd.get("username");
  const password = "'" + fd.get("password");
  const kelas = fd.get("kelas");

  const token = currentUser ? currentUser.token : null;

  const onComplete = (r) => {
    btn.disabled = false;
    btn.innerHTML = originalText;
    btn.classList.remove("opacity-75", "cursor-not-allowed");

    if (r && r.success) {
      closeModal();
      tableState.guru.fullData = [];
      loadDataGuru();
      showAlert(
        "success",
        isEdit ? "Data guru berhasil diperbarui" : "Akun Guru berhasil dibuat",
      );
    } else {
      showAlert("error", r ? r.message : "Terjadi kesalahan tidak diketahui");
    }
  };

  const onFailure = (error) => {
    btn.disabled = false;
    btn.innerHTML = originalText;
    btn.classList.remove("opacity-75", "cursor-not-allowed");
    showAlert("error", "Gagal koneksi server: " + error);
  };

  if (isEdit) {
    const oldUsername = fd.get("oldUsername");
    google.script.run
      .withSuccessHandler(onComplete)
      .withFailureHandler(onFailure)
      .updateGuru(token, oldUsername, username, password, kelas);
  } else {
    google.script.run
      .withSuccessHandler(onComplete)
      .withFailureHandler(onFailure)
      .addGuru(token, username, password, kelas);
  }
}

function deleteSiswaConfirm(nisn, nama) {
  Swal.fire({
    title: "Apakah Anda yakin?",
    text: `Data siswa "${nama}" akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan!`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#EF4444",
    cancelButtonColor: "#6B7280",
    confirmButtonText: "Ya, Hapus!",
    cancelButtonText: "Batal",
    reverseButtons: true,
  }).then((result) => {
    if (result.isConfirmed) {
      showLoading();
      const token = currentUser.token;

      google.script.run
        .withSuccessHandler((r) => {
          hideLoading();
          if (r.success) {
            tableState.siswa.fullData = [];
            loadDataSiswa();
            Swal.fire("Terhapus!", "Data siswa berhasil dihapus.", "success");
          } else {
            Swal.fire("Gagal!", r.message, "error");
          }
        })
        .withFailureHandler((err) => {
          hideLoading();
          Swal.fire("Error", "Terjadi kesalahan server: " + err, "error");
        })
        .deleteSiswa(token, nisn);
    }
  });
}

function deleteGuruConfirm(username) {
  if (confirm(`Hapus akses untuk guru: ${username}?`)) {
    showLoading();
    const token = currentUser ? currentUser.token : null;

    google.script.run
      .withSuccessHandler((r) => {
        hideLoading();
        if (r.success) {
          tableState.guru.fullData = [];
          loadDataGuru();
          showAlert("success", "Akun guru berhasil dihapus");
        } else {
          showAlert("error", r.message);
        }
      })
      .withFailureHandler((error) => {
        hideLoading();
        showAlert("error", "Gagal menghapus: " + error);
      })
      .deleteGuru(token, username);
  }
}

function generateQRForSiswa(nisn, nama, kelas) {
  loadQRCodeSiswa(nisn, nama, kelas);
}

// Start App
checkSession();
