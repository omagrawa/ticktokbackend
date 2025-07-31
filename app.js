require('dotenv').config()
const express = require('express');
const cors = require('cors');
const scrapeRoutes = require('./routes/scrapeRoutes');
const connectDB = require('./db'); // Import MongoDB connection

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middleware
// Enable CORS to allow requests from different origins
app.use(cors());
// Parse JSON bodies
app.use(express.json());
// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Set headers
app.use((req, res, next) => {
    // Set content type to JSON
    res.setHeader('Content-Type', 'application/json');
    // Allow requests from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Allow GET, POST, PUT, DELETE methods
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    // Allow Content-Type and Authorization headers
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Routes
app.use('/api', scrapeRoutes);

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});