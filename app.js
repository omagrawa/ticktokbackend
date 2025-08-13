require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const scrapeRoutes = require('./routes/scrapeRoutes');
const environmentRoutes = require('./routes/environmentRoutes');
const connectDB = require('./db');

const app = express(); // ✅ MUST be before any app.use(...)
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// API routes
app.use('/api', scrapeRoutes);
app.use('/api/environment', environmentRoutes);

// Serve frontend
app.use(express.static(path.resolve(__dirname, 'dist')));

// Catch-all for Vue Router (history mode)
app.get('/', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
});

app.get('/settings', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    } else {
      res.status(404).json({ error: 'API route not found' });
    }
  });
app.get('/data', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    } else {
      res.status(404).json({ error: 'API route not found' });
    }
  });

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
