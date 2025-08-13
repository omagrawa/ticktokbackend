const environmentService = require('../services/environmentService');
const { validationResult } = require('express-validator');

/**
 * @desc    Save environment variables to database
 * @route   POST /api/environment/save
 * @access  Private/Admin
 */
exports.saveEnvironmentVariables = async (req, res) => {
    try {
        // Read environment variables from .env file
        const envVars = environmentService.readEnvFile();
        
        // Save to database
        const result = await environmentService.saveEnvironmentVariables(envVars);
        
        res.status(200).json({
            success: true,
            message: 'Environment variables saved successfully',
            data: result
        });
    } catch (error) {
        console.error('Error in saveEnvironmentVariables:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error saving environment variables',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

/**
 * @desc    Get all environment variables from database
 * @route   GET /api/environment
 * @access  Private/Admin
 */
exports.getEnvironmentVariables = async (req, res) => {
    try {
        const envVars = await environmentService.getAllEnvironmentVariables(); // <- key change

        const modifiedEnvVars = envVars.map(envVar => {
            const { value, ...rest } = envVar;
            if (value === '') {
                return { value: '', ...rest };
            } else {
                const words = value.split(' ');
                return {
                    value: `${words[0]} ${words[1] || ''}${words.length > 2 ? ' ***' : ''}`,
                    ...rest
                };
            }
        });

        res.status(200).json({
            success: true,
            count: modifiedEnvVars.length,
            data: modifiedEnvVars
        });
    } catch (error) {
        console.error('Error in getEnvironmentVariables:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching environment variables',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

/**
 * @desc    Update an environment variable by ID
 * @route   PUT /api/environment/:id
 * @access  Private/Admin
 */
exports.updateEnvironmentVariable = async (req, res) => {
    try {
        const { id } = req.params;
        const { value } = req.body;

        if (!value) {
            return res.status(400).json({
                success: false,
                message: 'Value is required'
            });
        }

        const updatedVar = await environmentService.updateEnvironmentVariable(id, value);
        
        res.status(200).json({
            success: true,
            message: 'Environment variable updated successfully',
            data: updatedVar
        });
    } catch (error) {
        console.error('Error in updateEnvironmentVariable:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error updating environment variable',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};

/**
 * @desc    Get a single environment variable by key
 * @route   GET /api/environment/:key
 * @access  Private/Admin
 */
exports.getEnvironmentVariable = async (req, res) => {
    try {
        const { key } = req.params;
        
        if (!key) {
            return res.status(400).json({
                success: false,
                message: 'Environment variable key is required'
            });
        }
        
        const envVar = await environmentService.getEnvironmentVariable(key);
        
        if (!envVar) {
            return res.status(404).json({
                success: false,
                message: `Environment variable '${key}' not found`
            });
        }
        
        res.status(200).json({
            success: true,
            data: envVar
        });
    } catch (error) {
        console.error('Error in getEnvironmentVariable:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching environment variable',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
};
