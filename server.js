const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "database.sqlite");

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, clientName, phone || "", itemName, quantity, unitPrice, total, paymentType, createdAt]
    );

    if (paymentType === "cash") {
      await run(
        "INSERT INTO payments (order_id, amount, date, note) VALUES (?, ?, ?, ?)",
        [id, total, createdAt, "Paiement cash unique"]
      );
    } else if (Number(initialPayment) > 0) {
      await run(
        "INSERT INTO payments (order_id, amount, date, note) VALUES (?, ?, ?, ?)",
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
      "INSERT INTO payments (order_id, amount, date, note) VALUES (?, ?, ?, ?)",
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
        `INSERT OR IGNORE INTO orders (id, client_name, phone, item_name, quantity, unit_price, total, payment_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          "INSERT INTO payments (order_id, amount, date, note) VALUES (?, ?, ?, ?)",
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
    await run("DELETE FROM payments WHERE order_id = ?", [id]);
    await run("DELETE FROM orders WHERE id = ?", [id]);
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

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Serveur lance sur http://localhost:${PORT}`);
  });
});
