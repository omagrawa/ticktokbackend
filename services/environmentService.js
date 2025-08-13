const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const EnvironmentVariable = require('../models/environmentVariableModel');

class EnvironmentService {
    constructor() {
        this.envPath = path.join(__dirname, '..', '.env');
    }

    /**
     * Read environment variables from .env file
     * @returns {Object} Parsed environment variables
     */
    readEnvFile() {
        try {
            if (!fs.existsSync(this.envPath)) {
                throw new Error('.env file not found');
            }
            
            const envConfig = dotenv.parse(fs.readFileSync(this.envPath));
            return envConfig;
        } catch (error) {
            console.error('Error reading .env file:', error);
            throw error;
        }
    }

    /**
     * Save environment variables to MongoDB
     * @param {Object} envVars - Environment variables to save
     * @returns {Promise<Object>} Result of the operation
     */
    async saveEnvironmentVariables(envVars) {
        try {
            const operations = Object.entries(envVars).map(([key, value]) => ({
                updateOne: {
                    filter: { key },
                    update: { 
                        $set: { 
                            value,
                            isSensitive: this.isSensitiveKey(key),
                            updatedAt: new Date()
                        },
                        $setOnInsert: { 
                            key,
                            createdAt: new Date()
                        }
                    },
                    upsert: true
                }
            }));

            if (operations.length === 0) {
                return { success: false, message: 'No environment variables to save' };
            }

            const result = await EnvironmentVariable.bulkWrite(operations, { ordered: false });
            return {
                success: true,
                message: 'Environment variables saved successfully',
                result: {
                    upsertedCount: result.upsertedCount || 0,
                    modifiedCount: result.modifiedCount || 0,
                    totalProcessed: result.upsertedCount + result.modifiedCount || 0
                }
            };
        } catch (error) {
            console.error('Error saving environment variables:', error);
            throw error;
        }
    }

    /**
     * Check if a key is considered sensitive
     * @private
     */
    isSensitiveKey(key) {
        const sensitiveKeywords = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL'];
        return sensitiveKeywords.some(keyword => 
            key.toUpperCase().includes(keyword)
        );
    }

    /**
     * Get all environment variables from database
     * @returns {Promise<Array>} List of environment variables
     */
    async getAllEnvironmentVariables() {
        try {
            return await EnvironmentVariable.find({}).sort({ key: 1 }).lean();
        } catch (error) {
            console.error('Error fetching environment variables:', error);
            throw error;
        }
    }

    /**
     * Get a single environment variable by key
     * @param {string} key - Environment variable key
     * @returns {Promise<Object|null>} Environment variable or null if not found
     */
    async getEnvironmentVariable(key) {
        try {
            return await EnvironmentVariable.findOne({ key });
        } catch (error) {
            console.error(`Error fetching environment variable ${key}:`, error);
            throw error;
        }
    }

    /**
     * Update an existing environment variable
     * @param {string} id - The MongoDB _id of the variable to update
     * @param {string} value - New value for the variable
     * @returns {Promise<Object>} Updated environment variable
     */
    async updateEnvironmentVariable(id, value) {
        try {
            if (!id || !value) {
                throw new Error('ID and value are required');
            }

            const updatedVar = await EnvironmentVariable.findByIdAndUpdate(
                id,
                { 
                    value,
                    isSensitive: this.isSensitiveKey(value),
                    updatedAt: new Date()
                },
                { new: true, runValidators: true }
            );

            if (!updatedVar) {
                throw new Error('Environment variable not found');
            }

            return updatedVar;
        } catch (error) {
            console.error('Error updating environment variable:', error);
            throw error;
        }
    }
}

module.exports = new EnvironmentService();
