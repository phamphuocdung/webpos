const STORAGE_KEY = "danny-crm-pos-state-v1";
const SESSION_KEY = "danny-crm-session";
const API_URL = (window.APP_CONFIG?.API_URL || "").replace(/\/$/, "");

const demoState = {
  users: [
    { id: "u1", name: "Danny Admin", username: "admin", password: "admin123", role: "ADMIN" },
    { id: "u2", name: "Nhan vien POS", username: "staff", password: "staff123", role: "STAFF" },
  ],
  products: [
    { id: "p1", sku: "CF-001", name: "Ca phe sua", category: "Do uong", price: 28000, cost: 14000, stock: 42, minStock: 12 },
    { id: "p2", sku: "TE-002", name: "Tra dao", category: "Do uong", price: 32000, cost: 15000, stock: 25, minStock: 10 },
    { id: "p3", sku: "BK-101", name: "Banh mi bo", category: "Do an", price: 38000, cost: 21000, stock: 18, minStock: 8 },
    { id: "p4", sku: "SN-040", name: "Snack rong bien", category: "An vat", price: 18000, cost: 9000, stock: 7, minStock: 10 },
    { id: "p5", sku: "MT-016", name: "Matcha latte", category: "Do uong", price: 45000, cost: 22000, stock: 16, minStock: 6 },
    { id: "p6", sku: "CK-022", name: "Cookie hat dieu", category: "An vat", price: 22000, cost: 10000, stock: 31, minStock: 10 },
  ],
  customers: [
    { id: "c1", name: "Khach le", phone: "", email: "", note: "Default walk-in customer", spent: 0 },
    { id: "c2", name: "Minh Anh", phone: "0901234567", email: "minh@example.com", note: "Thich tra dao", spent: 128000 },
    { id: "c3", name: "Hoang Nam", phone: "0918882222", email: "nam@example.com", note: "Mua buoi sang", spent: 236000 },
  ],
  sales: [
    {
      id: "s1",
      code: "HD-1001",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      userName: "Danny Admin",
      customerId: "c2",
      subtotal: 88000,
      discount: 0,
      total: 88000,
      items: [
        { productId: "p1", name: "Ca phe sua", qty: 2, price: 28000, cost: 14000 },
        { productId: "p6", name: "Cookie hat dieu", qty: 1, price: 22000, cost: 10000 },
      ],
    },
    {
      id: "s2",
      code: "HD-1002",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      userName: "Nhan vien POS",
      customerId: "c3",
      subtotal: 115000,
      discount: 5000,
      total: 110000,
      items: [
        { productId: "p5", name: "Matcha latte", qty: 1, price: 45000, cost: 22000 },
        { productId: "p3", name: "Banh mi bo", qty: 1, price: 38000, cost: 21000 },
        { productId: "p2", name: "Tra dao", qty: 1, price: 32000, cost: 15000 },
      ],
    },
  ],
};

let state = loadState();
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
let activeView = "dashboard";
let cart = [];
let productQuery = "";
let modal = null;

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" });

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(demoState);
  try {
    return JSON.parse(stored);
  } catch {
    return structuredClone(demoState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!API_URL || !session?.token) return;

  apiRequest("/api/state", {
    method: "PUT",
    body: JSON.stringify(state),
  }).catch((error) => {
    console.error("Remote save failed", error);
    alert("Khong dong bo duoc DB online. Du lieu hien van duoc luu tam tren trinh duyet.");
  });
}

function setSession(user, token = session?.token) {
  session = user ? { id: user.id, name: user.name, role: user.role, token } : null;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  render();
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (options.auth !== false && session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "API_ERROR");
  return data;
}

