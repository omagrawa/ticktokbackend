const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const {
  scrapeController,
  processExcelFile,
  getJobData,
  deleteData,
  creatorData,
  getSheetDataController
} = require('../controllers/scrapeController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });
console.log('Multer upload configured');

// Route to upload and read an Excel file
router.post(
  '/upload-excel',
  upload.single('file'),
  processExcelFile
);
// Route to scrape TikTok data
router.post('/scrape', scrapeController);
// Route to fetch job data
router.get('/jobs', getJobData);
// Route to delete job data
router.delete('/jobs', deleteData);
router.get('/jobs/creator/:jobId', creatorData);

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the TikTok Scrapper API!' });
});

router.get('/jobs/sheet', getSheetDataController);

module.exports = router;