// const { ChatOpenAI } =require("@langchain/openai");
const axios = require("axios");
const fs = require("fs");
const {OpenAI} = require('openai');
const { parseFile } = require('music-metadata');
const parseMetadata = parseFile;
const path = require("path");
// videoDetect.js
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = path.join(__dirname, '../ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const EnvironmentVariable = require('../models/environmentVariableModel');

/**
 * Initializes the OpenAI LLM with LangChain and processes user input.
 * @param {string} userInput - The input text from the user.
 * @returns {Promise<string>} - The response from the LLM.
 */

async function processUserInput(userInput) {
    
    // const model = new ChatOpenAI({
    //     apiKey: process.env.OPENAI_API_KEY,
    //     temperature: 0.7,
    //     modelName: "gpt-4o-mini",
    //   });

      const envVar = await EnvironmentVariable.findOne({ key: 'OPENAI_API_KEY' }).exec();
      if (!envVar) {
        throw new Error('OPENAI_API_KEY environment variable not found in database');
      }
      const model = new OpenAI({
        apiKey: envVar.value, // This is the default and can be omitted
      });

    const message =[
        {
            role: 'system',
            content: 'You are a helpful assistant that provides information based on user queries.'
        },
        {
            role: 'user',
            content: userInput
        }   
    ]

    const completion = await model.chat.completions.create({
        model: 'gpt-4o-mini',
        messages:message
      });
      
      console.log(completion.choices[0].message.content);

    return completion.choices[0].message.content
}

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

async function processVoice(userInput) {
try{
    console.log("Processing voice input from file:", userInput);

    // Read metadata
    const metadata = await parseMetadata(userInput);
    console.log('Audio Metadata:', metadata.format);

    // Check format
    let finalFile = userInput;

    let istemp= false;
    if (!['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'].includes(metadata.format.container)) {
        console.log(`⚠️ Detected container: ${metadata.format.container} - converting to MP3...`);
        
        // Create temp mp3 file path
        const tempFile = path.join(
            path.dirname(userInput),
            `converted_${Date.now()}.mp3`
        );

        
        await new Promise((resolve, reject) => {
            ffmpeg(userInput)
                .audioCodec('libmp3lame')
                .audioQuality(2)
                .on('end', () => {
                    console.log(`✅ Conversion complete: ${tempFile}`);
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ FFmpeg error:', err);
                    reject(err);
                })
                .save(tempFile);
                istemp=true
        });

        finalFile = tempFile;
    }

    // Now create stream on final file
    const fileStream = fs.createReadStream(finalFile);
    console.log("📂 File stream created for:", finalFile);

    // OpenAI transcription
    const model = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const transcription = await model.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
        // language: "auto" // optional, let Whisper auto-detect
    });

    console.log("✅ Transcription result:", transcription);
    if(istemp) deleteFile(finalFile);

    const completion = await model.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `What language is this text written in? 
          
          Return the result as JSON with the format: 
          {
            "language": "<language name comma seperated>"
          }
          
          Here is the text:
          "${transcription.text}"`
        }
      ],
      response_format: { type: "json_object" }
    });
    
    const detectedLanguage = JSON.parse(completion.choices[0].message.content);
    
    console.log("detectedLanguage",detectedLanguage.language);
    // Return both detected language and transcription
    return {
        language: detectedLanguage.language|| null,
        text: transcription.text
    };

// return transcription.text;
    }
catch (error) {
    console.error("Error processing voice input:", error);
    throw error;
  }
}

