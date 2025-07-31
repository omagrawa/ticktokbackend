const mongoose = require('mongoose');

// Create a dynamic schema with additional fields
const jobSchema = new mongoose.Schema(
    {
        status: { type: String, default: 'active' }, // Add status field with a default value
    },
    { 
        strict: false, 
        timestamps: true // Automatically adds createdAt and updatedAt fields
    }
);

// Create the model
const Job = mongoose.model('Job', jobSchema);

module.exports = Job;