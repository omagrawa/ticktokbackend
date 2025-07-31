const { ApifyClient } = require('apify-client');
const Job = require('../models/jobModel');
const ScrapData = require('../models/scrapData');
const ProfileData = require('../models/profileModel');
const client = new ApifyClient({
    token: process.env.APIFY_API_KEY
});



exports.toktokScraper = async (query) => {
    try {
        // Run the Actor and wait for it to finish
        const run = await client.actor("clockworks/tiktok-scraper").call(query);

        // Fetch and print Actor results from the run's dataset (if any)
        console.log('Results from dataset');
        console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        // items.forEach((item) => {
        //     console.dir(item);
        // });

        return {
            message: 'Scraping completed successfully',
            data: items,
            runId: run.id,
            datasetId: run.defaultDatasetId
        }
    }
    catch (err) {
        console.error('Error in toktokScraper:', err);
        return {
            message: 'Scraping failed',
            error: err.message
        }
    }
}

exports.profileScraper = async (input) => {
    // Run the Actor and wait for it to finish
    try {
        const query = {
            "excludePinnedPosts": false,
            "profileScrapeSections": [
                "videos"
            ],
            "profileSorting": "latest",
            "profiles": input,
            "resultsPerPage": 10,
            "shouldDownloadAvatars": false,
            "shouldDownloadCovers": false,
            "shouldDownloadSlideshowImages": false,
            "shouldDownloadSubtitles": false,
            "shouldDownloadVideos": false
        }
        const run = await client.actor("clockworks/tiktok-profile-scraper").call(query)

        // Fetch and print Actor results from the run's dataset (if any)
        console.log('Results from dataset');
        console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        // items.forEach((item) => {
        //     console.dir(item);
        // });

        return {
            message: 'Scraping completed successfully',
            data: items,
            runId: run.id,
            datasetId: run.defaultDatasetId
        }
    }
    catch (err) {
        console.error('Error in profileScraper:', err);
        return {
            message: 'Scraping failed',
            error: err.message
        }
    }
}

exports.apifyMusicScrapper=async(input)=>{
    try{
        const query = {
            "excludePinnedPosts": false,
            "profileScrapeSections": [
                "videos"
            ],
            "profileSorting": "latest",
            "profiles": input,
            "resultsPerPage": 10,
            "shouldDownloadAvatars": false,
            "shouldDownloadCovers": false,
            "shouldDownloadSlideshowImages": false,
            "shouldDownloadSubtitles": false,
            "shouldDownloadVideos": false
        }
        const run = await client.actor("clockworks/tiktok-profile-scraper").call(query)

        // Fetch and print Actor results from the run's dataset (if any)
        console.log('Results from dataset');
        console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        items.forEach((item) => {
            console.dir(item);
        });

        return {
            message: 'Scraping completed successfully',
            data: items,
            runId: run.id,
            datasetId: run.defaultDatasetId
        }
    }
    catch(err){
        console.error('Error in profileScraper:', err);
        return {
            message: 'Scraping failed',
            error: err.message
        }
    }
}