async function processText(userInput) {
    try {
        console.log("Processing text input:");
            // Prepare the system prompt for the LLM
            const systemPrompt = `
            You are an expert social media analyst. Given a TikTok post's metadata, classify the post into a high-level category e.g., "Dance", "Comedy", "Education", "Music", "Fashion", "Fitness", "Food", "Travel", "Animals", "Beauty", "Sports", "Gaming", "Technology" or any other category. 
            Return a JSON array of objects, each with "id" and "postCategory" fields. Only use the provided metadata for your decision.
            here is the output always followe this format:{
            result:
            [
                {
                    "id": "1234567890",
                    "postCategory": "Dance"
                }
    ]}
            `;

            const envVar = await EnvironmentVariable.findOne({ key: 'OPENAI_API_KEY' }).exec();
            if (!envVar) {
              throw new Error('OPENAI_API_KEY environment variable not found in database');
            }
        const model = new OpenAI({
            apiKey: envVar.value, // This is the default and can be omitted
          });

        // Compose the message for the LLM
        const llmMessages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userInput }
        ];
        const llmResponse = await model.chat.completions.create({
            model: 'gpt-4o-mini',
            messages:llmMessages,
            response_format: { type: "json_object" }
          });

          console.log(llmResponse.choices[0].message.content);

        return llmResponse.choices[0].message.content
    } catch (error) {
        console.error('Error calling LLM for post categorization:', error.message);
        throw new Error('Failed to classify posts with LLM');
    }
}

async function videoToneIdentifier(videoUri){
    const client = new videoIntelligence.VideoIntelligenceServiceClient();

    const request = {
      inputUri: videoUri, // OR use `inputContent` if local file (base64 encoded)
      features: ['SPEECH_TRANSCRIPTION', 'LABEL_DETECTION'],
      videoContext: {
        speechTranscriptionConfig: {
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
        },
      },
    };
  
    console.log('Processing video...');
    const [operation] = await client.annotateVideo(request);
    const [response] = await operation.promise();
    console.log('Processing complete.\n');
  
    const annotationResults = response.annotationResults[0];
  
    // Speech Transcription Output
    if (annotationResults.speechTranscriptions.length > 0) {
      console.log('🗣️ Speech Detected:');
      annotationResults.speechTranscriptions.forEach((transcription, i) => {
        const alt = transcription.alternatives[0];
        console.log(`  [${i}] ${alt.transcript}`);
      });
    } else {
      console.log('❌ No speech detected.');
    }
  
    // Label Detection Output (may include music, singing, etc.)
    console.log('\n🔎 Labels Detected:');
    annotationResults.segmentLabelAnnotations.forEach(label => {
      console.log(`  Label: ${label.entity.description}`);
      label.segments.forEach(segment => {
        const start = segment.segment.startTimeOffset.seconds || 0;
        const end = segment.segment.endTimeOffset.seconds || 0;
        console.log(`    Duration: ${start}s to ${end}s`);
      });
    });
}

async function profileBioIdentifier(bio){
    try{

      // Prepare the system prompt for the LLM
      const systemPrompt = `
      You are an expert social media analyst. 
      Given a TikTok profile's bio, classify the profile into a high-level category e.g., "Dance", "Comedy", "Education", "Music", "Fashion", "Fitness", "Food", "Travel", "Animals", "Beauty", "Sports", "Gaming", "Technology" or any other category. 

      Extract the contact deatils if avaiable in the provided text . 

      Return a JSON array of objects, each with "id" , "creator type" and "contact details" fields. Only use the provided metadata for your decision.
      here is the output always followe this format:{
      result:
          {
              "creatorType": "Dance",
              "contactDetails": {
                "email":<comma seperate in came multiple else empty >
                "mobile":<comma seperate in came multiple else empty >
                "other ":<comma seperate in came multiple with type and details else empty >
              }
          }
    
      rules :
        1.always follow same structure structure.
        2. if any field is empty then return same structure wuth empty strings.
      `;

      const envVar = await EnvironmentVariable.findOne({ key: 'OPENAI_API_KEY' }).exec();
      if (!envVar) {
        throw new Error('OPENAI_API_KEY environment variable not found in database');
      }
      const model = new OpenAI({
        apiKey: envVar.value, // This is the default and can be omitted
      });

    const message =[
        {
            role: 'system',
            content: systemPrompt
        },
        {
            role: 'user',
            content: bio
        }   
    ]

    const completion = await model.chat.completions.create({
        model: 'gpt-4o-mini',
        messages:message,
        response_format:{type:"json_object"}
      });
        
      console.log(completion.choices[0].message.content);
    return completion.choices[0].message.content
    }
    catch(error){
        console.error('Error calling LLM for profile bio categorization:', error.message);
        throw new Error('Failed to classify posts with LLM');
    }
}

// profileBioIdentifier("het")

module.exports = { processUserInput,processVoice,processText,videoToneIdentifier,profileBioIdentifier };