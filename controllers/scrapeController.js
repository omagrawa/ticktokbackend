const xlsx = require('xlsx');
const Job = require('../models/jobModel');
const ScrapData = require('../models/scrapData');
const ProfileData = require('../models/profileModel');
const CreatorSheetData = require('../models/creatorSheet');
const ContentSheetData = require('../models/contentSheet');
const mongoose = require('mongoose');
const fs = require('fs');
const { toktokScraper, profileScraper, } = require('../services/apifyService');
const Joi = require('joi');
const axios = require('axios');
const ISO6391 = require('iso-639-1');
const { processUserInput, processVoice, processText, videoToneIdentifier, profileBioIdentifier } = require('../services/llmFile');
const { classifyAudio } = require('../services/audioClassifier')
const { getCountryGeoName } = require('../services/countryGeoName');

// Define the schema for Excel row validation
const excelRowSchema = Joi.object({
    'Hashtags': Joi.string().required().custom((value, helpers) => {
        const tags = value.split(',').map(tag => tag.trim());
        // if (tags.some(tag => !tag.startsWith('#'))) {
        //     return helpers.error('any.invalid');
        // }
        return value;
    }, 'hashtag validation').messages({
        'string.empty': 'Hashtags cannot be empty',
        'any.required': 'Hashtags are required',
        'any.invalid': 'Hashtags must start with # and be comma-separated'
    }),
    'Content_Type ': Joi.string().valid('Organic Post', 'ads').default('Organic Post'),
    'Language': Joi.string().optional().custom((value, helpers) => {
        // if (value && !ISO6391.validate(value)) {
        //     return helpers.error('any.invalid');
        // }
        return value;
    }, 'language validation').messages({
        'any.invalid': 'Invalid language code'
    }),
    'Time_Period(7,14,30)': Joi.number().integer().min(0).default(0),
    'Min_Views': Joi.number().integer().min(0).default(0),
    'Min_Likes': Joi.number().integer().min(0).default(0),
    'Min_Comments': Joi.number().integer().min(0).default(0),
    'Video_Length_(sec)': Joi.number().integer().min(0).default(0),
    'Min_Followers': Joi.number().integer().min(0).default(0),
    'Max_Followers': Joi.number().integer().min(0).default(0),
    'Number_of_Required_Results': Joi.number().integer().min(1).max(1000).default(10),
    'country': Joi.string().optional().allow(''),
    'Description_Keywords': Joi.string().optional().allow('')
}).unknown(true); // Allow additional fields

// Define the schema validator
const schema = Joi.object({
    jobId: Joi.string().pattern(/^[a-f0-9]{24}$/).required()
});

