const STORAGE_KEY = "danny-crm-pos-state-v2";
const SESSION_KEY = "danny-crm-session";
const API_URL = (window.APP_CONFIG?.API_URL || "").replace(/\/$/, "");

const initialState = {
  users: [
    { id: "u1", name: "Danny Admin", username: "admin", password: "admin123", role: "ADMIN" },
  ],
  products: [],
  customers: [],
  sales: [],
};

let state = loadState();
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
let activeView = "dashboard";
let cart = [];
let productQuery = "";
let modal = null;
let remoteSaveQueue = Promise.resolve();

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "VND" });

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(initialState);
  try {
    return JSON.parse(stored);
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!API_URL || !session?.token) return;

  const snapshot = structuredClone(state);
  remoteSaveQueue = remoteSaveQueue
    .catch(() => {})
    .then(() =>
      apiRequest("/api/state", {
        method: "PUT",
        body: JSON.stringify(snapshot),
      })
    )
    .catch((error) => {
      console.error("Remote save failed", error);
      alert("Online database sync failed. The change is still stored temporarily in this browser.");
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
  return new Intl.DateTimeFormat("en-US", {
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
  if (product.stock <= 0) return ["danger", "Out of stock"];
  if (product.stock <= product.minStock) return ["warn", "Low stock"];
  return ["ok", "In stock"];
}

function render() {
  if (!session) {
    renderLogin();
    return;
  }

  const navItems = [
    ["dashboard", "D", "Dashboard"],
    ["pos", "$", "POS"],
    ["inventory", "I", "Inventory"],
    ["customers", "C", "Customers"],
    ["reports", "R", "Reports"],
    ...(isAdmin() ? [["users", "U", "Users"]] : []),
  ];

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        ${brandLogo()}
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
          <button class="btn secondary" data-action="logout">Log out</button>
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
        ${brandLogo()}
        <div class="login-copy">
          <h1>Sales, CRM, and inventory control</h1>
          <p>A secure POS and CRM workspace for sales, customer records, role-based access, reporting, and encrypted online inventory data.</p>
        </div>
      </section>
      <section class="login-panel">
        <form class="login-card" data-form="login">
          <h2>Sign in</h2>
          <p>${API_URL ? "Sign in with the encrypted online database." : "Local mode is active until a backend URL is configured."}</p>
          <div class="field">
            <label for="username">Username</label>
            <input id="username" name="username" autocomplete="username" value="admin" required />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" value="admin123" required />
          </div>
          <button class="btn full" type="submit">Sign in</button>
          <div class="login-hints">
            <span><strong>ADMIN</strong>: admin / admin123</span>
            <span>Create staff users from the Users page.</span>
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
    ${topbar("Dashboard", "Overview of revenue, estimated profit, orders, and inventory alerts.")}
    ${statGrid(stats)}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Recent Orders</h2><button class="btn secondary" data-view="reports">View Reports</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Time</th><th>Staff</th><th>Total</th></tr></thead>
            <tbody>
              ${state.sales.length ? state.sales
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
                .join("") : `<tr><td colspan="4" class="empty">No orders yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Inventory Alerts</h2><button class="btn secondary" data-view="inventory">Review</button></div>
        <div class="panel-body">
          ${
            lowProducts.length
              ? lowProducts
                  .map((product) => {
                    const [type, label] = productStatus(product);
                    return `<div class="cart-item"><div><strong>${product.name}</strong><br><span class="badge ${type}">${label}</span></div><strong>${product.stock}/${product.minStock}</strong></div>`;
                  })
                  .join("")
              : `<div class="empty">No low-stock products.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function statGrid(stats) {
  return `
    <div class="stat-grid">
      <div class="stat"><span>Revenue</span><strong>${money.format(stats.revenue)}</strong></div>
      <div class="stat"><span>Estimated Profit</span><strong>${money.format(stats.profit)}</strong></div>
      <div class="stat"><span>Inventory Value</span><strong>${money.format(stats.inventoryValue)}</strong></div>
      <div class="stat"><span>Orders / Alerts</span><strong>${stats.orders} / ${stats.lowStock}</strong></div>
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
    ${topbar("POS Sales", "Create sales, reduce stock automatically, and save order history.", `<button class="btn secondary" data-action="clear-cart">Clear Cart</button>`)}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h2>Products</h2>
          <input class="field-input searchbar" data-input="product-search" placeholder="Search name, SKU, category..." value="${productQuery}" />
        </div>
        <div class="panel-body">
          <div class="product-grid">
            ${filtered.length ? filtered
              .map((product) => {
                const [type, label] = productStatus(product);
                return `
                  <button class="product-card" data-action="add-cart" data-id="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>
                    <h3>${product.name}</h3>
                    <p>${product.sku} - ${product.category}</p>
                    <strong>${money.format(product.price)}</strong>
                    <span class="badge ${type}">${label}: ${product.stock}</span>
                  </button>
                `;
              })
              .join("") : `<div class="empty">No products yet. Add products in Inventory.</div>`}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Cart</h2><span class="badge">${cart.length} lines</span></div>
        <div class="panel-body">
          <div class="field">
            <label>Customer</label>
            <select data-input="cart-customer">
              <option value="">Walk-in customer</option>
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
                            <button class="icon-btn" data-action="dec-cart" data-id="${item.productId}" title="Decrease">-</button>
                            <strong>${item.qty}</strong>
                            <button class="icon-btn" data-action="inc-cart" data-id="${item.productId}" title="Increase">+</button>
                          </div>
                        </div>
                      `
                    )
                    .join("")
                : `<div class="empty">No items in cart.</div>`
            }
          </div>
          <div class="totals">
            <div class="field">
              <label>Discount</label>
              <input data-input="discount" type="number" min="0" value="0" />
            </div>
            <div class="total-row"><span>Subtotal</span><strong>${money.format(subtotal)}</strong></div>
            <div class="total-row grand"><span>Payment Due</span><strong data-total="${subtotal}">${money.format(subtotal)}</strong></div>
            <button class="btn full" data-action="checkout" ${cart.length ? "" : "disabled"}>Checkout</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderInventory() {
  return `
    ${topbar(
      "Inventory Control",
      "Manage products, prices, cost, alert levels, and stock quantity.",
      isAdmin() ? `<button class="btn" data-action="open-product">Add Product</button>` : ""
    )}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Alert</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${state.products.length ? state.products
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
                      <button class="btn secondary" data-action="adjust-stock" data-id="${product.id}">Adjust</button>
                      ${isAdmin() ? `<button class="btn secondary" data-action="edit-product" data-id="${product.id}">Edit</button>` : ""}
                    </td>
                  </tr>
                `;
              })
              .join("") : `<tr><td colspan="8" class="empty">No products yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCustomers() {
  return `
    ${topbar("Customers", "Store customer contact details, notes, and lifetime spend.", `<button class="btn" data-action="open-customer">Add Customer</button>`)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Spent</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${state.customers.length ? state.customers
              .map(
                (customer) => `
                  <tr>
                    <td><strong>${customer.name}</strong></td>
                    <td>${customer.phone || "-"}</td>
                    <td>${customer.email || "-"}</td>
                    <td>${money.format(customer.spent || 0)}</td>
                    <td>${customer.note || "-"}</td>
                    <td><button class="btn secondary" data-action="edit-customer" data-id="${customer.id}">Edit</button></td>
                  </tr>
                `
              )
              .join("") : `<tr><td colspan="6" class="empty">No customers yet.</td></tr>`}
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
    ${topbar("Reports", "Track revenue by product and review order history.")}
    ${statGrid(getStats())}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Revenue by Product</h2></div>
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
              : `<div class="empty">No sales data yet.</div>`
          }
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Order History</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Time</th><th>Total</th></tr></thead>
            <tbody>
              ${state.sales.length ? state.sales
                .slice()
                .reverse()
                .map((sale) => `<tr><td>${sale.code}</td><td>${fmtDate(sale.createdAt)}</td><td>${money.format(sale.total)}</td></tr>`)
                .join("") : `<tr><td colspan="3" class="empty">No orders yet.</td></tr>`}
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
    ${topbar("Users and Roles", "ADMIN has full access. STAFF can sell, view customers, and update stock.", `<button class="btn" data-action="open-user">Add User</button>`)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead>
          <tbody>
            ${state.users
              .map(
                (user) => `
                  <tr>
                    <td><strong>${user.name}</strong></td>
                    <td>${user.username}</td>
                    <td><span class="badge ${user.role === "ADMIN" ? "ok" : ""}">${user.role}</span></td>
                    <td><button class="btn secondary" data-action="edit-user" data-id="${user.id}">Edit</button></td>
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

function brandLogo() {
  return `
    <div class="brand-mark">
      <img class="brand-logo" src="assets/logo.svg" alt="Danny CRM POS logo" />
      <span>Danny CRM POS</span>
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
        <div class="panel-head"><h2>${product.id ? "Edit Product" : "Add Product"}</h2><button class="btn ghost" data-action="close-modal" type="button">Close</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", product.id)}
          ${field("sku", "SKU", product.sku || "", "text", true)}
          ${field("name", "Product Name", product.name || "", "text", true)}
          ${field("category", "Category", product.category || "", "text", true)}
          ${field("price", "Sale Price", product.price || 0, "number", true)}
          ${field("cost", "Cost", product.cost || 0, "number", true)}
          ${field("stock", "Stock Quantity", product.stock || 0, "number", true)}
          ${field("minStock", "Low Stock Alert", product.minStock || 0, "number", true)}
          <button class="btn full" type="submit">Save Product</button>
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
        <div class="panel-head"><h2>Adjust Stock</h2><button class="btn ghost" data-action="close-modal" type="button">Close</button></div>
        <div class="panel-body">
          ${hidden("id", product.id)}
          <p><strong>${product.name}</strong> currently has <strong>${product.stock}</strong> units in stock.</p>
          <div class="form-grid">
            <div class="field">
              <label>Adjustment Type</label>
              <select name="mode"><option value="in">Stock In</option><option value="out">Stock Out / Waste</option><option value="set">Set Stock</option></select>
            </div>
            ${field("amount", "Quantity", 1, "number", true)}
          </div>
          <button class="btn" type="submit">Update Stock</button>
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
        <div class="panel-head"><h2>${customer.id ? "Edit Customer" : "Add Customer"}</h2><button class="btn ghost" data-action="close-modal" type="button">Close</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", customer.id)}
          ${field("name", "Customer Name", customer.name || "", "text", true)}
          ${field("phone", "Phone", customer.phone || "")}
          ${field("email", "Email", customer.email || "", "email")}
          ${field("spent", "Lifetime Spend", customer.spent || 0, "number")}
          <div class="field" style="grid-column:1/-1"><label>Note</label><textarea name="note">${customer.note || ""}</textarea></div>
          <button class="btn full" type="submit">Save Customer</button>
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
        <div class="panel-head"><h2>${user.id ? "Edit User" : "Add User"}</h2><button class="btn ghost" data-action="close-modal" type="button">Close</button></div>
        <div class="panel-body form-grid">
          ${hidden("id", user.id)}
          ${field("name", "Full Name", user.name || "", "text", true)}
          ${field("username", "Username", user.username || "", "text", true)}
          ${field("password", "Password", user.password || "", "text", true)}
          <div class="field">
            <label>Role</label>
            <select name="role"><option value="STAFF" ${user.role === "STAFF" ? "selected" : ""}>STAFF</option><option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>ADMIN</option></select>
          </div>
          <button class="btn full" type="submit">Save User</button>
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
        alert("Invalid username, invalid password, or the backend is unavailable.");
      }
      return;
    }

    const user = state.users.find((item) => item.username === data.username && item.password === data.password);
    if (!user) {
      alert("Invalid username or password.");
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
      alert(`Not enough stock for ${item.name}.`);
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