async function loadRemoteState() {
  if (!API_URL || !session?.token) return;
  state = await apiRequest("/api/state");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isAdmin() {
  return session?.role === "ADMIN";
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fmtDate(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getStats() {
  const revenue = state.sales.reduce((sum, sale) => sum + sale.total, 0);
  const cost = state.sales.reduce(
    (sum, sale) => sum + sale.items.reduce((lineSum, item) => lineSum + item.cost * item.qty, 0),
    0
  );
  const inventoryValue = state.products.reduce((sum, product) => sum + product.cost * product.stock, 0);
  const lowStock = state.products.filter((product) => product.stock <= product.minStock).length;
  return { revenue, profit: revenue - cost, inventoryValue, lowStock, orders: state.sales.length };
}

function productStatus(product) {
  if (product.stock <= 0) return ["danger", "Het hang"];
  if (product.stock <= product.minStock) return ["warn", "Sap het"];
  return ["ok", "Con hang"];
}

function render() {
  if (!session) {
    renderLogin();
    return;
  }

  const navItems = [
    ["dashboard", "▦", "Thong ke"],
    ["pos", "+", "Ban hang"],
    ["inventory", "□", "Ton kho"],
    ["customers", "◎", "Khach hang"],
    ["reports", "≡", "Bao cao"],
    ...(isAdmin() ? [["users", "♙", "Nhan su"]] : []),
  ];

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-mark"><span class="brand-icon">D</span><span>Danny CRM POS</span></div>
        <nav class="nav">
          ${navItems
            .map(
              ([id, icon, label]) => `
                <button class="${activeView === id ? "active" : ""}" data-view="${id}" title="${label}">
                  <span>${icon}</span><span>${label}</span>
                </button>
              `
            )
            .join("")}
        </nav>
        <div class="sidebar-footer">
          <div class="user-pill">
            <strong>${session.name}</strong>
            <span>${session.role}</span>
          </div>
          <button class="btn secondary" data-action="logout">Dang xuat</button>
        </div>
      </aside>
      <main class="main">${renderView()}</main>
    </div>
    ${modal ? renderModal() : ""}
  `;

  bindEvents();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-shell">
      <section class="login-visual">
        <div class="brand-mark"><span class="brand-icon">D</span><span>Danny CRM POS</span></div>
        <div class="login-copy">
          <h1>Quan ly ban hang va ton kho</h1>
          <p>Mot web app cho POS, CRM, phan quyen nhan vien, thong ke doanh thu va kiem soat ton kho theo thoi gian thuc tren trinh duyet.</p>
        </div>
      </section>
      <section class="login-panel">
        <form class="login-card" data-form="login">
          <h2>Dang nhap</h2>
          <p>${API_URL ? "Dang nhap qua DB online da ma hoa." : "Chon tai khoan demo de vao he thong."}</p>
          <div class="field">
            <label for="username">Tai khoan</label>
            <input id="username" name="username" autocomplete="username" value="admin" required />
          </div>
          <div class="field">
            <label for="password">Mat khau</label>
            <input id="password" name="password" type="password" autocomplete="current-password" value="admin123" required />
          </div>
          <button class="btn full" type="submit">Dang nhap</button>
          <div class="demo-users">
            <span><strong>ADMIN</strong>: admin / admin123</span>
            <span><strong>STAFF</strong>: staff / staff123</span>
          </div>
        </form>
      </section>
    </div>
  `;
  bindEvents();
}

function renderView() {
  if (activeView === "pos") return renderPos();
  if (activeView === "inventory") return renderInventory();
  if (activeView === "customers") return renderCustomers();
  if (activeView === "reports") return renderReports();
  if (activeView === "users") return renderUsers();
  return renderDashboard();
}

function renderDashboard() {
  const stats = getStats();
  const lowProducts = state.products.filter((product) => product.stock <= product.minStock);
  return `
    ${topbar("Thong ke", "Tong quan doanh thu, loi nhuan, don hang va canh bao ton kho.")}
    ${statGrid(stats)}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Don hang gan day</h2><button class="btn secondary" data-view="reports">Xem bao cao</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ma</th><th>Thoi gian</th><th>Nhan vien</th><th>Tong tien</th></tr></thead>
            <tbody>
              ${state.sales
                .slice()
                .reverse()
                .slice(0, 6)
                .map(
                  (sale) => `
                    <tr>
                      <td><strong>${sale.code}</strong></td>
                      <td>${fmtDate(sale.createdAt)}</td>
                      <td>${sale.userName}</td>
                      <td>${money.format(sale.total)}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Canh bao ton kho</h2><button class="btn secondary" data-view="inventory">Xu ly</button></div>
        <div class="panel-body">
          ${
            lowProducts.length
              ? lowProducts
                  .map((product) => {
                    const [type, label] = productStatus(product);
                    return `<div class="cart-item"><div><strong>${product.name}</strong><br><span class="badge ${type}">${label}</span></div><strong>${product.stock}/${product.minStock}</strong></div>`;
                  })
                  .join("")
              : `<div class="empty">Khong co san pham sap het hang.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function statGrid(stats) {
  return `
    <div class="stat-grid">
      <div class="stat"><span>Doanh thu</span><strong>${money.format(stats.revenue)}</strong></div>
      <div class="stat"><span>Loi nhuan uoc tinh</span><strong>${money.format(stats.profit)}</strong></div>
      <div class="stat"><span>Gia tri ton kho</span><strong>${money.format(stats.inventoryValue)}</strong></div>
      <div class="stat"><span>Don hang / Canh bao</span><strong>${stats.orders} / ${stats.lowStock}</strong></div>
    </div>
  `;
}

function renderPos() {
  const filtered = state.products.filter((product) => {
    const needle = `${product.name} ${product.sku} ${product.category}`.toLowerCase();
    return needle.includes(productQuery.toLowerCase());
  });
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  return `
    ${topbar("Ban hang POS", "Tao don hang, tru ton kho tu dong va luu lich su ban hang.", `<button class="btn secondary" data-action="clear-cart">Xoa gio</button>`)}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h2>San pham</h2>
          <input class="field-input searchbar" data-input="product-search" placeholder="Tim ten, SKU, danh muc..." value="${productQuery}" />
        </div>
        <div class="panel-body">
          <div class="product-grid">
            ${filtered
              .map((product) => {
                const [type, label] = productStatus(product);
                return `
                  <button class="product-card" data-action="add-cart" data-id="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>
                    <h3>${product.name}</h3>
                    <p>${product.sku} · ${product.category}</p>
                    <strong>${money.format(product.price)}</strong>
                    <span class="badge ${type}">${label}: ${product.stock}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Gio hang</h2><span class="badge">${cart.length} dong</span></div>
        <div class="panel-body">
          <div class="field">
            <label>Khach hang</label>
            <select data-input="cart-customer">
              ${state.customers.map((customer) => `<option value="${customer.id}">${customer.name}</option>`).join("")}
            </select>
          </div>
          <div class="cart-list">
            ${
              cart.length
                ? cart
                    .map(
                      (item) => `
                        <div class="cart-item">
                          <div>
                            <strong>${item.name}</strong><br>
                            <span>${money.format(item.price)} x ${item.qty}</span>
                          </div>
                          <div class="qty-controls">
                            <button class="icon-btn" data-action="dec-cart" data-id="${item.productId}" title="Giam">-</button>
                            <strong>${item.qty}</strong>
                            <button class="icon-btn" data-action="inc-cart" data-id="${item.productId}" title="Tang">+</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="empty">Chua co san pham trong gio.</div>`
            }
          </div>
          <div class="totals">
            <div class="field">
              <label>Giam gia</label>
              <input data-input="discount" type="number" min="0" value="0" />
            </div>
            <div class="total-row"><span>Tam tinh</span><strong>${money.format(subtotal)}</strong></div>
            <div class="total-row grand"><span>Thanh toan</span><strong data-total="${subtotal}">${money.format(subtotal)}</strong></div>
            <button class="btn full" data-action="checkout" ${cart.length ? "" : "disabled"}>Thanh toan</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderInventory() {
  return `
    ${topbar(
      "Kiem soat ton kho",
      "Quan ly san pham, gia ban, gia von, muc canh bao va so luong ton.",
      isAdmin() ? `<button class="btn" data-action="open-product">Them san pham</button>` : ""
    )}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>San pham</th><th>Danh muc</th><th>Gia ban</th><th>Ton</th><th>Canh bao</th><th>Trang thai</th><th></th></tr></thead>
          <tbody>
            ${state.products
              .map((product) => {
                const [type, label] = productStatus(product);
                return `
                  <tr>
                    <td>${product.sku}</td>
                    <td><strong>${product.name}</strong></td>
                    <td>${product.category}</td>
                    <td>${money.format(product.price)}</td>
                    <td>${product.stock}</td>
                    <td>${product.minStock}</td>
                    <td><span class="badge ${type}">${label}</span></td>
                    <td class="toolbar">
                      <button class="btn secondary" data-action="adjust-stock" data-id="${product.id}">Nhap/Xuat</button>
                      ${isAdmin() ? `<button class="btn secondary" data-action="edit-product" data-id="${product.id}">Sua</button>` : ""}
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCustomers() {
  return `
    ${topbar("CRM khach hang", "Luu thong tin khach hang, ghi chu va tong chi tieu.", `<button class="btn" data-action="open-customer">Them khach hang</button>`)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ten</th><th>Dien thoai</th><th>Email</th><th>Da mua</th><th>Ghi chu</th><th></th></tr></thead>
          <tbody>
            ${state.customers
              .map(
                (customer) => `
                  <tr>
                    <td><strong>${customer.name}</strong></td>
                    <td>${customer.phone || "-"}</td>
                    <td>${customer.email || "-"}</td>
                    <td>${money.format(customer.spent || 0)}</td>
                    <td>${customer.note || "-"}</td>
                    <td><button class="btn secondary" data-action="edit-customer" data-id="${customer.id}">Sua</button></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReports() {
  const byProduct = {};
  state.sales.forEach((sale) => {
    sale.items.forEach((item) => {
      byProduct[item.name] = (byProduct[item.name] || 0) + item.qty * item.price;
    });
  });
  const rows = Object.entries(byProduct).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  return `
    ${topbar("Bao cao", "Theo doi doanh thu theo san pham va lich su don hang.")}
    ${statGrid(getStats())}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Doanh thu theo san pham</h2></div>
        <div class="panel-body chart">
          ${
            rows.length
              ? rows
                  .map(
                    ([name, value]) => `
                      <div class="bar-row">
                        <span>${name}</span>
                        <div class="bar"><span style="width:${Math.max(8, (value / max) * 100)}%"></span></div>
                        <strong>${money.format(value)}</strong>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty">Chua co du lieu ban hang.</div>`
          }
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Lich su don hang</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ma</th><th>Thoi gian</th><th>Tong</th></tr></thead>
            <tbody>
              ${state.sales
                .slice()
                .reverse()
                .map((sale) => `<tr><td>${sale.code}</td><td>${fmtDate(sale.createdAt)}</td><td>${money.format(sale.total)}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderUsers() {
  if (!isAdmin()) return renderDashboard();
  return `
    ${topbar("Nhan su va phan quyen", "ADMIN co toan quyen; STAFF ban hang, xem khach hang va cap nhat ton kho.", `<button class="btn" data-action="open-user">Them nhan su</button>`)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ten</th><th>Tai khoan</th><th>Vai tro</th><th></th></tr></thead>
          <tbody>
            ${state.users
              .map(
                (user) => `
                  <tr>
                    <td><strong>${user.name}</strong></td>
                    <td>${user.username}</td>
                    <td><span class="badge ${user.role === "ADMIN" ? "ok" : ""}">${user.role}</span></td>
                    <td><button class="btn secondary" data-action="edit-user" data-id="${user.id}">Sua</button></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function topbar(title, subtitle, actions = "") {
  return `
    <div class="topbar">
      <div><h1>${title}</h1><p>${subtitle}</p></div>
      <div class="toolbar">${actions}</div>
    </div>
  `;
}

function renderModal() {
  if (modal.type === "product") return productModal();
  if (modal.type === "stock") return stockModal();
  if (modal.type === "customer") return customerModal();
  if (modal.type === "user") return userModal();
  return "";
}

function productModal() {
  const product = modal.id ? state.products.find((item) => item.id === modal.id) : {};
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="product">
        <div class="panel-head"><h2>${product.id ? "Sua san pham" : "Them san pham"}</h2><button class="btn ghost" data-action="close-modal" type="button">Dong</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", product.id)}
          ${field("sku", "SKU", product.sku || "", "text", true)}
          ${field("name", "Ten san pham", product.name || "", "text", true)}
          ${field("category", "Danh muc", product.category || "", "text", true)}
          ${field("price", "Gia ban", product.price || 0, "number", true)}
          ${field("cost", "Gia von", product.cost || 0, "number", true)}
          ${field("stock", "So luong ton", product.stock || 0, "number", true)}
          ${field("minStock", "Muc canh bao", product.minStock || 0, "number", true)}
          <button class="btn full" type="submit">Luu san pham</button>
        </div>
      </form>
    </div>
  `;
}

function stockModal() {
  const product = state.products.find((item) => item.id === modal.id);
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="stock">
        <div class="panel-head"><h2>Nhap/Xuat ton kho</h2><button class="btn ghost" data-action="close-modal" type="button">Dong</button></div>
        <div class="panel-body">
          ${hidden("id", product.id)}
          <p><strong>${product.name}</strong> dang ton <strong>${product.stock}</strong> san pham.</p>
          <div class="form-grid">
            <div class="field">
              <label>Loai dieu chinh</label>
              <select name="mode"><option value="in">Nhap hang</option><option value="out">Xuat/huy hang</option><option value="set">Dat lai so ton</option></select>
            </div>
            ${field("amount", "So luong", 1, "number", true)}
          </div>
          <button class="btn" type="submit">Cap nhat ton kho</button>
        </div>
      </form>
    </div>
  `;
}

function customerModal() {
  const customer = modal.id ? state.customers.find((item) => item.id === modal.id) : {};
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="customer">
        <div class="panel-head"><h2>${customer.id ? "Sua khach hang" : "Them khach hang"}</h2><button class="btn ghost" data-action="close-modal" type="button">Dong</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", customer.id)}
          ${field("name", "Ten khach hang", customer.name || "", "text", true)}
          ${field("phone", "Dien thoai", customer.phone || "")}
          ${field("email", "Email", customer.email || "", "email")}
          ${field("spent", "Da mua", customer.spent || 0, "number")}
          <div class="field" style="grid-column:1/-1"><label>Ghi chu</label><textarea name="note">${customer.note || ""}</textarea></div>
          <button class="btn full" type="submit">Luu khach hang</button>
        </div>
      </form>
    </div>
  `;
}

function userModal() {
  const user = modal.id ? state.users.find((item) => item.id === modal.id) : {};
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="user">
        <div class="panel-head"><h2>${user.id ? "Sua nhan su" : "Them nhan su"}</h2><button class="btn ghost" data-action="close-modal" type="button">Dong</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", user.id)}
          ${field("name", "Ho ten", user.name || "", "text", true)}
          ${field("username", "Tai khoan", user.username || "", "text", true)}
          ${field("password", "Mat khau", user.password || "", "text", true)}
          <div class="field">
            <label>Vai tro</label>
            <select name="role"><option value="STAFF" ${user.role === "STAFF" ? "selected" : ""}>STAFF</option><option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>ADMIN</option></select>
          </div>
          <button class="btn full" type="submit">Luu nhan su</button>
        </div>
      </form>
    </div>
  `;
}

function field(name, label, value = "", type = "text", required = false) {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${value}" ${required ? "required" : ""} /></div>`;
}

function hidden(name, value = "") {
  return `<input type="hidden" name="${name}" value="${value || ""}" />`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === "logout") setSession(null);
      if (action === "clear-cart") {
        cart = [];
        render();
      }
      if (action === "add-cart") addToCart(id);
      if (action === "inc-cart") changeCartQty(id, 1);
      if (action === "dec-cart") changeCartQty(id, -1);
      if (action === "checkout") checkout();
      if (action === "open-product") {
        modal = { type: "product" };
        render();
      }
      if (action === "edit-product") {
        modal = { type: "product", id };
        render();
      }
      if (action === "adjust-stock") {
        modal = { type: "stock", id };
        render();
      }
      if (action === "open-customer") {
        modal = { type: "customer" };
        render();
      }
      if (action === "edit-customer") {
        modal = { type: "customer", id };
        render();
      }
      if (action === "open-user") {
        modal = { type: "user" };
        render();
      }
      if (action === "edit-user") {
        modal = { type: "user", id };
        render();
      }
      if (action === "close-modal") {
        event.preventDefault();
        modal = null;
        render();
      }
    });
  });

  document.querySelector('[data-form="login"]')?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));

    if (API_URL) {
      try {
        const result = await apiRequest("/api/login", {
          method: "POST",
          body: JSON.stringify(data),
          auth: false,
        });
        session = { ...result.user, token: result.token };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        await loadRemoteState();
        activeView = "dashboard";
        render();
      } catch {
        alert("Sai tai khoan, mat khau, hoac backend khong truy cap duoc.");
      }
      return;
    }

    const user = state.users.find((item) => item.username === data.username && item.password === data.password);
    if (!user) {
      alert("Sai tai khoan hoac mat khau.");
      return;
    }
    setSession(user);
  });

  document.querySelector('[data-input="product-search"]')?.addEventListener("input", (event) => {
    productQuery = event.target.value;
    render();
    const search = document.querySelector('[data-input="product-search"]');
    search?.focus();
    search?.setSelectionRange(productQuery.length, productQuery.length);
  });

  document.querySelector('[data-input="discount"]')?.addEventListener("input", (event) => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discount = Math.max(0, Number(event.target.value || 0));
    const total = Math.max(0, subtotal - discount);
    document.querySelector("[data-total]").textContent = money.format(total);
  });

  document.querySelector('[data-form="product"]')?.addEventListener("submit", saveProduct);
  document.querySelector('[data-form="stock"]')?.addEventListener("submit", saveStock);
  document.querySelector('[data-form="customer"]')?.addEventListener("submit", saveCustomer);
  document.querySelector('[data-form="user"]')?.addEventListener("submit", saveUser);
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  const existing = cart.find((item) => item.productId === productId);
  const currentQty = existing?.qty || 0;
  if (!product || product.stock <= currentQty) return;
  if (existing) existing.qty += 1;
  else cart.push({ productId, name: product.name, price: product.price, cost: product.cost, qty: 1 });
  render();
}

function changeCartQty(productId, delta) {
  const item = cart.find((entry) => entry.productId === productId);
  const product = state.products.find((entry) => entry.id === productId);
  if (!item || !product) return;
  item.qty += delta;
  if (item.qty > product.stock) item.qty = product.stock;
  if (item.qty <= 0) cart = cart.filter((entry) => entry.productId !== productId);
  render();
}

function checkout() {
  if (!cart.length) return;
  const customerId = document.querySelector('[data-input="cart-customer"]').value;
  const discount = Math.max(0, Number(document.querySelector('[data-input="discount"]').value || 0));
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const sale = {
    id: uid("sale"),
    code: `HD-${1000 + state.sales.length + 1}`,
    createdAt: new Date().toISOString(),
    userName: session.name,
    customerId,
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount),
    items: structuredClone(cart),
  };

  for (const item of cart) {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product || product.stock < item.qty) {
      alert(`Khong du ton kho cho ${item.name}.`);
      return;
    }
  }

  cart.forEach((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    product.stock -= item.qty;
  });

  const customer = state.customers.find((entry) => entry.id === customerId);
  if (customer) customer.spent = Number(customer.spent || 0) + sale.total;

  state.sales.push(sale);
  cart = [];
  saveState();
  activeView = "reports";
  render();
}

function saveProduct(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const product = {
    id: data.id || uid("product"),
    sku: data.sku.trim(),
    name: data.name.trim(),
    category: data.category.trim(),
    price: Number(data.price || 0),
    cost: Number(data.cost || 0),
    stock: Number(data.stock || 0),
    minStock: Number(data.minStock || 0),
  };
  const index = state.products.findIndex((item) => item.id === product.id);
  if (index >= 0) state.products[index] = product;
  else state.products.push(product);
  modal = null;
  saveState();
  render();
}

function saveStock(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const product = state.products.find((item) => item.id === data.id);
  const amount = Math.max(0, Number(data.amount || 0));
  if (!product) return;
  if (data.mode === "in") product.stock += amount;
  if (data.mode === "out") product.stock = Math.max(0, product.stock - amount);
  if (data.mode === "set") product.stock = amount;
  modal = null;
  saveState();
  render();
}

function saveCustomer(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const customer = {
    id: data.id || uid("customer"),
    name: data.name.trim(),
    phone: data.phone.trim(),
    email: data.email.trim(),
    note: data.note.trim(),
    spent: Number(data.spent || 0),
  };
  const index = state.customers.findIndex((item) => item.id === customer.id);
  if (index >= 0) state.customers[index] = customer;
  else state.customers.push(customer);
  modal = null;
  saveState();
  render();
}

function saveUser(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const user = {
    id: data.id || uid("user"),
    name: data.name.trim(),
    username: data.username.trim(),
    password: data.password,
    role: data.role,
  };
  const index = state.users.findIndex((item) => item.id === user.id);
  if (index >= 0) state.users[index] = user;
  else state.users.push(user);
  modal = null;
  saveState();
  render();
}

async function boot() {
  render();
  if (!API_URL || !session?.token) return;

  try {
    await loadRemoteState();
    render();
  } catch {
    setSession(null);
  }
}

boot();