exports.scrapeController = async (req, res) => {
    try {
        if (!req?.body) throw new Error('Please provide a valid request body');
        const { error } = schema.validate(req?.body);
        // // Validate
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        // make this filter dynamic . 
        const queryPayload = {
            "hashtags": [
                "trending"
            ],
            resultsPerPage: 1,
            shouldDownloadVideos: false,
            shouldDownloadCovers: false,
            shouldDownloadSubtitles: false,
            shouldDownloadSlideshowImages: false,
            shouldDownloadAvatars: false,
            shouldDownloadMusicCovers: false,
            proxyCountryCode: "None",
        };

        const scrapDatas = await toktokScraper(queryPayload);
        // console.log('Scraping data:', scrapDatas);
        let enrichedData = [];
        if (scrapDatas.data.length > 0) {

            // perform the remaining filters here.

            // Add jobId to each item
            enrichedData = scrapDatas.data.map(item => ({
                ...item,
                apifyRunId: scrapDatas.runId, // Add runId from the response
                apifyDatasetId: scrapDatas.datasetId, // Add datasetId from the response
                jobId: req.body.jobId // Add jobId from the request body
            }))

            // Save this data to the database
            const jobDetails = await ScrapData.insertMany(enrichedData);

            const jobStatusUpdate = await Job.findByIdAndUpdate(req.body.jobId,
                { $set: { status: 'Completed', apifyRunId: scrapDatas.runId, apifyDatasetId: scrapDatas.datasetId } },
                { new: true, runValidators: true }
            );
        }

        res.status(200).json({
            message: 'Scraping Completed successfully',
            runId: scrapDatas.runId,
            datasetId: scrapDatas.datasetId
        });
    }
    catch (err) {
        console.error('Error in scrapeController:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
};

async function profileDataFunction(profile) {
    let profileString = `${profile.signature} ${profile.bioLink}`
    const bioIdentifier = {
        creatorType: "",
        email: "",
        mobile: "",
        other: ""
    };
    try {
        let response = await profileBioIdentifier(profileString);
        response = JSON.parse(response)
        bioIdentifier.creatorType = response?.result?.creatorType || '';
        bioIdentifier.email = response?.result?.contactDetails?.email || '';
        bioIdentifier.mobile = response?.result?.contactDetails?.mobile || '';
        bioIdentifier.other = response?.result?.contactDetails?.other || '';

        // console.log(bioIdentifier)

        return bioIdentifier
    }
    catch (error) {
        console.error('Error identifying profile bio:', error);
    }
}

// code to fetch the profile from the apify profile scrapper 
async function profileScrapperFunction(jobId, jobData) {
    try {
        // console.log("*************", jobData)
        // get the array of the data of videos. 
        const profileIds = [...new Set(jobData.map(item => item.authorMeta.name))];
        // get job data
        // const scrapData = await ScrapData.find({jobId: jobId});
        // console.log('Job Data:', profileIds);
        // await Job.findByIdAndUpdate(jobId,
        //     { $set: { status: 'Profile Scrapper Active', creatorStatus: "Active" } },
        //     { new: true, runValidators: true }
        // );

        const profileData = await profileScraper(profileIds);


        const filterData = profileData.data.reduce((acc, profile) => {
            const author = profile.authorMeta;

            // Defensive checks
            if (!author || !author.fans || author.fans === 0) return acc;

            // Initialize user's data if not present
            if (!acc[author.name]) {
                acc[author.name] = {
                    username: author.name,
                    fans: author.fans,
                    profileUrl: author.profileUrl,
                    avatar: author.avatar,
                    nickName: author.nickName,
                    verified: author.verified,
                    signature: author.signature,
                    bioLink: author.bioLink,
                    originalAvatarUrl: author.originalAvatarUrl,
                    privateAccount: author.privateAccount,
                    following: author.following,
                    friends: author.friends,
                    heart: author.heart,
                    video: author.video,
                    digg: author.digg,
                    jobId: jobId,
                    runId: profileData.runId,
                    datasetId: profileData.datasetId,
                    posts: [],
                    language: profile.textLanguage
                };
            }

            // Collect this post
            acc[author.name].posts.push({
                diggCount: profile.diggCount || 0,
                commentCount: profile.commentCount || 0,
                createTimeISO: profile.createTimeISO
            });

            return acc;
        }, {});

        // Now compute aggregated metrics and build final array
        const result = Object.values(filterData).map(user => {
            // Sort posts by createTimeISO descending if needed
            const sortedPosts = user.posts.sort((a, b) => new Date(b.createTimeISO) - new Date(a.createTimeISO));

            // Limit to last N posts (from original 'lookBackPosts')
            const lookBackPosts = user.video || sortedPosts.length;
            const recentPosts = sortedPosts.slice(0, lookBackPosts);

            const avgLikes = recentPosts.length > 1 ? recentPosts.reduce((sum, p) => sum + p.diggCount, 0) / recentPosts.length : recentPosts[0]?.diggCount || 0;
            const avgComments = recentPosts.length > 1 ? recentPosts.reduce((sum, p) => sum + p.commentCount, 0) / recentPosts.length : recentPosts[0]?.commentCount || 0;
            const engagementRate = ((avgLikes + avgComments) / user.fans) * 100;
            const lastPostTimestamp = recentPosts[0]?.createTimeISO;

            return {
                ...user,
                avgLikes: Number(avgLikes.toFixed(2)),
                avgComments: Number(avgComments.toFixed(2)),
                engagementRate: Number(engagementRate.toFixed(2)),
                lastPostTimestamp
            };
        });
        // console.log(result)

        // get the connectoin details from profile bio . pass to llm to extract the details . 
        // 
        // loop through each profile and extract the contact details from the bio
        for (const profile of result) {
            let bioIdentifier;
            try {
                // let profileString = `${profile.signature} ${profile.bioLink}`
                bioIdentifier = await profileDataFunction(profile);
            } catch (error) {
                console.error('Error identifying profile bio:', error);
            }
            // save the result details back to the object to save in db
            profile.creatorType = bioIdentifier.creatorType
            profile.email = bioIdentifier.email
            profile.mobile = bioIdentifier.mobile
            profile.other = bioIdentifier.other
        }

        // Save this data to the database
        const jobDetails = await ProfileData.insertMany(result);
        if (jobDetails.error) {
            throw new Error(jobDetails.error);
        }
        // console.log(profileData) 
        // const n8nFlowUrl = `${process.env.WORKFLOW_URL_CREATOR}?jobId=${profileData.runId}`;
        // console.log('Calling n8n flow at URL:', n8nFlowUrl);
        try {
            // const response = await axios.get(n8nFlowUrl);
            // console.log('n8n Flow Response:', response.data);
            // await Job.findByIdAndUpdate(jobId,
            //     { $set: { creatorSheetUrl: response.data.url, status: 'Completed', creatorStatus: "Completed" } },
            //     { new: true, runValidators: true }
            // );
        } catch (error) {
            console.error('Error calling n8n flow:', error.message);
            throw new Error('Failed to trigger n8n flow');

        }
        return result;

    } catch (error) {
        console.error('Error in profileScrapper:', error);
        await Job.findByIdAndUpdate(jobId,
            { $set: { status: 'Profile Scrapper Failed', creatorStatus: "Failed", failedMessage: error.message } },
            { new: true, runValidators: true }
        );
        return null;
    }
}

/**
 * Creates an enriched dataset of creator information
 * @param {Array} profiles - Array of profile data from profileScrapper
 * @param {Array} videoData - Array of video data
 * @returns {Array} Enriched creator dataset
 */
const createEnrichedCreatorDataset = (profiles, videoData) => {
    if (!Array.isArray(profiles) || !Array.isArray(videoData)) {
        console.error('Invalid input data for creator dataset');
        return [];
    }

    return profiles.map(profile => {
        // Get all videos for this creator
        const creatorVideos = videoData.filter(video =>
            video['Creator Name']?.toLowerCase() === (profile.nickName || profile.username)?.toLowerCase()
        );

        // Helper function to safely parse numbers from formatted strings (e.g., "1,234" -> 1234)
        const parseNumber = (str) => {
            if (typeof str === 'number') return str;
            if (typeof str !== 'string') return 0;
            return parseInt(str.replace(/,/g, '')) || 0;
        };

        // Calculate average likes and comments
        const avgLikes = creatorVideos.length > 0
            ? creatorVideos.reduce((sum, video) => sum + parseNumber(video.Likes), 0) / creatorVideos.length
            : 0;

        const avgComments = creatorVideos.length > 0
            ? creatorVideos.reduce((sum, video) => sum + parseNumber(video.Comments), 0) / creatorVideos.length
            : 0;

        // Find most recent post
        const latestPost = creatorVideos.length > 0
            ? creatorVideos.sort((a, b) => new Date(b['Upload Date']) - new Date(a['Upload Date']))[0]
            : null;

        // Find top video by views
        const topVideo = creatorVideos.length > 0
            ? creatorVideos.sort((a, b) => parseNumber(b.Views) - parseNumber(a.Views))[0]
            : null;

        // Extract email and phone from profile signature/bio
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const phoneRegex = /(\+\d{1,3}[- ]?)?\d{10}/g;
        const { email, mobile, other } = profile;

        // Format follower count
        const formatFollowerCount = (count) => {
            if (!count) return '0';
            if (typeof count === 'number') return count.toLocaleString();
            return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        };

        return {
            'Profile Picture': profile.originalAvatarUrl || profile.avatar || '',
            'Creator Name': profile.nickName || profile.username || '',
            'Creator Handle': `@${profile.username || ''}`,
            'Creator Profile Link': profile.profileUrl || '',
            'Creator Email': email || '',
            'Creator Phone Number': mobile || '',
            'Creator Other Contact Info': other || '',
            'Platform': 'TikTok',
            'Location': profile.location || '',
            'Language': profile.language || '',
            'Follower Count': formatFollowerCount(profile.fans),
            'Engagement Rate (%)': profile.engagementRate ? Number(profile.engagementRate).toFixed(2) : '0.00',
            'Average Likes': Math.round(avgLikes).toLocaleString(),
            'Average Comments': Math.round(avgComments).toLocaleString(),
            'Last Post (Date)': latestPost ? latestPost['Upload Date'] : '',
            'Link in Bio': profile.bioLink || '',
            'Contactable?': (email || mobile || other) ? 'Yes' : 'No',
            'Linked Platforms': profile.linkedPlatforms ? (Array.isArray(profile.linkedPlatforms) ? profile.linkedPlatforms.join('+') : profile.linkedPlatforms) : '',
            'Profile Description': profile.signature || '',
            'Top Video Link': topVideo ? topVideo['Video Link'] : '',
            'Top Video Views': topVideo ? formatFollowerCount(topVideo.Views) : '0',
            'Category (Internal)': profile.creatorType || ''
        };
    });
};

// Helper function to delete a file
const deleteFile = (filePath) => {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`Error deleting file at ${filePath}:`, err);
        } else {
            console.log(`File at ${filePath} successfully deleted.`);
        }
    });
};

