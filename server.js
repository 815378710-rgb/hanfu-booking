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
    person_count INTEGER DEFAULT 1,
    needs_all_names INTEGER DEFAULT 1,
    is_hot INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS order_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    content TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    is_anonymous INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (package_id) REFERENCES packages(id)
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL NOT NULL,
    min_amount REAL DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS user_coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coupon_id INTEGER NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_at TEXT,
    order_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (coupon_id) REFERENCES coupons(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS member_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    min_points INTEGER DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    icon TEXT DEFAULT ''
  );
`);

// ── Extend users table (safe ALTER, ignore if already exists) ──
try { db.exec("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN member_level_id INTEGER DEFAULT 1"); } catch(e) {}
// Extend orders table
try { db.exec("ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN final_amount REAL DEFAULT 0"); } catch(e) {}

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

  const insPkg = db.prepare('INSERT INTO packages (name, price, description, duration_minutes, cover, person_count, needs_all_names, is_hot, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insPkg.run('基础妆造', 199, '含基础汉服租借+简单妆面+发型', 90,
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=300&fit=crop', 1, 1, 0, 1);
  insPkg.run('精致妆造', 399, '含精选汉服+精致妆面+发型+配饰', 120,
    'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400&h=300&fit=crop', 1, 1, 1, 1);
  insPkg.run('豪华妆造+摄影', 699, '含高端汉服+精致妆面+发型+配饰+外景拍摄30张', 180,
    'https://images.unsplash.com/photo-1519741497674-611481863552?w=400&h=300&fit=crop', 1, 1, 0, 1);
  insPkg.run('闺蜜双人套餐', 999, '两人含精选汉服+妆造+双人合照20张', 150,
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&h=300&fit=crop', 2, 0, 1, 1);

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

  // Seed demo normal users
  db.prepare('INSERT INTO users (openid, nickname, phone, points, member_level_id) VALUES (?, ?, ?, ?, ?)').run('user1_openid', '小仙女', '13900000001', 320, 2);
  db.prepare('INSERT INTO users (openid, nickname, phone, points, member_level_id) VALUES (?, ?, ?, ?, ?)').run('user2_openid', '汉服爱好者', '13900000002', 150, 1);
  db.prepare('INSERT INTO users (openid, nickname, phone, points, member_level_id) VALUES (?, ?, ?, ?, ?)').run('user3_openid', '古风少女', '13900000003', 800, 3);
}

// ── Seed member levels ──
const mlCount = db.prepare('SELECT COUNT(*) as c FROM member_levels').get().c;
if (mlCount === 0) {
  const insML = db.prepare('INSERT INTO member_levels (name, min_points, discount_percent, icon) VALUES (?, ?, ?, ?)');
  insML.run('普通会员', 0, 0, '🥉');
  insML.run('银卡会员', 200, 5, '🥈');
  insML.run('金卡会员', 500, 10, '🥇');
}

// ── Seed coupons ──
const couponCount = db.prepare('SELECT COUNT(*) as c FROM coupons').get().c;
if (couponCount === 0) {
  const insCoupon = db.prepare('INSERT INTO coupons (code, name, type, value, min_amount, max_uses, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insCoupon.run('NEWUSER9', '新人9折优惠券', 'percent', 10, 0, 1000, '2026-01-01', '2026-12-31');
  insCoupon.run('GIRL50', '闺蜜同行减50', 'fixed', 50, 199, 500, '2026-01-01', '2026-12-31');
  insCoupon.run('SAVE80', '满500减80', 'fixed', 80, 500, 300, '2026-01-01', '2026-12-31');
}

// ── Seed demo orders for reviews ──
const demoOrderCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE user_id IN (SELECT id FROM users WHERE openid LIKE 'user%')").get().c;
if (demoOrderCount === 0 && db.prepare('SELECT COUNT(*) as c FROM users WHERE openid LIKE ?').get('user%_openid').c > 0) {
  const demoUsers = db.prepare("SELECT id FROM users WHERE openid LIKE 'user%_openid'").all();
  const pkgs = db.prepare('SELECT id, price FROM packages WHERE is_active=1 LIMIT 3').all();

  if (demoUsers.length > 0 && pkgs.length > 0) {
    const insOrder = db.prepare(
      "INSERT INTO orders (order_no, user_id, package_id, booking_date, time_slot, customer_name, customer_phone, amount, status, final_amount) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    const names = ['小仙女', '汉服爱好者', '古风少女'];
    const phones = ['13900000001', '13900000002', '13900000003'];

    for (let i = 0; i < demoUsers.length && i < pkgs.length; i++) {
      const no = genOrderNo();
      insOrder.run(no, demoUsers[i].id, pkgs[i].id, '2026-04-01', '10:00-12:00', names[i], phones[i], pkgs[i].price, 'completed', pkgs[i].price);
    }
  }
}

// ── Seed reviews ──
const reviewCount = db.prepare('SELECT COUNT(*) as c FROM reviews').get().c;
if (reviewCount === 0) {
  const completedOrders = db.prepare(
    "SELECT o.id as order_id, o.user_id, o.package_id FROM orders o WHERE o.status='completed' ORDER BY o.id LIMIT 3"
  ).all();

  if (completedOrders.length >= 3) {
    const insReview = db.prepare('INSERT INTO reviews (user_id, order_id, package_id, rating, content, is_anonymous) VALUES (?,?,?,?,?,?)');
    insReview.run(completedOrders[0].user_id, completedOrders[0].order_id, completedOrders[0].package_id, 5, '超级满意的体验！化妆师技术超好，发型做得特别精致，穿上汉服感觉自己穿越回了古代。照片拍得也很美，强烈推荐！下次还会再来～', 0);
    insReview.run(completedOrders[1].user_id, completedOrders[1].order_id, completedOrders[1].package_id, 5, '和闺蜜一起来的，两个人的妆造都很用心。服装选择很多，每一件都好美。服务态度特别好，耐心帮我们搭配。拍出来的照片超级出片！❤️', 0);
    insReview.run(completedOrders[2].user_id, completedOrders[2].order_id, completedOrders[2].package_id, 5, '第一次穿汉服拍照，本来很紧张，但店里的小姐姐特别温柔，妆容和发型都做得超级好看！选的宋制很适合我，已经推荐给朋友们了，一定会回购！', 0);
  }
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
  const baseWhere = all ? '' : 'WHERE p.is_active=1';
  const sql = `
    SELECT p.*,
      COUNT(DISTINCT o.id) as booking_count,
      COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
      COUNT(DISTINCT r.id) as review_count
    FROM packages p
    LEFT JOIN orders o ON o.package_id = p.id AND o.status IN ('booked','completed')
    LEFT JOIN reviews r ON r.package_id = p.id
    ${baseWhere}
    GROUP BY p.id
    ORDER BY p.id
  `;
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
  const { package_id, booking_date, time_slot, customer_name, customer_phone, guests, coupon_id } = req.body;
  if (!package_id || !booking_date || !time_slot || !customer_name || !customer_phone) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  if (!/^1\d{10}$/.test(customer_phone)) {
    return res.status(400).json({ error: '请输入正确的11位手机号' });
  }

  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND is_active=1').get(package_id);
  if (!pkg) return res.status(400).json({ error: '套餐不存在或已下架' });

  // Multi-person: validate guests info
  if (pkg.person_count > 1 && pkg.needs_all_names) {
    if (!Array.isArray(guests) || guests.length < pkg.person_count - 1) {
      return res.status(400).json({ error: `该套餐需填写${pkg.person_count}位参与者信息` });
    }
    for (const g of guests) {
      if (!g.name || !g.phone || !/^1\d{10}$/.test(g.phone)) {
        return res.status(400).json({ error: '请为每位参与者填写完整姓名和手机号' });
      }
    }
  }

  // Validate coupon if provided
  let discount = 0;
  let userCouponId = null;
  if (coupon_id) {
    const uc = db.prepare(`
      SELECT uc.*, c.type, c.value, c.min_amount, c.valid_from, c.valid_to, c.is_active
      FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
      WHERE uc.id=? AND uc.user_id=? AND uc.is_used=0
    `).get(coupon_id, req.user.id);

    if (!uc) return res.status(400).json({ error: '优惠券不存在或已使用' });
    if (!uc.is_active) return res.status(400).json({ error: '优惠券已失效' });

    const now = new Date().toISOString().slice(0, 10);
    if (uc.valid_from && uc.valid_from > now) return res.status(400).json({ error: '优惠券尚未生效' });
    if (uc.valid_to && uc.valid_to < now) return res.status(400).json({ error: '优惠券已过期' });
    if (pkg.price < uc.min_amount) return res.status(400).json({ error: `订单金额需满${uc.min_amount}元` });

    if (uc.type === 'percent') {
      discount = Math.round(pkg.price * (uc.value / 100) * 100) / 100;
    } else if (uc.type === 'fixed') {
      discount = uc.value;
    }
    discount = Math.min(discount, pkg.price);
    userCouponId = uc.id;
  }

  const finalAmount = Math.round((pkg.price - discount) * 100) / 100;

  // Use transaction for concurrency safety
  const createOrder = db.transaction(() => {
    // Double-check slot availability within transaction (SELECT FOR UPDATE pattern)
    const existing = db.prepare(
      "SELECT 1 FROM orders WHERE booking_date=? AND time_slot=? AND status IN ('pending','booked')"
    ).get(booking_date, time_slot);
    if (existing) throw new Error('该时段已被预约，请选择其他时间');

    const order_no = genOrderNo();
    const r = db.prepare(
      'INSERT INTO orders (order_no, user_id, package_id, booking_date, time_slot, customer_name, customer_phone, amount, discount_amount, final_amount, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(order_no, req.user.id, package_id, booking_date, time_slot, customer_name, customer_phone, pkg.price, discount, finalAmount, 'pending');

    // Insert additional guests
    if (pkg.person_count > 1 && Array.isArray(guests) && guests.length > 0) {
      const insGuest = db.prepare('INSERT INTO order_guests (order_id, guest_name, guest_phone) VALUES (?,?,?)');
      guests.forEach(g => insGuest.run(r.lastInsertRowid, g.name, g.phone));
    }

    // Mark coupon as used
    if (userCouponId) {
      db.prepare("UPDATE user_coupons SET is_used=1, used_at=datetime('now','localtime'), order_id=? WHERE id=?")
        .run(r.lastInsertRowid, userCouponId);
    }

    return r.lastInsertRowid;
  });

  try {
    const orderId = createOrder();
    const order = db.prepare(`
      SELECT o.*, p.name as package_name, p.price as package_price, p.person_count
      FROM orders o JOIN packages p ON o.package_id=p.id WHERE o.id=?
    `).get(orderId);
    
    // Fetch guests
    order.guests = db.prepare('SELECT guest_name as name, guest_phone as phone FROM order_guests WHERE order_id=?').all(orderId);
    res.json(order);
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// Get my orders
app.get('/api/orders/my', requireUser, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT o.*, p.name as package_name, p.price as package_price, p.person_count FROM orders o JOIN packages p ON o.package_id=p.id WHERE o.user_id=?';
  const params = [req.user.id];
  if (status) { sql += ' AND o.status=?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC';
  const orders = db.prepare(sql).all(...params);
  // Attach guests
  const getGuests = db.prepare('SELECT guest_name as name, guest_phone as phone FROM order_guests WHERE order_id=?');
  orders.forEach(o => { o.guests = getGuests.all(o.id); });
  res.json(orders);
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
           p.name as package_name, o.amount, o.discount_amount, o.final_amount,
           o.booking_date, o.time_slot, o.status, o.created_at, o.paid_at
    FROM orders o JOIN packages p ON o.package_id=p.id JOIN users u ON o.user_id=u.id
    ORDER BY o.created_at DESC
  `).all();

  const statusMap = { pending: '待支付', booked: '已预约', completed: '已完成', cancelled: '已取消' };
  const header = '订单号,用户昵称,姓名,手机号,套餐,原价,优惠金额,实付金额,预约日期,时段,状态,创建时间,支付时间';
  function escCsv(v) { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; }
  const csvRows = rows.map(r =>
    [r.order_no, r.nickname, r.customer_name, r.customer_phone, r.package_name, r.amount, r.discount_amount, r.final_amount, r.booking_date, r.time_slot, statusMap[r.status]||r.status, r.created_at, r.paid_at||''].map(escCsv).join(',')
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  // BOM for Excel
  res.write('\uFEFF' + header + '\n' + csvRows.join('\n'));
  res.end();
});

