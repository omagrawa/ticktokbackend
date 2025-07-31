const mongoose = require('mongoose');

// Create a dynamic schema with additional fields
const scrapDataSchema = new mongoose.Schema(
    {
        status: { type: String, default: 'active' }, // Add status field with a default value
        jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true }, // Reference to the Job model
    },
    { 
        strict: false, 
        timestamps: true // Automatically adds createdAt and updatedAt fields
    }
);

// Create the model
const ScrapData = mongoose.model('ScrapData', scrapDataSchema);

module.exports = ScrapData;