const mongoose = require('mongoose');

// Create a dynamic schema with additional fields
const contentSheetSchema = new mongoose.Schema(
    {
        status: { type: String, default: 'active' }, // Add status field with a default value
    },
    { 
        strict: false, 
        timestamps: true // Automatically adds createdAt and updatedAt fields
    }
);

// Create the model
const ContentSheetData = mongoose.model('ContentSheet', contentSheetSchema);

module.exports = ContentSheetData;