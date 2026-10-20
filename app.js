require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const transactions = require('./routes/transactions');
const cookieParser = require('cookie-parser')
const helmet = require('helmet')
const cors = require('cors');
const app = express();
const userRoutes = require('./routes/user');

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3001')
  .split(',')
  .map((o) => o.trim());

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
  
app.use(cors(corsOptions));
  
  // ✅ safe preflight handler (works even when "*" crashes)
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

app.use('/transactions', transactions);
app.use('/', userRoutes);


app.get("/api/health", (req, res) => {
    res.json({ ok: true });
  });


app.get('/', (req, res) => {
    res.redirect('/register')
});

/*app.all("*", (req, res, next) => {
  next(new expressError("Route Not Found", 404));
});*/

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.statusCode || 500;
    if (status >= 500) console.error('Request failed:', req.method, req.path, err.name || 'Error');
    res.status(status).json({
      ok: false,
      message: status >= 500
        ? 'The server could not complete this request. Please try again shortly.'
        : err.type === 'entity.parse.failed'
          ? 'The request body must be valid JSON.'
          : err.message || 'The request could not be completed.',
    });
  });

// Importing the app in tests must not open a port or connect to a real database.
async function start() {
  for (const key of ['MONGO_URI', 'ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET']) {
    if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const port = process.env.PORT || 3000;
  return app.listen(port, () => console.log('Listening on port', port));
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error('Unable to start server:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = app;