// Helper function to chunk array into batches of given size
function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

// function for internal call of the apify service
const scrapeControllerFunction = async (jobId, filters, agents) => {
    try {
        // console.log("0")
        // Extract filters from the input
        const {
            Hashtags = [],
            'Content_Type': contentType,
            Language: language,
            'Time_Period(7,14,30)': timePeriod = 0,
            'Min_Views': minViews,
            'Min_Likes': minLikes,
            'Min_Comments': minComments,
            'Video_Length_(sec)': videoLength,
            'Min_Followers': minFollowers,
            'Max_Followers': maxFollowers,
            'Number_of_Required_Results': totalResult = 10,
            country: country = '',
            Description_Keywords: Description_Keywords = ''
        } = filters;

        const hshData = Hashtags.split(',').map(tag => tag.trim())

        // console.log("1")
        // result per page give the results per hashtag , for if user required 50 and there are 2 hastag then it will give 100 result. to 
        // fiox this we user this formaula Math.ceil((totalResult+(totalResult/100)*50)/hshData.length),
        // Prepare the query payload for the Apify API call
        const queryPayload = {
            hashtags: hshData,
            resultsPerPage: Math.ceil((totalResult + (totalResult / 100) * 50) / hshData.length),
            scrapeRelatedVideos: false,
            shouldDownloadAvatars: false,
            shouldDownloadCovers: false,
            shouldDownloadMusicCovers: false,
            shouldDownloadSlideshowImages: false,
            shouldDownloadSubtitles: false,
            shouldDownloadVideos: false
        };
        if (timePeriod > 0) {
            const timePeriodInDays = parseInt(timePeriod);
            // console.log('Time Period in Days:', timePeriodInDays);
            queryPayload.oldestPostDateUnified = `${timePeriodInDays} days`;
        } else if (minLikes > 0) {
            queryPayload.leastDiggs = minLikes;
        }

        let countryData = null;
        if (country && country != '') {
            countryData = await getCountryGeoName(country);
            // console.log('Country Data:', countryData);
        }
        if (Description_Keywords && Description_Keywords != '') {
            queryPayload.searchQueries = Description_Keywords.split(',').map(tag => tag.trim());
            queryPayload.searchSection = "/video";
        }
        // console.log("2")
        // console.log('Query Payload:', queryPayload);
        let update = {};
        if(agents.toLowerCase() === 'creator'){
            update={ $set: { creatorStatus: "Active", contentStatus: 'Not Active' } }
        }else if(agents.toLowerCase() === 'content'){
            update={ $set: { creatorStatus: "Not Active", contentStatus: 'Active' } }
        }else{
            update={ $set: { creatorStatus: "Not Active", contentStatus: 'Active' } }
        }
          await Job.findByIdAndUpdate(jobId,
                    update,
                    { new: true, runValidators: true }
                );
        // Call the Apify scraper service
        const scrapDatas = await toktokScraper(queryPayload);
        if (scrapDatas.error) {
            throw new Error(scrapDatas.error);
        }

        let enrichedData = [];
        let output = [];
        // console.log('Scraping data:', scrapDatas.data.length);
        // language filter and 

        // console.log("scrapDatas",scrapDatas);
        if (scrapDatas.data.length > 0) {
            // Perform additional filtering on the returned data
            const filteredData = scrapDatas.data.filter(item => {
                const languageFilter = language
                    ? language?.split(',')
                        .map(l => ISO6391.getCode(l.trim()))
                        .filter(Boolean)
                    : [];
                const isLanguageMatch = languageFilter.length > 0
                    ? languageFilter.includes(item.textLanguage.toLowerCase())
                    : true;

                let isCountryMatch = true;
                if (country && country.length > 0) {
                    // const countryData =countryData
                    if (countryData && item?.locationMeta) {
                        isCountryMatch = item.locationMeta.countryCode === countryData.countryId;
                    }
                    else {
                        isCountryMatch = false
                    }
                }

                return (minViews > 0 ? item.playCount >= minViews : true) &&
                    (minComments > 0 ? item.commentCount >= minComments : true) &&
                    (videoLength > 0 ? item.videoMeta.duration <= videoLength : true) &&
                    (minFollowers > 0 ? item.authorMeta.fans >= minFollowers : true) &&
                    (maxFollowers > 0 ? item.authorMeta.fans <= maxFollowers : true) &&
                    (timePeriod > 0 ?
                        (timePeriod === '7' ? item.createTime * 1000 >= Date.now() - 7 * 24 * 60 * 60 * 1000 :
                            timePeriod === '14' ? item.createTime * 1000 >= Date.now() - 14 * 24 * 60 * 60 * 1000 :
                                timePeriod === '30' ? item.createTime * 1000 >= Date.now() - 30 * 24 * 60 * 60 * 1000 :
                                    true) // Default to true if no valid timePeriod is provided
                        : (minLikes > 0 ? item.diggCount >= minLikes : true)) &&
                    (contentType === 'Organic Post' ? item.isAd === false : true) && // Filter for Organic Post
                    isLanguageMatch && // Apply language filter
                    isCountryMatch; // Apply country filter
            });


            // console.log('Filtered Data:', filteredData);
            // Add jobId and Apify metadata to each item
            enrichedData = filteredData.map(item => ({
                ...item,
                apifyRunId: scrapDatas.runId, // Add runId from the response
                apifyDatasetId: scrapDatas.datasetId, // Add datasetId from the response
                jobId: jobId // Add jobId from the request body
            }));

            // console.log('Enriched Data:', enrichedData.length);

            // loop through enrichedData and download the audio file to pass to whisper for tome analysis
            for (const item of enrichedData) {
                if (item.musicMeta && item.musicMeta.playUrl) {
                    const audioUrl = item.musicMeta.playUrl;
                    const audioFileName = `${item.musicMeta.musicId}.mp3`;
                    const audioDir = './audio';
                    const audioFilePath = `${audioDir}/${audioFileName}`;

                    // Ensure the audio directory exists
                    if (!fs.existsSync(audioDir)) {
                        fs.mkdirSync(audioDir, { recursive: true });
                    }

                    const reqData = {
                        method: 'get',
                        url: audioUrl,
                        responseType: 'stream'
                    }
                    // console.log('Downloading audio file:', audioFilePath);
                    // Download the audio file
                    try {
                        const response = await axios(reqData);

                        // Save the audio file
                        const writer = fs.createWriteStream(audioFilePath);
                        response.data.pipe(writer);

                        try {
                            // Wait for the download to finish
                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });
                        }
                        catch (error) {
                            console.error('Error downloading audio file:', error);
                        }
                        // Process the audio file with Whisper
                        const transcription = await classifyAudio(audioFilePath);
                        item.audioType = transcription;

                        // console.log("transcription", transcription);

                        // Call the OpenAI Whisper mode configured in llmFile to detect the language of the audio

                        try {
                            const language = await processVoice(audioFilePath);

                            // console.log(language)
                            item.audioLanguage = language.language;
                            item.audioText = language.text;
                        } catch (err) {
                            console.error('Error detecting audio language with Whisper:', err);
                            item.audioLanguage = null;
                            item.audioText = null;
                        }
                    } catch (error) {
                        console.error('Error downloading audio file:', error);
                        // Skip this item and continue with the next one
                        continue;
                    }
                    deleteFile(audioFilePath);

                }
                // console.log("item", item);

                // Delete the audio file after processing


            }

            // console.log("Enriched Data*********:", enrichedData)
            // Prepare the array of objects to send to the LLM
            const llmInputData = enrichedData.map(item => ({
                id: item.id || item._id || (item.musicMeta && item.musicMeta.musicId) || null,
                caption: item.text || item.caption || "",
                hashtags: item.hashtags || [],
                mentions: item.mentions || [],
                music: item.musicMeta ? {
                    name: item.musicMeta.musicName || "",
                    author: item.musicMeta.musicAuthor || "",
                    original: item.musicMeta.original || false
                } : {},
                author: item.authorMeta ? {
                    username: item.authorMeta.name || "",
                    bio: item.authorMeta.bio || "",
                    fans: item.authorMeta.fans || 0
                } : {},
                video: item.videoMeta ? {
                    duration: item.videoMeta.duration || 0,
                    isSlideshow: item.videoMeta.isSlideshow || false
                } : {},
                engagement: {
                    likes: item.diggCount || 0,
                    shares: item.shareCount || 0,
                    comments: item.commentCount || 0,
                    plays: item.playCount || 0
                }
            }));

            // Split the data into batches of 10
            const batches = chunkArray(llmInputData, 10);

            let allCategories = [];

            for (const batch of batches) {

                // Call the LLM (replace with your actual LLM API call)
                let llmResponse = await processText(`Classify the following TikTok posts:\n${JSON.stringify(batch, null, 2)}`)

                // Parse the LLM response
                let llmCategories = [];
                try {
                    if (llmResponse) {
                        llmCategories = JSON.parse(llmResponse);
                    }
                } catch (err) {
                    console.error('Error parsing LLM response:', err);
                    throw new Error('Failed to parse LLM response');
                }

                // console.log("LLM Categories:", llmCategories);
                // Collect all categories
                if (Array.isArray(llmCategories.result)) {
                    allCategories = allCategories.concat(llmCategories.result);
                }
                // console.log("All llm categories:", llmCategories.result);

            }

            // console.log("All Categories:", allCategories);

            // Add the postCategory to the corresponding enrichedData item
            if (Array.isArray(allCategories)) {
                for (const catObj of allCategories) {
                    const idx = enrichedData.findIndex(item =>
                        (item.id == catObj.id)
                    );
                    if (idx !== -1) {
                        enrichedData[idx].postCategory = catObj.postCategory;
                    }
                }
            }

            // console.log("Enriched Data:", enrichedData);

            // Save this data to the database
            const jobDetails = await ScrapData.insertMany(enrichedData);

            // Update the job status in the database
            await Job.findByIdAndUpdate(jobId,
                { $set: { apifyRunId: scrapDatas.runId, apifyDatasetId: scrapDatas.datasetId, tatalDataCount: scrapDatas.data.length, afterFilterdataCount: enrichedData.length } },
                { new: true, runValidators: true }
            );

            // console.log("enrichedData",enrichedData);
            // Map enrichedData to requested output format

            // console.log("output",output);

            // return output;

        }

        // console.log("output", output);

        // call n8n flow for excel .

        // Make an Axios call to the localhost URL with jobId as a query parameter
        // const n8nFlowUrl = `${process.env.WORKFLOW_URL}?jobId=${scrapDatas.runId}`;

        // call the profile scrapper function here . 
        if (enrichedData.length > 0) {
            if (agents.toLowerCase() === 'creator') {
                // console.log("Calling profile scrapper function");
                await Job.findByIdAndUpdate(jobId,
                    { $set: { status: 'Profile Scrapper Active', creatorStatus: "Active" } },
                    { new: true, runValidators: true }
                );
            }
            else if (agents.toLowerCase() === 'content') {
                // console.log("Calling profile scrapper function");
                await Job.findByIdAndUpdate(jobId,
                    { $set: { status: 'Content Scrapper Active', creatorStatus: "Not Active" } },
                    { new: true, runValidators: true }
                );
            } else {
                // console.log("Calling profile scrapper function");
                await Job.findByIdAndUpdate(jobId,
                    { $set: { status: 'Content Scrapper Active', creatorStatus: "Not Active" } },
                    { new: true, runValidators: true }  )
        }
            // await Job.findByIdAndUpdate(jobId,
            //     { $set: { sheetUrl: "", status: 'Content Scrapped', creatorStatus: "Not Active" } },
            //     { new: true, runValidators: true }
            // );
            const profileScrapperData = await profileScrapperFunction(jobId, enrichedData)

            output = enrichedData.map(item => {
                // Extract caption languages from subtitleLinks
                let captionLanguages = '';
                if (item.videoMeta && Array.isArray(item.videoMeta.subtitleLinks)) {
                    captionLanguages = item.videoMeta.subtitleLinks.map(s => s.language).filter(Boolean).join(', ');
                }
                // Format upload date
                let uploadDate = '';
                if (item.createTime) {
                    const d = new Date(item.createTime * 1000);
                    uploadDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                }
                // Format numbers with commas
                const formatNum = n => n !== undefined && n !== null ? n.toLocaleString() : '';

                // console.log("item", item);
                return {
                    Thumbnail: item.videoMeta.coverUrl ? item.videoMeta.coverUrl : '',
                    'Video Link': item.webVideoUrl || '',
                    Platform: 'TikTok',
                    'Content Type': item.isAd ? 'Ad' : 'Organic',
                    'Upload Date': uploadDate,
                    'Video Duration (sec)': item.videoMeta.duration ? item.videoMeta.duration : '',
                    'Language (Audio)': item.audioLanguage || '',
                    'Language (Caption)': captionLanguages || 'n/a',
                    Caption: item.text || item.caption || '',
                    Hashtags: Array.isArray(item.hashtags)
                        ? item.hashtags.map(h => typeof h === 'object' && h !== null && h.name ? h.name : String(h)).join(' ')
                        : '',
                    'Trending Sound (Yes/No)': (item.musicMeta && item.musicMeta.trending) ? 'Yes' : 'No',
                    'Sound Name': item.musicMeta && item.musicMeta.musicName ? item.musicMeta.musicName : '',
                    'Sound Type (Talking/Music/etc.)': item.audioType || '',
                    'Location (if identifiable)': item.locationMeta && item.locationMeta.city ? item.locationMeta.city : '',
                    'Content Style (AI)': item.postCategory || '',
                    'CTA detected? (Yes/No)': item.ctaDetected ? 'Yes' : 'No',
                    // The following fields are mapped based on the correct creator profile returned from the profile scrapper
                    // Find the matching profile for this item by username (authorMeta.name)
                    ...(function () {
                        let profile = null;
                        if (Array.isArray(profileScrapperData)) {
                            // Try to match by authorMeta.name (case-insensitive)
                            const username = item.authorMeta && item.authorMeta.name ? item.authorMeta.name.toLowerCase() : '';
                            profile = profileScrapperData.find(p =>
                                (p.username && p.username.toLowerCase() === username) ||
                                (p.nickName && p.nickName.toLowerCase() === username)
                            );
                        }
                        return {
                            'Engagement Rate (%)': profile && profile.engagementRate ? Number(profile.engagementRate).toFixed(2) : '',
                            Views: formatNum(item.playCount),
                            Likes: formatNum(item.diggCount),
                            Comments: formatNum(item.commentCount),
                            Shares: formatNum(item.shareCount),
                            // Saves: formatNum(item.saveCount),
                            'Creator Name': profile && profile.nickName ? profile.nickName : (profile && profile.username ? profile.username : ''),
                            'Creator Profile Link': profile && profile.profileUrl ? profile.profileUrl : '',
                            'Creator Email': profile && profile.email ? profile.email : '',
                            'Follower Count': profile && profile.fans ? formatNum(profile.fans) : '',
                            'Usable for campaign?': item.usableForCampaign ? 'Yes' : 'No',
                            'Internal Category': profile.creatorType || '',
                            'Spoken Script': item.audioText || '',
                        };
                    })(),
                };
            });

            // Create enriched creator dataset
            let creatorDataset=[]
            // if(agents.toLowerCase() === 'creator' || agents.toLowerCase() === 'both'){
                creatorDataset = await createEnrichedCreatorDataset(profileScrapperData, output);
            // }

            try {

                // new content url 
                const newUrl = `${process.env.WORKFLOW_NEW_DATA}?jobId=${jobId}`;

                // save the  data into the table for the creator sheet . 
                const enrichedOutput = output.map(item => ({ ...item, jobId }));
                await ContentSheetData.insertMany(enrichedOutput);

                // Ensure output is properly stringified for transmission
                const response = await axios.post(newUrl, JSON.stringify(output), {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                // console.log("response new flow", response.data.url);
                // console.log('Calling n8n flow at URL:', n8nFlowUrl);

                if(agents.toLowerCase() === 'content' || agents.toLowerCase() === 'both'){

                await Job.findByIdAndUpdate(jobId,
                    { $set: { finalSheetUrl: response.data.url, status: 'Completed', contentStatus: 'Completed', } },
                    { new: true, runValidators: true }
                );
            }

            const enrichedCreatorDataset = creatorDataset.map(item => ({ ...item, jobId }));
                // console.log("creatorDataset", creatorDataset);
             await CreatorSheetData.insertMany(enrichedCreatorDataset);

                // new creator agent url 
                if(agents.toLowerCase() === 'creator' || agents.toLowerCase() === 'both'){
                    
                const newUrlCreator = `${process.env.WORKFLOW_CREATOR}?jobId=${jobId}`;
                const responseCreator = await axios.post(newUrlCreator, JSON.stringify(creatorDataset), {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                // console.log("response new flow", response.data);
                // console.log('Calling n8n flow at URL:', responseCreator.data.url);
                if(agents.toLowerCase() === 'creator' || agents.toLowerCase() === 'both') {
                await Job.findByIdAndUpdate(jobId,
                    { $set: { creatorSheetUrl: responseCreator.data.url, status: 'Completed', creatorStatus: "Completed" } },
                    { new: true, runValidators: true }
                );
                }
            }
            }
            catch (err) {
                console.log("error", err);
            }

            // commenting out this as this is of no user
            // try {
            //     const response = await axios.get(n8nFlowUrl);
            //     console.log('n8n Flow Response:', response.data);
            //     await Job.findByIdAndUpdate(jobId,
            //         { $set: { sheetUrl: response.data.url, status: 'Completed', } },
            //         { new: true, runValidators: true }
            //     );
            // } catch (error) {
            //     console.error('Error calling n8n flow:', error.message);
            //     throw new Error('Failed to trigger n8n flow');
            // }

            console.log("finsish")
        } else {
            await Job.findByIdAndUpdate(jobId,
                { $set: { sheetUrl: "", status: 'Content Scrapper Completed', contentStatus: 'Completed', creatorStatus: "Not Active" } },
                { new: true, runValidators: true }
            );

            console.log("No data found to process")
        }
        return 0;
    } catch (err) {
        console.error('Error in scrapeControllerFunction:', err);
        if( agents.toLowerCase() === 'creator'){
            await Job.findByIdAndUpdate(jobId,
                { $set: { status: 'Profile Scrapper Failed', creatorStatus: "Failed", failedMessage: err.message } },
                { new: true, runValidators: true }
            );  
        }else if(agents.toLowerCase() === 'content'){
            await Job.findByIdAndUpdate(jobId,
                { $set: { status: 'Content Scrapper Failed', contentStatus: "Failed", failedMessage: err.message } },
                { new: true, runValidators: true }
            );
        }else{
            await Job.findByIdAndUpdate(jobId,
                { $set: { status: 'Scrapper Failed', contentStatus: "Failed", creatorStatus: "Failed", failedMessage: err.message } },
                { new: true, runValidators: true }
            );
        }
        // await Job.findByIdAndUpdate(jobId,
        //     { $set: { status: 'Failed', failedMessagge: err.message, contentStatus: 'Failed', creatorStatus: "Not Active" } },
        //     { new: true, runValidators: true }
        // );
        // throw new Error(err.message || 'Internal Server Error');
    }
};

exports.processExcelFile = async (req, res) => {
    const filePath = req.file?.path;
    // console.log("File Path:", filePath);
    if (!filePath) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    let agents='both';
    if(req.query.agent && (req.query.agent.toLowerCase() === 'creator' || req.query.agent.toLowerCase() === 'content')){
        agents=req.query.agent
    }

    try {
        // Read the Excel file
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        let sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (sheetData.length === 0) {
            return res.status(400).json({ message: 'No data found in the Excel file' });
        }

        // Validate each row in the Excel sheet
        const validationErrors = [];
        const validatedData = [];
        console.log("Validating Excel Data:", sheetData.length);
        // console.log("Sheet Data:", sheetData);
        // return 0

        for (let i = 0; i < sheetData.length; i++) {
            const row = sheetData[i];
            // console.log('Row:', row);
            const { error, value } = excelRowSchema.validate(row, { abortEarly: false });

            if (error) {
                validationErrors.push({
                    row: i + 2, // +2 because Excel is 1-indexed and we have a header row
                    errors: error.details.map(detail => ({
                        field: detail.context.key,
                        message: detail.message
                    }))
                });
            } else {
                validatedData.push({...value, agents});
            }
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({
                message: 'Validation errors in Excel file',
                errors: validationErrors
            });
        }

        // Save validated data to the database
        const jobDetails = await Job.insertMany(validatedData);

        // Process each validated row
        for (let i = 0; i < validatedData.length; i++) {
            // console.log("Processing row:", validatedData[i]);
            scrapeControllerFunction(jobDetails[i]._id, validatedData[i],agents);
            if(agents.toLowerCase() === 'creator'){
                await Job.findByIdAndUpdate(jobDetails[i]._id,
                    { $set: { creatorStatus: 'Active', contentStatus: 'Not Active' } },
                    { new: true, runValidators: true }
                );
            }else if(agents.toLowerCase() === 'content'){
                await Job.findByIdAndUpdate(jobDetails[i]._id,
                    { $set: { creatorStatus: 'Not Active', contentStatus: 'Active' } },
                    { new: true, runValidators: true }
                );
            }else{  
              await Job.findByIdAndUpdate(jobDetails[i]._id,
                    { $set: { creatorStatus: 'Active',contentStatus:'Active' } },
                    { new: true, runValidators: true }
                );
            }
        }

        res.status(200).json({
            message: 'Data successfully validated and processed. Please check the status in sonetime.',
            processedRows: validatedData.length,
            jobDetails
        });

        // Delete the uploaded file
        deleteFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error processing the Excel file', error });

        // Delete the uploaded file in case of an error
        if (filePath) deleteFile(filePath);
    }
};

exports.getJobData = async (req, res) => {
    try {

        // Fetch all job data from the database
        const jobs = await Job.find();

        // Respond with the job data
        res.status(200).json({ message: 'Job data retrieved successfully', jobs });

    } catch (error) {
        console.error('Error fetching job data:', error);
        res.status(500).json({ message: 'Error fetching job data', error });
    }
};

exports.deleteData = async (req, res) => {
    try {
        const { jobId } = req.query;
        if (!jobId) {
            return res.status(400).json({ message: 'jobId is required' });
        }

        // Delete from ScrapData (post scrapper collection)
        await ScrapData.deleteMany({ jobId });

        // Delete from ProfileData (profile scrapper collection)
        await ProfileData.deleteMany({ jobId });

        // Delete from Job (job collection)
        await Job.deleteOne({ _id: jobId });
        res.status(200).json({ message: 'Data deleted successfully for the given jobId' });
    } catch (err) {
        console.error('Error deleting data:', err);
        res.status(500).json({ message: 'Error deleting data', error: err.message });
    }
};

exports.creatorData=async(req,res)=>{
     const { jobId} = req.params;
     const sheetType= req.query.sheetType;
        if (!jobId && !sheetType) {
            return res.status(400).json({ message: 'jobId is required' });
        }
    try{
        const job = await Job.findById(jobId);

        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        console.log("job", job);
        // new implemetnation 
        if(job.status!='Failed' && sheetType && sheetType.toLowerCase() === 'creator'){
            await Job.findByIdAndUpdate(jobId,
                { $set: { status: 'Completed', creatorStatus: "Completed" ,agents:'Both' } },
                { new: true, runValidators: true }
            );
        }

        if(job.status!='Failed' && sheetType && sheetType.toLowerCase() === 'content'){ 
            await Job.findByIdAndUpdate(jobId,
                { $set: { status: 'Completed', contentStatus: "Completed" ,agents:'Both'} },
                { new: true, runValidators: true }
            );
        }
       
        // // Fetch ScrapData (post scrapper collection) and ProfileData (profile scrapper collection) where jobId is equal
        // const [enrichedData,profileScrapperData] = await Promise.all([
        //     ScrapData.find({ jobId }),
        //     ProfileData.find({ jobId })
        // ]);

        // if(profileScrapperData.length==0){
        //              await Job.findByIdAndUpdate(jobId,
        //             { $set: { status: 'Completed', creatorStatus: "Completed" } },
        //             { new: true, runValidators: true }
        //         );

        //     return res.status(200).json({ message: 'No Profile avaibale to scrap' });
        // }
        //  await Job.findByIdAndUpdate(jobId,
        //             { $set: { status: 'Completed', creatorStatus: "Active" } },
        //             { new: true, runValidators: true }
        //         );



        // let output=[]
        // // console.log(profileScrapperData,enrichedData)/
        // if (enrichedData.length > 0) {
        //     // await Job.findByIdAndUpdate(jobId,
        //     //     { $set: { sheetUrl: "", status: 'Content Scrapped', contentStatus: 'Completed', creatorStatus: "Not Active" } },
        //     //     { new: true, runValidators: true }
        //     // );
        //     // const profileScrapperData = await profileScrapperFunction(jobId, enrichedData)

        //     // console.log(enrichedData)

        //     output = enrichedData.map(item => {
        //         // Extract caption languages from subtitleLinks
        //         let captionLanguages = '';
        //         if (item.videoMeta && Array.isArray(item.videoMeta.subtitleLinks)) {
        //             captionLanguages = item.videoMeta.subtitleLinks.map(s => s.language).filter(Boolean).join(', ');
        //         }
        //         // Format upload date
        //         let uploadDate = '';
        //         if (item.createTime) {
        //             const d = new Date(item.createTime * 1000);
        //             uploadDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
        //         }
        //         // Format numbers with commas
        //         const formatNum = n => n !== undefined && n !== null ? n.toLocaleString() : '';

        //         // console.log("item", item);
        //         return {
        //             Thumbnail: item?.videoMeta?.coverUrl ? item.videoMeta.coverUrl : '',
        //             'Video Link': item.webVideoUrl || '',
        //             Platform: 'TikTok',
        //             'Content Type': item.isAd ? 'Ad' : 'Organic',
        //             'Upload Date': uploadDate,
        //             'Video Duration (sec)': item.videoMeta.duration ? item.videoMeta.duration : '',
        //             'Language (Audio)': item.audioLanguage || '',
        //             'Language (Caption)': captionLanguages || 'n/a',
        //             Caption: item.text || item.caption || '',
        //             Hashtags: Array.isArray(item.hashtags)
        //                 ? item.hashtags.map(h => typeof h === 'object' && h !== null && h.name ? h.name : String(h)).join(' ')
        //                 : '',
        //             'Trending Sound (Yes/No)': (item.musicMeta && item.musicMeta.trending) ? 'Yes' : 'No',
        //             'Sound Name': item.musicMeta && item.musicMeta.musicName ? item.musicMeta.musicName : '',
        //             'Sound Type (Talking/Music/etc.)': item.audioType || '',
        //             'Location (if identifiable)': item.locationMeta && item.locationMeta.city ? item.locationMeta.city : '',
        //             'Content Style (AI)': item.postCategory || '',
        //             'CTA detected? (Yes/No)': item.ctaDetected ? 'Yes' : 'No',
        //             // The following fields are mapped based on the correct creator profile returned from the profile scrapper
        //             // Find the matching profile for this item by username (authorMeta.name)
        //             ...(function () {
        //                 let profile = null;
        //                 if (Array.isArray(profileScrapperData)) {
        //                     // Try to match by authorMeta.name (case-insensitive)
        //                     const username = item.authorMeta && item.authorMeta.name ? item.authorMeta.name.toLowerCase() : '';
        //                     profile = profileScrapperData.find(p =>
        //                         (p.username && p.username.toLowerCase() === username) ||
        //                         (p.nickName && p.nickName.toLowerCase() === username)
        //                     );
        //                 }
        //                 return {
        //                     'Engagement Rate (%)': profile && profile.engagementRate ? Number(profile.engagementRate).toFixed(2) : '',
        //                     Views: formatNum(item.playCount),
        //                     Likes: formatNum(item.diggCount),
        //                     Comments: formatNum(item.commentCount),
        //                     Shares: formatNum(item.shareCount),
        //                     // Saves: formatNum(item.saveCount),
        //                     'Creator Name': profile && profile.nickName ? profile.nickName : (profile && profile.username ? profile.username : ''),
        //                     'Creator Profile Link': profile && profile.profileUrl ? profile.profileUrl : '',
        //                     'Creator Email': profile && profile.email ? profile.email : '',
        //                     'Follower Count': profile && profile.fans ? formatNum(profile.fans) : '',
        //                     'Usable for campaign?': item.usableForCampaign ? 'Yes' : 'No',
        //                     'Internal Category': profile.creatorType || '',
        //                     'Spoken Script': item.audioText || '',
        //                 };
        //             })(),
        //         };
        //     });
        // }
        // const creatorDataset = await createEnrichedCreatorDataset( profileScrapperData, output);

        // // console.log(creatorDataset);
        //             try {

        //         // console.log("creatorDataset", creatorDataset);

        //         // new creator agent url 
        //         const newUrlCreator = `${process.env.WORKFLOW_CREATOR}?jobId=${jobId}`;
        //         const responseCreator = await axios.post(newUrlCreator, JSON.stringify(creatorDataset), {
        //             headers: {
        //                 'Content-Type': 'application/json'
        //             }
        //         });

        //         // console.log("response new flow", response.data);
        //         // console.log('Calling n8n flow at URL:', responseCreator.data.url);
        //         await Job.findByIdAndUpdate(jobId,
        //             { $set: { creatorSheetUrl: responseCreator.data.url, status: 'Completed', creatorStatus: "Completed" } },
        //             { new: true, runValidators: true }
        //         );
        //     }
        //     catch (err) {
        //         console.log("error api call",err.message    );
        //          await Job.findByIdAndUpdate(jobId,
        //             { $set: { status: 'Completed', creatorStatus: "Failed",creatorErrorMessage:err.message } },
        //             { new: true, runValidators: true }
        //         );
        //     }
        res.status(200).json({ message: 'Success.' });
        
    }
    catch(err){
            console.log("error at final", err);
            res.json({err})
               await Job.findByIdAndUpdate(jobId,
                    { $set: { status: 'Completed', creatorStatus: "Failed",creatorErrorMessage:err.message } },
                    { new: true, runValidators: true }
                );
    }
}

exports.getSheetDataController = async (req, res) => {
    try {
        console.log("getSheet", req.query);
        const { jobId, sheetType } = req.query;
        console.log("jobId",  req.query.jobId);
        console.log("sheetType",  sheetType);
        const schema = Joi.object({
            jobId: Joi.string().required(),
            sheetType: Joi.string().valid('creator', 'content').required(),
        });

        const { error } = schema.validate(req.query);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        if (sheetType.toLowerCase() === 'creator') {
            const creatorSheet = await CreatorSheetData.find({ jobId: new mongoose.Types.ObjectId(jobId) });
            if (!creatorSheet || creatorSheet.length === 0) {
                return res.status(404).json({ message: 'No data found for the given Job ID' });
            }
            // Convert the creatorSheet documents to a plain JavaScript object array
            const creatorData = creatorSheet.map(doc => doc.toObject({ getters: true }));
            // Remove unneeded properties from the creatorData objects
            creatorData.forEach(data => {
                delete data._id;
                delete data.id;
                delete data.__v;
                delete data._status;
                delete data.createdAt;
                delete data.updatedAt;
                delete data.jobId;
            });
            // Create a new workbook with a single sheet
            const worksheet = xlsx.utils.json_to_sheet(creatorData);
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Creator Data');
            // Generate the Excel file buffer
            const file = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
            const filename = `Creator_Sheet_${jobId}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.send(file);
        } else if (sheetType.toLowerCase() === 'content') {
            const contentSheet = await ContentSheetData.find({ jobId: new mongoose.Types.ObjectId(jobId) });
            if (!contentSheet || contentSheet.length === 0) {
                return res.status(404).json({ message: 'No data found for the given Job ID' });
            }
            contentSheet.forEach(data => {
                delete data._id;
                delete data.id;
                delete data.__v;
                delete data.createdAt;
                delete data.updatedAt;
                delete data.jobId;
                delete data._doc;
                delete data.$isNew;
                delete data._status;
                delete data.$__;
                delete data['Spoken Script'];
            });
            // Create a new workbook with a single sheet
            const worksheet = xlsx.utils.json_to_sheet(contentSheet);
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Content Data');
            // Generate the Excel file buffer
            const file = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
            const filename = `Content_Sheet_${jobId}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
            res.send(file);
        } else {
            return res.status(400).json({ message: 'Sheet Type must be content or creator' });
        }
    } catch (error) {
        console.log('Error generating sheet:', error);
        res.status(500).json({ message: 'Error generating sheet', error });
    }
};
