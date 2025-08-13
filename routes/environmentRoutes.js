const express = require('express');
const router = express.Router();
const environmentController = require('../controllers/environmentController');
// const { protect, authorize } = require('../middleware/auth');

// Admin routes - protected and authorized for admin only
// router.use(protect);
// router.use(authorize('admin'));

// Save environment variables to database
router.post('/save', environmentController.saveEnvironmentVariables);

// Get all environment variables
router.get('/', environmentController.getEnvironmentVariables);

// Get single environment variable by key
router.get('/:key', environmentController.getEnvironmentVariable);

// Update environment variable by ID
router.patch('/:id', environmentController.updateEnvironmentVariable);

module.exports = router;
