const state = {
  orders: [],
  selectedOrderId: null
};

const orderForm = document.getElementById("order-form");
const paymentTypeInput = document.getElementById("paymentType");
const initialPaymentInput = document.getElementById("initialPayment");
const initialPaymentWrapper = document.getElementById("initial-payment-wrapper");
const ordersTableBody = document.getElementById("ordersTableBody");
const clearAllBtn = document.getElementById("clearAll");
const searchInput = document.getElementById("searchInput");
const filterPaymentTypeInput = document.getElementById("filterPaymentType");
const filterStatusInput = document.getElementById("filterStatus");
const chartPeriodInput = document.getElementById("chartPeriod");
const exportRevenuePdfBtn = document.getElementById("exportRevenuePdf");
const exportOrdersPdfBtn = document.getElementById("exportOrdersPdf");
const LEGACY_STORAGE_KEY = "gestion_commandes_tissus_v1";

const statOrders = document.getElementById("statOrders");
const statTotal = document.getElementById("statTotal");
const statRemaining = document.getElementById("statRemaining");

const paymentDialog = document.getElementById("paymentDialog");
const paymentForm = document.getElementById("paymentForm");
const paymentAmountInput = document.getElementById("paymentAmount");
const paymentDateInput = document.getElementById("paymentDate");
const dialogClient = document.getElementById("dialogClient");
const cancelDialogBtn = document.getElementById("cancelDialog");
const historyDialog = document.getElementById("historyDialog");
const historyClient = document.getElementById("historyClient");
const historySummary = document.getElementById("historySummary");
const historyTableBody = document.getElementById("historyTableBody");
const ordersChartCanvas = document.getElementById("ordersChart");
let ordersChart = null;
const exportInvoiceBtn = document.getElementById("exportInvoiceBtn");
let currentHistoryOrder = null;
if (exportInvoiceBtn) {
  exportInvoiceBtn.disabled = true;
}

async function apiGetOrders() {
  const response = await fetch("/api/orders");
  if (!response.ok) throw new Error("Erreur API");
  return response.json();
}

async function apiCreateOrder(payload) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Erreur creation commande");
}

async function apiAddPayment(orderId, payload) {
  const response = await fetch(`/api/orders/${orderId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Erreur ajout paiement");
}

async function apiDeleteOrder(orderId) {
  const response = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Erreur suppression commande");
}

async function apiDeleteAllOrders() {
  const response = await fetch("/api/orders", { method: "DELETE" });
  if (!response.ok) throw new Error("Erreur suppression totale");
}

async function apiImportOrders(orders) {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orders })
  });
  if (!response.ok) throw new Error("Erreur importation");
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function getNowLocalInputValue() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

async function refreshOrders() {
  state.orders = await apiGetOrders();
  renderOrders();
}

async function migrateLegacyLocalStorageIfNeeded() {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return false;

  let legacyOrders = [];
  try {
    const parsed = JSON.parse(raw);
    legacyOrders = Array.isArray(parsed) ? parsed : [];
  } catch {
    return false;
  }

  if (legacyOrders.length === 0) return false;

  const confirmImport = confirm(
    `J'ai trouve ${legacyOrders.length} ancienne(s) commande(s) en local. Voulez-vous les importer dans la base de donnees ?`
  );
  if (!confirmImport) return false;

  await apiImportOrders(legacyOrders);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return true;
}

