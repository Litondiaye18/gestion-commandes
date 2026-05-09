const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let sqliteDb = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
  });
  console.log("Mode base de donnees : PostgreSQL");
} else if (process.env.NODE_ENV === "production") {
  console.error("Erreur : DATABASE_URL manquante en production. Impossible de demarrer sans base PostgreSQL.");
  process.exit(1);
} else {
  const sqlite3 = require("sqlite3").verbose();
  const DB_PATH = path.join(__dirname, "database.sqlite");
  sqliteDb = new sqlite3.Database(DB_PATH);
  console.log("Aucune DATABASE_URL : utilisation de SQLite locale.");
}

function run(sql, params = []) {
  if (pool) {
    return pool.query(sql, params);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  if (pool) {
    return pool.query(sql, params).then(result => result.rows);
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      phone TEXT,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      payment_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id ${pool ? "SERIAL" : "INTEGER PRIMARY KEY AUTOINCREMENT"},
      order_id TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);
}

function buildOrders(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.order_id)) {
      byId.set(row.order_id, {
        id: row.order_id,
        clientName: row.client_name,
        phone: row.phone || "",
        itemName: row.item_name,
        quantity: row.quantity,
        unitPrice: row.unit_price,
        total: row.total,
        paymentType: row.payment_type,
        createdAt: row.created_at,
        payments: []
      });
    }

    if (row.payment_id) {
      byId.get(row.order_id).payments.push({
        id: row.payment_id,
        amount: row.payment_amount,
        date: row.payment_date,
        note: row.payment_note || ""
      });
    }
  }
  return [...byId.values()];
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/orders", async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        o.id AS order_id,
        o.client_name,
        o.phone,
        o.item_name,
        o.quantity,
        o.unit_price,
        o.total,
        o.payment_type,
        o.created_at,
        p.id AS payment_id,
        p.amount AS payment_amount,
        p.date AS payment_date,
        p.note AS payment_note
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC, p.date DESC
    `);
    res.json(buildOrders(rows));
  } catch (error) {
    res.status(500).json({ message: "Erreur lecture commandes." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      id,
      clientName,
      phone,
      itemName,
      quantity,
      unitPrice,
      total,
      paymentType,
      createdAt,
      initialPayment = 0
    } = req.body;

    await run(
      `INSERT INTO orders (id, client_name, phone, item_name, quantity, unit_price, total, payment_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, clientName, phone || "", itemName, quantity, unitPrice, total, paymentType, createdAt]
    );

    if (paymentType === "cash") {
      await run(
        "INSERT INTO payments (order_id, amount, date, note) VALUES ($1, $2, $3, $4)",
        [id, total, createdAt, "Paiement cash unique"]
      );
    } else if (Number(initialPayment) > 0) {
      await run(
        "INSERT INTO payments (order_id, amount, date, note) VALUES ($1, $2, $3, $4)",
        [id, Math.min(total, Number(initialPayment)), createdAt, "Versement initial"]
      );
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erreur creation commande." });
  }
});

app.post("/api/orders/:id/payments", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, date, note } = req.body;
    await run(
      "INSERT INTO payments (order_id, amount, date, note) VALUES ($1, $2, $3, $4)",
      [id, Number(amount), date, note || "Versement tontine"]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erreur ajout versement." });
  }
});

