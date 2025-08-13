const mongoose = require('mongoose');

const environmentVariableSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    value: {
        type: String,
        required: true
    },
    isSensitive: {
        type: Boolean,
        default: false
    },
    description: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update the updatedAt field on save
environmentVariableSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Create index on key for faster lookups
environmentVariableSchema.index({ key: 1 }, { unique: true });

const EnvironmentVariable = mongoose.model('EnvironmentVariable', environmentVariableSchema);

module.exports = EnvironmentVariable;