function getOrderPaid(order) {
  const paymentsTotal = (order.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return Math.min(order.total, Math.max(0, paymentsTotal));
}

function getRemaining(order) {
  return Math.max(0, order.total - getOrderPaid(order));
}

function updateStats() {
  const visibleOrders = getFilteredOrders();
  const totalOrders = visibleOrders.length;
  const totalAmount = visibleOrders.reduce((sum, o) => sum + o.total, 0);
  const totalRemaining = visibleOrders.reduce((sum, o) => sum + getRemaining(o), 0);

  statOrders.textContent = String(totalOrders);
  statTotal.textContent = formatMoney(totalAmount);
  statRemaining.textContent = formatMoney(totalRemaining);
}

function toDayKey(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getWeekInfo(date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return { year: utcDate.getUTCFullYear(), week: weekNo };
}

function getPeriodKey(isoDate, period) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  if (period === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  if (period === "week") {
    const info = getWeekInfo(date);
    return `${info.year}-W${String(info.week).padStart(2, "0")}`;
  }
  return toDayKey(isoDate);
}

function formatPeriodLabel(periodKey, period) {
  if (period === "month") {
    const [year, month] = periodKey.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(date);
  }
  if (period === "week") {
    return `Sem ${periodKey.split("-W")[1]} (${periodKey.split("-W")[0]})`;
  }
  const date = new Date(`${periodKey}T00:00:00`);
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(date);
}

function getRevenueByPeriod(orders, period) {
  const paymentsByPeriod = new Map();
  const periodSet = new Set();

  for (const order of orders) {
    for (const payment of order.payments || []) {
      const paymentPeriod = getPeriodKey(payment.date, period);
      if (!paymentPeriod) continue;
      periodSet.add(paymentPeriod);
      paymentsByPeriod.set(paymentPeriod, (paymentsByPeriod.get(paymentPeriod) || 0) + Number(payment.amount || 0));
    }
  }

  const sortedPeriods = [...periodSet].sort();
  return sortedPeriods.map((periodKey) => ({
    periodKey,
    periodLabel: formatPeriodLabel(periodKey, period),
    amount: paymentsByPeriod.get(periodKey) || 0
  }));
}

function createPdf(title, orientation = "landscape") {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Bibliotheque PDF non chargee. Verifiez votre connexion internet.");
    return null;
  }
  const doc = new window.jspdf.jsPDF({ orientation });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(10);
  doc.text(`Genere le: ${new Date().toLocaleString("fr-FR")}`, 14, 20);
  return doc;
}

function createInvoicePdf(order) {
  const paid = getOrderPaid(order);
  const remaining = getRemaining(order);
  const doc = createPdf(`Facture - ${order.clientName}`, "portrait");
  if (!doc) return null;

  const invoiceNumber = order.id || `FACT-${Date.now()}`;
  const createdAt = formatDate(order.createdAt);

  doc.setFontSize(12);
  doc.text("Facture client", 14, 28);
  doc.setFontSize(10);
  doc.text(`Facture n°: ${invoiceNumber}`, 14, 36);
  doc.text(`Client: ${order.clientName}`, 14, 42);
  doc.text(`Téléphone: ${order.phone || "N/A"}`, 14, 48);
  doc.text(`Article: ${order.itemName}`, 14, 54);
  doc.text(`Quantité: ${order.quantity}`, 14, 60);
  doc.text(`Prix unitaire: ${formatMoney(order.unitPrice)}`, 14, 66);
  doc.text(`Total commande: ${formatMoney(order.total)}`, 14, 72);
  doc.text(`Payé: ${formatMoney(paid)}`, 14, 78);
  doc.text(`Reste: ${formatMoney(remaining)}`, 14, 84);
  doc.text(`Date commande: ${createdAt}`, 14, 90);

  const payments = [...(order.payments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const paymentRows = payments.map((payment) => [
    formatDate(payment.date),
    formatMoney(Number(payment.amount || 0)),
    payment.note || ""
  ]);

  if (paymentRows.length > 0) {
    doc.autoTable({
      head: [["Date", "Montant", "Note"]],
      body: paymentRows,
      startY: 100,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] }
    });
  } else {
    doc.text("Aucun versement enregistre.", 14, 110);
  }

  return doc;
}

function downloadInvoice(order) {
  const doc = createInvoicePdf(order);
  if (!doc) return;
  const safeName = order.clientName.replace(/[^a-z0-9-_]/gi, "_").toLowerCase();
  doc.save(`facture_${safeName}_${order.id || Date.now()}.pdf`);
}

function renderChart(orders) {
  if (!ordersChartCanvas || typeof Chart === "undefined") return;
  const period = chartPeriodInput?.value || "day";
  const revenueRows = getRevenueByPeriod(orders, period);
  const labels = revenueRows.map((row) => row.periodLabel);
  const paidSeries = revenueRows.map((row) => row.amount);

  if (ordersChart) {
    ordersChart.destroy();
  }

  ordersChart = new Chart(ordersChartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Recettes encaissées",
          data: paidSeries,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.55)",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom"
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Dates"
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Montant encaissé (FCFA)"
          }
        }
      }
    }
  });
}

