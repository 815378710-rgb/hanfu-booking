const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// ── Uploads dir ──
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Multer config ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──
const db = new Database(path.join(__dirname, 'hanfu.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Init tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    openid TEXT UNIQUE,
    nickname TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    image TEXT NOT NULL,
    category_id INTEGER,
    tags TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT DEFAULT '',
    duration_minutes INTEGER DEFAULT 120,
    cover TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS schedule_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekday INTEGER NOT NULL,  -- 0=Sun,1=Mon,...,6=Sat
    time_slots TEXT NOT NULL,   -- JSON array e.g. ["09:00-11:00","11:00-13:00"]
    is_enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS closed_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE  -- YYYY-MM-DD
  );

  CREATE TABLE IF NOT EXISTS cancel_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    free_cancel_hours INTEGER DEFAULT 24,
    fee_type TEXT DEFAULT 'none',  -- none / percent / fixed
    fee_value REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    booking_date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',  -- pending / booked / completed / cancelled
    cancel_reason TEXT DEFAULT '',
    refund_amount REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    paid_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (package_id) REFERENCES packages(id)
  );
`);

// ── Seed demo data if empty ──
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  const insCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
  const cats = ['唐风', '宋制', '明制', '魏晋', '异域', '仙侠'];
  cats.forEach((c, i) => insCat.run(c, i));

  const insPhoto = db.prepare('INSERT INTO photos (title, image, category_id, tags, sort_order) VALUES (?, ?, ?, ?, ?)');
  const demoPhotos = [
    ['大唐盛世', 'https://images.unsplash.com/photo-1583427742897-f35e59d60d46?w=400&h=600&fit=crop', 1, '华丽,经典', 0],
    ['宋韵清雅', 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&h=600&fit=crop', 2, '素雅,简约', 1],
    ['明制端庄', 'https://images.unsplash.com/photo-1590735213920-68192a487bc2?w=400&h=600&fit=crop', 3, '端庄,大气', 2],
    ['魏晋风流', 'https://images.unsplash.com/photo-1551803091-e20673f15770?w=400&h=600&fit=crop', 4, '飘逸,仙气', 3],
    ['敦煌飞天', 'https://images.unsplash.com/photo-1544006659-f0b21884ce1d?w=400&h=600&fit=crop', 5, '异域,华丽', 4],
    ['仙侠梦回', 'https://images.unsplash.com/photo-1509099836639-18ba1795216d?w=400&h=600&fit=crop', 6, '仙气,梦幻', 5],
    ['花间集', 'https://images.unsplash.com/photo-1494783367193-149034c05e8f?w=400&h=600&fit=crop', 1, '浪漫,花仙', 6],
    ['月下独酌', 'https://images.unsplash.com/photo-1516450137517-162bfbeb8dba?w=400&h=600&fit=crop', 2, '清冷,月色', 7],
  ];
  demoPhotos.forEach(p => insPhoto.run(...p));

  const insPkg = db.prepare('INSERT INTO packages (name, price, description, duration_minutes, cover, is_active) VALUES (?, ?, ?, ?, ?, ?)');
  insPkg.run('基础妆造', 199, '含基础汉服租借+简单妆面+发型', 90,
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=300&fit=crop', 1);
  insPkg.run('精致妆造', 399, '含精选汉服+精致妆面+发型+配饰', 120,
    'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&h=300&fit=crop', 1);
  insPkg.run('豪华妆造+摄影', 699, '含高端汉服+精致妆面+发型+配饰+外景拍摄30张', 180,
    'https://images.unsplash.com/photo-1519741497674-611481863552?w=400&h=300&fit=crop', 1);
  insPkg.run('闺蜜双人套餐', 999, '两人含精选汉服+妆造+双人合照20张', 150,
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&h=300&fit=crop', 1);

  // Schedule: default slots for each weekday (Mon-Sat enabled, Sun disabled)
  const insSched = db.prepare('INSERT INTO schedule_config (weekday, time_slots, is_enabled) VALUES (?, ?, ?)');
  const defaultSlots = JSON.stringify(['09:00-11:00', '11:00-13:00', '14:00-16:00', '16:00-18:00']);
  for (let d = 0; d < 7; d++) {
    insSched.run(d, defaultSlots, d === 0 ? 0 : 1);
  }

  // Default cancel rules
  db.prepare('INSERT INTO cancel_rules (free_cancel_hours, fee_type, fee_value) VALUES (24, ?, 0)').run('none');

  // Seed a demo admin user
  db.prepare('INSERT INTO users (openid, nickname, phone, is_admin) VALUES (?, ?, ?, 1)').run('admin_openid', '商家管理', '13800000000');
}

// ════════════════════════════════════════
//  Simple auth middleware (demo)
// ════════════════════════════════════════
function getUser(req) {
  const uid = req.headers['x-user-id'];
  if (!uid) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || null;
}
function requireUser(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: '请先登录' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

// ════════════════════════════════════════
//  Auth (demo: just create/get user by openid)
// ════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { openid, nickname, avatar } = req.body;
  if (!openid) return res.status(400).json({ error: 'openid required' });
  let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (!user) {
    const r = db.prepare('INSERT INTO users (openid, nickname, avatar) VALUES (?, ?, ?)').run(openid, nickname || '游客', avatar || '');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  }
  res.json({ user });
});

// Demo: list users for dev
app.get('/api/auth/users', (req, res) => {
  res.json(db.prepare('SELECT id, openid, nickname, is_admin FROM users').all());
});

// Demo: switch to user (for demo purposes)
app.post('/api/auth/switch', (req, res) => {
  const { userId } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ user });
});

// ════════════════════════════════════════
//  Categories
// ════════════════════════════════════════
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
});
app.post('/api/categories', requireAdmin, (req, res) => {
  const { name } = req.body;
  const max = db.prepare('SELECT MAX(sort_order) as m FROM categories').get().m || 0;
  const r = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, max + 1);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
});
app.delete('/api/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════
//  Photos (客片)
// ════════════════════════════════════════
app.get('/api/photos', (req, res) => {
  const { category_id } = req.query;
  let rows;
  if (category_id) {
    rows = db.prepare('SELECT p.*, c.name as category_name FROM photos p LEFT JOIN categories c ON p.category_id=c.id WHERE p.category_id=? ORDER BY p.sort_order, p.id DESC').all(category_id);
  } else {
    rows = db.prepare('SELECT p.*, c.name as category_name FROM photos p LEFT JOIN categories c ON p.category_id=c.id ORDER BY p.sort_order, p.id DESC').all();
  }
  res.json(rows);
});
app.post('/api/photos', requireAdmin, upload.single('image'), (req, res) => {
  const { title, category_id, tags, sort_order } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;
  if (!image) return res.status(400).json({ error: '需要图片' });
  const r = db.prepare('INSERT INTO photos (title, image, category_id, tags, sort_order) VALUES (?,?,?,?,?)')
    .run(title, image, category_id || null, tags || '', sort_order || 0);
  res.json(db.prepare('SELECT * FROM photos WHERE id=?').get(r.lastInsertRowid));
});
app.delete('/api/photos/:id', requireAdmin, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(req.params.id);
  if (photo && photo.image.startsWith('/uploads/')) {
    const fp = path.join(__dirname, photo.image);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare('DELETE FROM photos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════
//  Packages (套餐)
// ════════════════════════════════════════
app.get('/api/packages', (req, res) => {
  const all = req.query.all === '1';
  const sql = all ? 'SELECT * FROM packages ORDER BY id' : 'SELECT * FROM packages WHERE is_active=1 ORDER BY id';
  res.json(db.prepare(sql).all());
});
app.post('/api/packages', requireAdmin, (req, res) => {
  const { name, price, description, duration_minutes, cover, is_active } = req.body;
  const r = db.prepare('INSERT INTO packages (name,price,description,duration_minutes,cover,is_active) VALUES (?,?,?,?,?,?)')
    .run(name, price, description || '', duration_minutes || 120, cover || '', is_active !== undefined ? is_active : 1);
  res.json(db.prepare('SELECT * FROM packages WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/packages/:id', requireAdmin, (req, res) => {
  const { name, price, description, duration_minutes, cover, is_active } = req.body;
  db.prepare('UPDATE packages SET name=?,price=?,description=?,duration_minutes=?,cover=?,is_active=? WHERE id=?')
    .run(name, price, description, duration_minutes, cover, is_active, req.params.id);
  res.json(db.prepare('SELECT * FROM packages WHERE id=?').get(req.params.id));
});
app.delete('/api/packages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM packages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════
//  Schedule (档期)
// ════════════════════════════════════════
app.get('/api/schedule', (req, res) => {
  const config = db.prepare('SELECT * FROM schedule_config ORDER BY weekday').all();
  const closed = db.prepare('SELECT date FROM closed_dates').all().map(r => r.date);
  const rules = db.prepare('SELECT * FROM cancel_rules LIMIT 1').get();
  res.json({ config, closed_dates: closed, cancel_rules: rules || { free_cancel_hours: 24, fee_type: 'none', fee_value: 0 } });
});

app.put('/api/schedule', requireAdmin, (req, res) => {
  const { config, closed_dates, cancel_rules } = req.body;
  if (config) {
    const up = db.prepare('UPDATE schedule_config SET time_slots=?, is_enabled=? WHERE weekday=?');
    config.forEach(c => up.run(JSON.stringify(c.time_slots), c.is_enabled ? 1 : 0, c.weekday));
  }
  if (closed_dates) {
    db.prepare('DELETE FROM closed_dates').run();
    const ins = db.prepare('INSERT INTO closed_dates (date) VALUES (?)');
    closed_dates.forEach(d => ins.run(d));
  }
  if (cancel_rules) {
    db.prepare('UPDATE cancel_rules SET free_cancel_hours=?, fee_type=?, fee_value=? WHERE id=1')
      .run(cancel_rules.free_cancel_hours, cancel_rules.fee_type, cancel_rules.fee_value);
  }
  res.json({ ok: true });
});

// Get available slots for a date
app.get('/api/slots/:date', (req, res) => {
  const date = req.params.date;
  const dateObj = new Date(date + 'T00:00:00');
  const weekday = dateObj.getDay();

  // Check if closed
  const closed = db.prepare('SELECT 1 FROM closed_dates WHERE date=?').get(date);
  if (closed) return res.json({ slots: [], reason: '当天不营业' });

  // Check weekday enabled
  const sched = db.prepare('SELECT * FROM schedule_config WHERE weekday=?').get(weekday);
  if (!sched || !sched.is_enabled) return res.json({ slots: [], reason: '当天不营业' });

  const allSlots = JSON.parse(sched.time_slots);

  // Get booked slots
  const booked = db.prepare(
    "SELECT time_slot FROM orders WHERE booking_date=? AND status IN ('pending','booked')"
  ).all(date).map(r => r.time_slot);

  const slots = allSlots.map(s => ({
    time: s,
    available: !booked.includes(s),
    booked: booked.includes(s)
  }));

  res.json({ slots, weekday });
});

// ════════════════════════════════════════
//  Orders (预约单)
// ════════════════════════════════════════
function genOrderNo() {
  const d = new Date();
  const ts = d.getFullYear().toString() +
    String(d.getMonth()+1).padStart(2,'0') +
    String(d.getDate()).padStart(2,'0') +
    String(d.getHours()).padStart(2,'0') +
    String(d.getMinutes()).padStart(2,'0') +
    String(d.getSeconds()).padStart(2,'0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `HF${ts}${rand}`;
}

// Create order
app.post('/api/orders', requireUser, (req, res) => {
  const { package_id, booking_date, time_slot, customer_name, customer_phone } = req.body;
  if (!package_id || !booking_date || !time_slot || !customer_name || !customer_phone) {
    return res.status(400).json({ error: '请填写完整信息' });
  }

  // Check slot still available
  const existing = db.prepare(
    "SELECT 1 FROM orders WHERE booking_date=? AND time_slot=? AND status IN ('pending','booked')"
  ).get(booking_date, time_slot);
  if (existing) return res.status(409).json({ error: '该时段已被预约' });

  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND is_active=1').get(package_id);
  if (!pkg) return res.status(400).json({ error: '套餐不存在或已下架' });

  const order_no = genOrderNo();
  const r = db.prepare(
    'INSERT INTO orders (order_no, user_id, package_id, booking_date, time_slot, customer_name, customer_phone, amount, status) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(order_no, req.user.id, package_id, booking_date, time_slot, customer_name, customer_phone, pkg.price, 'pending');

  const order = db.prepare(`
    SELECT o.*, p.name as package_name, p.price as package_price
    FROM orders o JOIN packages p ON o.package_id=p.id WHERE o.id=?
  `).get(r.lastInsertRowid);

  res.json(order);
});

// Get my orders
app.get('/api/orders/my', requireUser, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT o.*, p.name as package_name, p.price as package_price FROM orders o JOIN packages p ON o.package_id=p.id WHERE o.user_id=?';
  const params = [req.user.id];
  if (status) { sql += ' AND o.status=?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Get all orders (admin)
app.get('/api/orders', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT o.*, p.name as package_name, p.price as package_price, u.nickname FROM orders o JOIN packages p ON o.package_id=p.id JOIN users u ON o.user_id=u.id';
  const params = [];
  if (status) { sql += ' WHERE o.status=?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Pay (simulated)
app.post('/api/orders/:id/pay', requireUser, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: '无权操作' });
  if (order.status !== 'pending') return res.status(400).json({ error: '订单状态不正确' });

  db.prepare("UPDATE orders SET status='booked', paid_at=datetime('now','localtime') WHERE id=?").run(order.id);
  res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
});

// Cancel order
app.post('/api/orders/:id/cancel', requireUser, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: '无权操作' });
  if (!['pending', 'booked'].includes(order.status)) return res.status(400).json({ error: '该订单无法取消' });

  const rules = db.prepare('SELECT * FROM cancel_rules WHERE id=1').get();
  let refund = order.amount;
  const bookingStart = new Date(`${order.booking_date}T${order.time_slot.split('-')[0]}:00`);
  const now = new Date();
  const hoursUntil = (bookingStart - now) / (1000 * 60 * 60);

  if (order.status === 'booked') {
    if (hoursUntil < rules.free_cancel_hours) {
      if (rules.fee_type === 'none') {
        return res.status(400).json({ error: `距预约不足${rules.free_cancel_hours}小时，不可取消` });
      } else if (rules.fee_type === 'percent') {
        refund = order.amount * (1 - rules.fee_value / 100);
      } else if (rules.fee_type === 'fixed') {
        refund = Math.max(0, order.amount - rules.fee_value);
      }
    }
  }

  const reason = req.body.reason || '用户取消';
  db.prepare("UPDATE orders SET status='cancelled', cancelled_at=datetime('now','localtime'), cancel_reason=?, refund_amount=? WHERE id=?")
    .run(reason, refund, order.id);
  res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));
});

// Complete (admin marks as done / 核销)
app.post('/api/orders/:id/complete', requireAdmin, (req, res) => {
  db.prepare("UPDATE orders SET status='completed' WHERE id=?").run(req.params.id);
  res.json(db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id));
});

// Delete order (soft delete for user)
app.delete('/api/orders/:id', requireUser, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: '无权操作' });
  if (!['cancelled', 'completed'].includes(order.status)) return res.status(400).json({ error: '只能删除已取消或已完成的订单' });
  // Actually hide for user (real deletion would be admin only)
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Export orders as CSV
app.get('/api/orders/export', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT o.order_no, u.nickname, o.customer_name, o.customer_phone,
           p.name as package_name, o.amount, o.booking_date, o.time_slot,
           o.status, o.created_at, o.paid_at
    FROM orders o JOIN packages p ON o.package_id=p.id JOIN users u ON o.user_id=u.id
    ORDER BY o.created_at DESC
  `).all();

  const statusMap = { pending: '待支付', booked: '已预约', completed: '已完成', cancelled: '已取消' };
  const header = '订单号,用户昵称,姓名,手机号,套餐,金额,预约日期,时段,状态,创建时间,支付时间';
  const csvRows = rows.map(r =>
    [r.order_no, r.nickname, r.customer_name, r.customer_phone, r.package_name, r.amount, r.booking_date, r.time_slot, statusMap[r.status]||r.status, r.created_at, r.paid_at||''].join(',')
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  // BOM for Excel
  res.write('\uFEFF' + header + '\n' + csvRows.join('\n'));
  res.end();
});

// ── Admin page ──
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Catch-all: serve SPA ──
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ 汉服妆造预约系统已启动: http://localhost:${PORT}`);
});