app.post("/api/import", async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ message: "Format invalide." });
    }

    for (const order of orders) {
      const orderId = order.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await run(
        `INSERT INTO orders (id, client_name, phone, item_name, quantity, unit_price, total, payment_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          orderId,
          order.clientName || "Client",
          order.phone || "",
          order.itemName || "Article",
          Number(order.quantity || 0),
          Number(order.unitPrice || 0),
          Number(order.total || 0),
          order.paymentType || "tontine",
          order.createdAt || new Date().toISOString()
        ]
      );

      for (const payment of order.payments || []) {
        await run(
          "INSERT INTO payments (order_id, amount, date, note) VALUES ($1, $2, $3, $4)",
          [
            orderId,
            Number(payment.amount || 0),
            payment.date || new Date().toISOString(),
            payment.note || ""
          ]
        );
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erreur importation." });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await run("DELETE FROM payments WHERE order_id = $1", [id]);
    await run("DELETE FROM orders WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erreur suppression commande." });
  }
});

app.delete("/api/orders", async (req, res) => {
  try {
    await run("DELETE FROM payments");
    await run("DELETE FROM orders");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Erreur suppression commandes." });
  }
});

// Route pour les produits (nécessaire pour le site e-commerce)
app.get("/api/products", async (req, res) => {
  try {
    // Produits par défaut pour la démonstration
    const products = [
      {id:1, name:'Wax Soleil de Dakar', category:'Wax', price:4500, description:'Wax hollandais aux motifs solaires, couleurs vives.', image_url:'', stock:40},
      {id:2, name:'Bazin Brodé Royal', category:'Bazin', price:7500, description:'Bazin riche brodé à la main, parfait pour cérémonies.', image_url:'', stock:25},
      {id:3, name:'Getzner Blanc Luxe', category:'Getzner', price:6500, description:"Getzner authentique d'origine autrichienne.", image_url:'', stock:30},
      {id:4, name:'Getzner Damassé Or', category:'Getzner', price:8000, description:'Getzner damassé aux reflets dorés.', image_url:'', stock:18},
      {id:5, name:'Bogolan Traditionnel', category:'Bogolan', price:3500, description:"Bogolan ancestral teint à l'argile.", image_url:'', stock:35},
      {id:6, name:'Wax Tie & Dye', category:'Wax', price:3800, description:'Wax tie-and-dye aux dégradés uniques.', image_url:'', stock:30},
      {id:7, name:'Satin Cérémonie', category:'Satin', price:5500, description:'Satin brillant pour tenues de fête.', image_url:'', stock:20},
      {id:8, name:'Bazin Léger Été', category:'Bazin', price:4200, description:'Bazin léger pour le quotidien sénégalais.', image_url:'', stock:55},
    ];
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Erreur chargement produits." });
  }
});

// Routes d'authentification basiques (pour démonstration)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    // Authentification simple pour démo
    if (email === 'admin@gestiontissus.com' && password === 'admin123') {
      res.json({
        user: { id: 1, name: 'Admin', email: email, role: 'admin' },
        token: 'demo-token-' + Date.now()
      });
    } else {
      res.status(401).json({ error: 'Identifiants incorrects' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    // Inscription simple pour démo
    res.json({
      user: { id: Date.now(), name: name, email: email, role: 'client' },
      token: 'demo-token-' + Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour récupérer les commandes de l'utilisateur
app.get("/api/orders/user", async (req, res) => {
  try {
    // Pour démo, retourner toutes les commandes
    const rows = await all(`
      SELECT
        o.id AS order_id,
        o.client_name,
        o.phone,
        o.item_name,
        o.quantity,
        o.unit_price,
        o.total,
        o.payment_type,
        o.created_at,
        p.id AS payment_id,
        p.amount AS payment_amount,
        p.date AS payment_date,
        p.note AS payment_note
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC, p.date DESC
    `);
    const orders = buildOrders(rows);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Erreur chargement commandes' });
  }
});

// Route pour mettre à jour le statut d'une commande
app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    // Pour démo, on ne fait rien de spécial avec le statut
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur mise à jour statut' });
  }
});

// Routes admin pour les produits (simulées)
app.post("/api/products", async (req, res) => {
  try {
    // Pour démo, on accepte mais ne fait rien
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur création produit' });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    // Pour démo, on accepte mais ne fait rien
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur modification produit' });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    // Pour démo, on accepte mais ne fait rien
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur suppression produit' });
  }
});

// Route pour récupérer toutes les commandes (admin)
app.get("/api/orders/all", async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        o.id AS order_id,
        o.client_name,
        o.phone,
        o.item_name,
        o.quantity,
        o.unit_price,
        o.total,
        o.payment_type,
        o.created_at,
        p.id AS payment_id,
        p.amount AS payment_amount,
        p.date AS payment_date,
        p.note AS payment_note
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      ORDER BY o.created_at DESC, p.date DESC
    `);
    const orders = buildOrders(rows);
    // Adapter le format pour l'admin
    const formattedOrders = orders.map(o => ({
      id: o.id,
      user_id: o.clientName,
      total_price: o.total,
      status: o.paymentType === 'cash' ? 'paid' : 'pending',
      created_at: o.createdAt,
      shipping_address: `${o.clientName}, ${o.phone}`
    }));
    res.json(formattedOrders);
  } catch (error) {
    res.status(500).json({ error: 'Erreur chargement commandes' });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Serveur lance sur http://localhost:${PORT}`);
  });
});