// ════════════════════════════════════════
//  Reviews (评价系统)
// ════════════════════════════════════════

// Get reviews list (with optional package_id filter)
app.get('/api/reviews', (req, res) => {
  const { package_id } = req.query;
  let sql = `
    SELECT r.*, u.nickname, u.avatar,
      CASE WHEN r.is_anonymous = 1 THEN '匿名用户' ELSE u.nickname END as display_name
    FROM reviews r JOIN users u ON r.user_id = u.id
  `;
  const params = [];
  if (package_id) { sql += ' WHERE r.package_id = ?'; params.push(package_id); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Submit review (must be completed order)
app.post('/api/reviews', requireUser, (req, res) => {
  const { order_id, rating, content, images, is_anonymous } = req.body;
  if (!order_id || !rating) return res.status(400).json({ error: '请提供订单ID和评分' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: '评分范围1-5' });

  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(order_id, req.user.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'completed') return res.status(400).json({ error: '只能对已完成的订单进行评价' });

  const existing = db.prepare('SELECT id FROM reviews WHERE order_id=?').get(order_id);
  if (existing) return res.status(400).json({ error: '该订单已评价' });

  const r = db.prepare(
    'INSERT INTO reviews (user_id, order_id, package_id, rating, content, images, is_anonymous) VALUES (?,?,?,?,?,?,?)'
  ).run(req.user.id, order_id, order.package_id, rating, content || '', JSON.stringify(images || []), is_anonymous ? 1 : 0);

  res.json(db.prepare('SELECT * FROM reviews WHERE id=?').get(r.lastInsertRowid));
});

// Get review stats for a package
app.get('/api/reviews/stats/:packageId', (req, res) => {
  const pid = req.params.packageId;
  const stats = db.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(rating), 1) as avg_rating,
      SUM(CASE WHEN rating=5 THEN 1 ELSE 0 END) as five_star,
      SUM(CASE WHEN rating=4 THEN 1 ELSE 0 END) as four_star,
      SUM(CASE WHEN rating=3 THEN 1 ELSE 0 END) as three_star,
      SUM(CASE WHEN rating=2 THEN 1 ELSE 0 END) as two_star,
      SUM(CASE WHEN rating=1 THEN 1 ELSE 0 END) as one_star
    FROM reviews WHERE package_id=?
  `).get(pid);
  const goodRate = stats.total > 0 ? Math.round(((stats.five_star + stats.four_star) / stats.total) * 100) : 0;
  res.json({ ...stats, good_rate: goodRate, package_id: Number(pid) });
});

// ════════════════════════════════════════
//  Coupons (优惠券系统)
// ════════════════════════════════════════

// Get available coupons for current user
app.get('/api/coupons/available', requireUser, (req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT c.*, uc.id as user_coupon_id, uc.is_used, uc.used_at
    FROM user_coupons uc
    JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.user_id = ? AND uc.is_used = 0 AND c.is_active = 1
      AND (c.valid_from IS NULL OR c.valid_from <= ?)
      AND (c.valid_to IS NULL OR c.valid_to >= ?)
    ORDER BY c.created_at DESC
  `).all(req.user.id, now, now);
  res.json(rows);
});

// Claim a coupon
app.post('/api/coupons/claim', requireUser, (req, res) => {
  const { coupon_id, code } = req.body;
  let coupon;
  if (coupon_id) {
    coupon = db.prepare('SELECT * FROM coupons WHERE id=? AND is_active=1').get(coupon_id);
  } else if (code) {
    coupon = db.prepare('SELECT * FROM coupons WHERE code=? AND is_active=1').get(code.toUpperCase());
  } else {
    return res.status(400).json({ error: '请提供优惠券ID或兑换码' });
  }
  if (!coupon) return res.status(404).json({ error: '优惠券不存在或已失效' });

  // Check validity period
  const now = new Date().toISOString().slice(0, 10);
  if (coupon.valid_from && coupon.valid_from > now) return res.status(400).json({ error: '优惠券尚未生效' });
  if (coupon.valid_to && coupon.valid_to < now) return res.status(400).json({ error: '优惠券已过期' });

  // Check global usage limit (count actual claims, not usage)
  const claimCount = db.prepare('SELECT COUNT(*) as c FROM user_coupons WHERE coupon_id=?').get(coupon.id).c;
  if (claimCount >= coupon.max_uses) return res.status(400).json({ error: '优惠券已被领取完' });

  // Check if user already has this coupon
  const existing = db.prepare('SELECT id FROM user_coupons WHERE user_id=? AND coupon_id=?').get(req.user.id, coupon.id);
  if (existing) return res.status(400).json({ error: '您已领取过该优惠券' });

  db.prepare('INSERT INTO user_coupons (user_id, coupon_id) VALUES (?, ?)').run(req.user.id, coupon.id);
  db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
  res.json({ ok: true, message: '领取成功', coupon });
});

// Validate a coupon for use
app.post('/api/coupons/validate', requireUser, (req, res) => {
  const { coupon_id, amount } = req.body;
  if (!coupon_id || amount === undefined) return res.status(400).json({ error: '请提供优惠券ID和订单金额' });

  const uc = db.prepare(`
    SELECT uc.*, c.name, c.type, c.value, c.min_amount, c.valid_from, c.valid_to, c.is_active
    FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id
    WHERE uc.id=? AND uc.user_id=? AND uc.is_used=0
  `).get(coupon_id, req.user.id);

  if (!uc) return res.status(404).json({ error: '优惠券不存在或已使用' });
  if (!uc.is_active) return res.status(400).json({ error: '优惠券已失效' });

  const now = new Date().toISOString().slice(0, 10);
  if (uc.valid_from && uc.valid_from > now) return res.status(400).json({ error: '优惠券尚未生效' });
  if (uc.valid_to && uc.valid_to < now) return res.status(400).json({ error: '优惠券已过期' });

  if (amount < uc.min_amount) return res.status(400).json({ error: `订单金额需满${uc.min_amount}元才能使用` });

  let discount = 0;
  if (uc.type === 'percent') {
    discount = Math.round(amount * (uc.value / 100) * 100) / 100;
  } else if (uc.type === 'fixed') {
    discount = uc.value;
  }
  discount = Math.min(discount, amount);

  res.json({
    valid: true,
    user_coupon_id: uc.id,
    coupon_name: uc.name,
    type: uc.type,
    value: uc.value,
    discount,
    final_amount: Math.round((amount - discount) * 100) / 100
  });
});

// ════════════════════════════════════════
//  Stats & Popular (统计数据)
// ════════════════════════════════════════

// Public stats for social proof
app.get('/api/stats/public', (req, res) => {
  const totalBookings = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('booked','completed')").get().c;
  const reviewStats = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN rating>=4 THEN 1 ELSE 0 END) as good FROM reviews").get();
  const goodRate = reviewStats.total > 0 ? Math.round((reviewStats.good / reviewStats.total) * 100) : 0;

  // Return customers: users with 2+ completed/booked orders
  const repeatSql = `
    SELECT COUNT(*) as c FROM (
      SELECT user_id FROM orders WHERE status IN ('booked','completed')
      GROUP BY user_id HAVING COUNT(*) >= 2
    )
  `;
  const repeatCustomers = db.prepare(repeatSql).get().c;
  const totalCustomers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM orders WHERE status IN ('booked','completed')").get().c;
  const repeatRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0;

  res.json({
    total_bookings: totalBookings,
    total_reviews: reviewStats.total,
    good_rate: goodRate,
    repeat_rate: repeatRate,
    total_customers: totalCustomers
  });
});

// Popular packages ranking
app.get('/api/packages/popular', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
      COUNT(DISTINCT o.id) as booking_count,
      COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
      COUNT(DISTINCT r.id) as review_count
    FROM packages p
    LEFT JOIN orders o ON o.package_id = p.id AND o.status IN ('booked','completed')
    LEFT JOIN reviews r ON r.package_id = p.id
    WHERE p.is_active = 1
    GROUP BY p.id
    ORDER BY booking_count DESC, avg_rating DESC
  `).all();
  res.json(rows);
});

// ── Admin page ──
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Catch-all: serve SPA ──
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Auto-cancel pending orders after 15 minutes ──
setInterval(() => {
  const result = db.prepare(`
    UPDATE orders SET status='cancelled', cancelled_at=datetime('now','localtime'), cancel_reason='超时未支付自动取消', refund_amount=0
    WHERE status='pending' AND datetime(created_at, '+15 minutes') < datetime('now','localtime')
  `).run();
  if (result.changes > 0) {
    console.log(`⏰ 自动取消 ${result.changes} 个超时未支付订单`);
  }
}, 60 * 1000); // Check every minute

app.listen(PORT, () => {
  console.log(`✨ 汉服妆造预约系统已启动: http://localhost:${PORT}`);
});
