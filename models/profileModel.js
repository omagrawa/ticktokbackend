const mongoose = require('mongoose');

// Create a dynamic schema with additional fields
const ProfileDataSchema = new mongoose.Schema(
    {
        status: { type: String, default: 'active' }, // Add status field with a default value
        jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true }, // Reference to the Job model
    },
    { 
        strict: false, 
        timestamps: true // Automatically adds createdAt and updatedAt fields
    }
);

const ProfileData = mongoose.model("ProfileData", ProfileDataSchema);

module.exports = ProfileData;