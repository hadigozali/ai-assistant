// server.js
const express = require('express');
const path = require('path');
const db = require('./db');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const methodOverride = require('method-override');

const app = express();
app.use(helmet());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// session
app.use(session({
  secret: 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // در تولید secure: true با HTTPS
}));

// multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random()*1E9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// helpers
function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           
    .replace(/[^\w\-]+/g, '')       
    .replace(/\-\-+/g, '-')         
    .replace(/^-+/, '')             
    .replace(/-+$/, '');            
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/admin/login');
}

// Public routes
app.get('/', (req, res) => {
  db.all(`SELECT a.id,a.title,a.slug,a.excerpt,a.featured_image,a.published_at,c.name as category, u.name as author
          FROM articles a
          LEFT JOIN categories c ON a.category_id = c.id
          LEFT JOIN users u ON a.author_id = u.id
          WHERE a.status = 'published'
          ORDER BY a.published_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    res.render('index', { articles: rows, user: req.session.user });
  });
});

app.get('/article/:slug', (req, res) => {
  const slug = req.params.slug;
  db.get(`SELECT a.*, c.name as category, u.name as author FROM articles a
          LEFT JOIN categories c ON a.category_id = c.id
          LEFT JOIN users u ON a.author_id = u.id
          WHERE a.slug = ?`, [slug], (err, article) => {
    if (err || !article) return res.status(404).send('Not found');
    // increment views
    db.run('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
    res.render('article', { article, user: req.session.user });
  });
});

// Admin auth
app.get('/admin/login', (req, res) => {
  res.render('admin_login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) return res.render('admin_login', { error: 'ایمیل یا رمز اشتباه است' });
    bcrypt.compare(password, user.password_hash).then(match => {
      if (!match) return res.render('admin_login', { error: 'ایمیل یا رمز اشتباه است' });
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      res.redirect('/admin');
    });
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Admin dashboard
app.get('/admin', requireAdmin, (req, res) => {
  db.all(`SELECT a.id,a.title,a.status,a.published_at,u.name as author FROM articles a
          LEFT JOIN users u ON a.author_id = u.id ORDER BY a.created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).send('DB error');
    res.render('admin_dashboard', { articles: rows, user: req.session.user });
  });
});

// New article form
app.get('/admin/new', requireAdmin, (req, res) => {
  db.all('SELECT * FROM categories', [], (err, cats) => {
    res.render('admin_edit', { article: null, categories: cats, user: req.session.user });
  });
});

// Edit article form
app.get('/admin/edit/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM articles WHERE id = ?', [id], (err, article) => {
    db.all('SELECT * FROM categories', [], (err2, cats) => {
      res.render('admin_edit', { article, categories: cats, user: req.session.user });
    });
  });
});

// Create article
app.post('/admin/articles', requireAdmin, upload.single('featured_image'), (req, res) => {
  const { title, excerpt, body, status, category } = req.body;
  const slug = slugify(title);
  const featured_image = req.file ? '/uploads/' + req.file.filename : null;
  const published_at = status === 'published' ? new Date().toISOString() : null;
  db.run(`INSERT INTO articles (title,slug,excerpt,body,status,author_id,category_id,featured_image,published_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    [title, slug, excerpt, body, status, req.session.user.id, category || null, featured_image, published_at],
    function(err) {
      if (err) return res.status(500).send('DB insert error: ' + err.message);
      res.redirect('/admin');
    });
});

// Update article
app.put('/admin/articles/:id', requireAdmin, upload.single('featured_image'), (req, res) => {
  const id = req.params.id;
  const { title, excerpt, body, status, category } = req.body;
  const slug = slugify(title);
  const featured_image = req.file ? '/uploads/' + req.file.filename : null;
  const published_at = status === 'published' ? new Date().toISOString() : null;
  // if new image provided, update it; else keep existing
  db.get('SELECT featured_image FROM articles WHERE id = ?', [id], (err, row) => {
    const imageToUse = featured_image || (row ? row.featured_image : null);
    db.run(`UPDATE articles SET title=?,slug=?,excerpt=?,body=?,status=?,category_id=?,featured_image=?,published_at=? WHERE id=?`,
      [title, slug, excerpt, body, status, category || null, imageToUse, published_at, id],
      function(err2) {
        if (err2) return res.status(500).send('DB update error');
        res.redirect('/admin');
      });
  });
});

// Delete article
app.delete('/admin/articles/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM articles WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).send('DB delete error');
    res.redirect('/admin');
  });
});

// Upload endpoint for AJAX (optional)
app.post('/admin/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});