function renderOrders() {
  ordersTableBody.innerHTML = "";
  const visibleOrders = getFilteredOrders();
  renderChart(visibleOrders);

  if (visibleOrders.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7">Aucune commande trouvée avec ces filtres.</td>`;
    ordersTableBody.appendChild(row);
    updateStats();
    return;
  }

  for (const order of visibleOrders) {
    const paid = getOrderPaid(order);
    const remaining = getRemaining(order);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(order.clientName)}</strong><br>
        <small>${escapeHtml(order.phone || "Sans téléphone")}</small>
      </td>
      <td>
        ${escapeHtml(order.itemName)}<br>
        <small>Qté: ${order.quantity} x ${formatMoney(order.unitPrice)}</small>
      </td>
      <td>
        <span class="badge ${order.paymentType === "cash" ? "badge-cash" : "badge-tontine"}">
          ${order.paymentType === "cash" ? "Cash" : "Tontine"}
        </span>
      </td>
      <td>${formatMoney(order.total)}</td>
      <td>${formatMoney(paid)}</td>
      <td>${formatMoney(remaining)}</td>
      <td>
        <div class="actions">
          <button class="btn-small" data-action="show-history" data-id="${order.id}">
            Historique
          </button>
          <button class="btn-small" data-action="add-payment" data-id="${order.id}" ${remaining === 0 ? "disabled" : ""}>
            Versement
          </button>
          <button class="btn-small btn-danger" data-action="delete-order" data-id="${order.id}">
            Supprimer
          </button>
        </div>
      </td>
    `;
    ordersTableBody.appendChild(tr);
  }

  updateStats();
}

function getFilteredOrders() {
  const searchTerm = (searchInput?.value || "").trim().toLowerCase();
  const paymentFilter = filterPaymentTypeInput?.value || "all";
  const statusFilter = filterStatusInput?.value || "all";

  return state.orders.filter((order) => {
    const paid = getOrderPaid(order);
    const remaining = Math.max(0, order.total - paid);

    const matchesSearch = !searchTerm
      || order.clientName.toLowerCase().includes(searchTerm)
      || (order.phone || "").toLowerCase().includes(searchTerm)
      || order.itemName.toLowerCase().includes(searchTerm);

    const matchesPayment = paymentFilter === "all" || order.paymentType === paymentFilter;
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "paid" && remaining === 0)
      || (statusFilter === "remaining" && remaining > 0);

    return matchesSearch && matchesPayment && matchesStatus;
  });
}

function showHistory(order) {
  const paid = getOrderPaid(order);
  const remaining = getRemaining(order);
  const paymentCount = (order.payments || []).length;

  historyClient.textContent = `${order.clientName} - ${order.itemName}`;
  historySummary.innerHTML = `
    <div class="stat-item"><span>Total</span><strong>${formatMoney(order.total)}</strong></div>
    <div class="stat-item"><span>Payé</span><strong>${formatMoney(paid)}</strong></div>
    <div class="stat-item"><span>Reste</span><strong>${formatMoney(remaining)}</strong></div>
    <div class="stat-item"><span>Versements</span><strong>${paymentCount}</strong></div>
  `;

  historyTableBody.innerHTML = "";
  const payments = [...(order.payments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (payments.length === 0) {
    historyTableBody.innerHTML = `<tr><td colspan="3">Aucun versement enregistré.</td></tr>`;
  } else {
    for (const payment of payments) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatDate(payment.date)}</td>
        <td>${formatMoney(Number(payment.amount || 0))}</td>
        <td>${escapeHtml(payment.note || "-")}</td>
      `;
      historyTableBody.appendChild(row);
    }
  }

  currentHistoryOrder = order;
  if (exportInvoiceBtn) {
    exportInvoiceBtn.disabled = false;
  }
  historyDialog.showModal();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toggleInitialPaymentVisibility() {
  const isCash = paymentTypeInput.value === "cash";
  if (isCash) {
    initialPaymentInput.value = "0";
    initialPaymentWrapper.style.display = "none";
  } else {
    initialPaymentWrapper.style.display = "flex";
  }
}

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const clientName = document.getElementById("clientName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const itemName = document.getElementById("itemName").value.trim();
  const quantity = Number(document.getElementById("quantity").value);
  const unitPrice = Number(document.getElementById("unitPrice").value);
  const paymentType = paymentTypeInput.value;
  const initialPayment = Number(initialPaymentInput.value || 0);

  if (!clientName || !itemName || quantity <= 0 || unitPrice < 0) {
    alert("Veuillez remplir correctement les champs obligatoires.");
    return;
  }

  const total = quantity * unitPrice;
  if (total <= 0) {
    alert("Le total de la commande doit être supérieur à 0.");
    return;
  }

  const createdAt = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(),
    clientName,
    phone,
    itemName,
    quantity,
    unitPrice,
    total,
    paymentType,
    createdAt,
    initialPayment
  };

  try {
    await apiCreateOrder(order);
    await refreshOrders();
    orderForm.reset();
    document.getElementById("quantity").value = "1";
    initialPaymentInput.value = "0";
    toggleInitialPaymentVisibility();
  } catch {
    alert("Impossible d'enregistrer la commande.");
  }
});

paymentTypeInput.addEventListener("change", toggleInitialPaymentVisibility);

ordersTableBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;

  if (action === "delete-order") {
    if (!confirm("Supprimer cette commande ?")) return;
    try {
      await apiDeleteOrder(id);
      await refreshOrders();
    } catch {
      alert("Suppression impossible.");
    }
    return;
  }

  if (action === "add-payment") {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;

    const remaining = getRemaining(order);
    if (remaining <= 0) return;

    state.selectedOrderId = id;
    dialogClient.textContent = `${order.clientName} - Reste: ${formatMoney(remaining)}`;
    paymentAmountInput.value = String(remaining);
    paymentAmountInput.max = String(remaining);
    paymentDateInput.value = getNowLocalInputValue();
    paymentDialog.showModal();
    return;
  }

  if (action === "show-history") {
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;
    showHistory(order);
  }
});

paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const amount = Number(paymentAmountInput.value);
  const selectedDate = paymentDateInput.value;
  if (amount <= 0) {
    alert("Le montant doit être supérieur à 0.");
    return;
  }
  if (!selectedDate) {
    alert("Veuillez choisir la date du versement.");
    return;
  }

  const order = state.orders.find((o) => o.id === state.selectedOrderId);
  if (!order) {
    paymentDialog.close();
    return;
  }

  const remaining = getRemaining(order);
  try {
    await apiAddPayment(order.id, {
      amount: Math.min(amount, remaining),
      date: new Date(selectedDate).toISOString(),
      note: "Versement tontine"
    });
    await refreshOrders();
    paymentDialog.close();
  } catch {
    alert("Impossible d'ajouter le versement.");
  }
});

cancelDialogBtn.addEventListener("click", () => {
  paymentDialog.close();
});

if (historyDialog) {
  historyDialog.addEventListener("close", () => {
    currentHistoryOrder = null;
    if (exportInvoiceBtn) {
      exportInvoiceBtn.disabled = true;
    }
  });
}

if (exportInvoiceBtn) {
  exportInvoiceBtn.addEventListener("click", () => {
    if (!currentHistoryOrder) return;
    downloadInvoice(currentHistoryOrder);
  });
}

clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Supprimer toutes les commandes enregistrées ?")) return;
  try {
    await apiDeleteAllOrders();
    await refreshOrders();
  } catch {
    alert("Suppression totale impossible.");
  }
});

if (searchInput) {
  searchInput.addEventListener("input", renderOrders);
}
if (filterPaymentTypeInput) {
  filterPaymentTypeInput.addEventListener("change", renderOrders);
}
if (filterStatusInput) {
  filterStatusInput.addEventListener("change", renderOrders);
}
if (chartPeriodInput) {
  chartPeriodInput.addEventListener("change", renderOrders);
}
if (exportRevenuePdfBtn) {
  exportRevenuePdfBtn.addEventListener("click", () => {
    const period = chartPeriodInput?.value || "day";
    const revenueRows = getRevenueByPeriod(getFilteredOrders(), period);
    const doc = createPdf("Recettes encaissees par periode");
    if (!doc) return;

    const rows = revenueRows.map((row) => [period, row.periodLabel, formatMoney(row.amount)]);
    doc.autoTable({
      head: [["Type periode", "Periode", "Montant encaisse"]],
      body: rows,
      startY: 26,
      styles: { fontSize: 9 }
    });
    doc.save("recettes_par_periode.pdf");
  });
}
if (exportOrdersPdfBtn) {
  exportOrdersPdfBtn.addEventListener("click", () => {
    const doc = createPdf("Commandes et versements");
    if (!doc) return;

    const rows = [];
    for (const order of state.orders) {
      const paid = getOrderPaid(order);
      const remaining = getRemaining(order);
      if ((order.payments || []).length === 0) {
        rows.push([
          order.clientName,
          order.phone || "",
          order.itemName,
          order.quantity,
          order.unitPrice,
          order.total,
          order.paymentType,
          formatDate(order.createdAt),
          "",
          "",
          "",
          formatMoney(paid),
          formatMoney(remaining)
        ]);
        continue;
      }

      for (const payment of order.payments) {
        rows.push([
          order.clientName,
          order.phone || "",
          order.itemName,
          order.quantity,
          order.unitPrice,
          order.total,
          order.paymentType,
          formatDate(order.createdAt),
          formatDate(payment.date),
          formatMoney(Number(payment.amount || 0)),
          payment.note || "",
          formatMoney(paid),
          formatMoney(remaining)
        ]);
      }
    }

    doc.autoTable({
      head: [[
        "Client",
        "Telephone",
        "Article",
        "Qte",
        "PU",
        "Total commande",
        "Type",
        "Date commande",
        "Date versement",
        "Montant versement",
        "Note",
        "Total paye",
        "Reste"
      ]],
      body: rows,
      startY: 26,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 118, 110] }
    });
    doc.save("commandes_et_versements.pdf");
  });
}

toggleInitialPaymentVisibility();
(async () => {
  try {
    await refreshOrders();
    if (state.orders.length === 0) {
      const imported = await migrateLegacyLocalStorageIfNeeded();
      if (imported) {
        await refreshOrders();
        alert("Importation terminee. Vos anciennes commandes sont maintenant en base.");
      }
    }
  } catch {
    alert("Connexion a la base de donnees impossible. Lancez le serveur Node.js.");
  }
})();
