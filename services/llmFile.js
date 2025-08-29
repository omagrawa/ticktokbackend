// const { ChatOpenAI } =require("@langchain/openai");
const axios = require("axios");
const fs = require("fs");
const { OpenAI } = require("openai");
const { parseFile } = require("music-metadata");
const parseMetadata = parseFile;
const path = require("path");
// videoDetect.js
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = path.join(__dirname, "../ffmpeg"); // you already ship a binary here
ffmpeg.setFfmpegPath(ffmpegPath);
const EnvironmentVariable = require("../models/environmentVariableModel");

/* -------------------------- small utils (no deps) ------------------------- */

function toMB(bytes) { return (bytes / 1048576).toFixed(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Simple 1-concurrency semaphore to prevent parallel audio work (OOM culprit)
let _locked = false;
const _waiters = [];
async function withLock(fn) {
  if (_locked) await new Promise(res => _waiters.push(res));
  _locked = true;
  try { return await fn(); }
  finally {
    _locked = false;
    const next = _waiters.shift();
    if (next) next();
  }
}

// Memory watchdog: throw if RSS near container cap
function assertHeadroom(headroomMB = 80) {
  const limitMB = Number(process.env.MEM_LIMIT_MB || 512); // set this env to your plan size
  const rssMB = process.memoryUsage().rss / 1048576;
  if (rssMB > limitMB - headroomMB) {
    throw new Error(`Low memory: rss=${rssMB.toFixed(1)}MB, limit≈${limitMB}MB`);
  }
}

function logMemory(label = "mem") {
  if (process.env.MEM_LOG !== "1") return;
  const m = process.memoryUsage();
  console.log(label, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, toMB(v) + "MB"])));
}

// Helper to delete a file (non-fatal)
const deleteFile = (filePath) => {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err) console.warn(`Delete failed ${filePath}:`, err.message);
    else console.log(`🧹 Deleted: ${filePath}`);
  });
};

// Pull OpenAI key once (avoid re-query spiky memory)
let _openAIApiKeyPromise = null;
async function getOpenAIKey() {
  if (_openAIApiKeyPromise) return _openAIApiKeyPromise;
  _openAIApiKeyPromise = (async () => {
    const envVar = await EnvironmentVariable.findOne({ key: "OPENAI_API_KEY" }).exec();
    if (!envVar) throw new Error("OPENAI_API_KEY not found in database");
    return envVar.value;
  })();
  return _openAIApiKeyPromise;
}

/* ------------------------------- LLM helpers ------------------------------ */

async function processUserInput(userInput) {
  const apiKey = await getOpenAIKey();
  const model = new OpenAI({ apiKey });

  const message = [
    { role: "system", content: "You are a helpful assistant that provides information based on user queries." },
    { role: "user", content: userInput },
  ];

  const completion = await model.chat.completions.create({
    model: "gpt-4o-mini",
    messages: message,
  });

  const out = completion.choices[0].message.content;
  console.log(out);
  return out;
}

/* --------------------------------- Voice --------------------------------- */

async function processVoice(userInput) {
  // Hard limits (tune as needed; no extra deps)
  const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 20 * 1024 * 1024); // 20MB
  const MAX_DURATION_S = Number(process.env.MAX_DURATION_S || 90); // 90s

  // Supported set (lowercase compare)
  const SUP = new Set(["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm"]);

  return withLock(async () => {
    let tempFile = null;
    let finalFile = userInput;

    try {
      console.log("Processing voice input from file:", userInput);
      assertHeadroom(); // early before any heavy work
      logMemory("before-meta");

      // File size guard (only if local path)
      try {
        const st = fs.statSync(userInput);
        if (st.size > MAX_FILE_BYTES) {
          throw new Error(`File too large: ${toMB(st.size)}MB > ${toMB(MAX_FILE_BYTES)}MB`);
        }
      } catch (e) {
        // ignore if not a local path or stat fails
      }

      // Read metadata
      const metadata = await parseMetadata(userInput).catch(() => ({ format: {} }));
      console.log("Audio Metadata:", metadata.format);

      const container = String(metadata?.format?.container || "").toLowerCase();
      const mime = String(metadata?.format?.mimeType || "").toLowerCase();
      const duration = Number(metadata?.format?.duration || 0);

      // Duration guard
      if (duration && MAX_DURATION_S && duration > MAX_DURATION_S) {
        throw new Error(`Audio too long: ${duration.toFixed(1)}s > ${MAX_DURATION_S}s`);
      }

      // Treat MPEG/MP3-ish mime as supported
      const isMpegish =
        mime.includes("audio/mpeg") || mime.includes("video/mp4") || mime.includes("audio/mp4");

      // Convert ONLY if truly unsupported (avoid MP3->MP3!)
      if (!SUP.has(container) && !isMpegish) {
        assertHeadroom();
        console.log(`⚠️ Unsupported container (${metadata.format.container || "unknown"}) → transcoding to MP3...`);
        tempFile = path.join(path.dirname(userInput), `converted_${Date.now()}.mp3`);

        await new Promise((resolve, reject) => {
          ffmpeg(userInput)
            .audioCodec("libmp3lame")
            .audioQuality(2)
            .on("end", () => { resolve(); })
            .on("error", (err) => { reject(err); })
            .save(tempFile);
        });

        finalFile = tempFile;
        console.log(`✅ Conversion complete: ${finalFile}`);
      } else {
        console.log(`✅ Supported container (${metadata.format.container || "unknown"}) — no conversion.`);
      }

      assertHeadroom();
      logMemory("before-transcribe");

      // Create stream for Whisper
      const fileStream = fs.createReadStream(finalFile);
      console.log("📂 File stream created for:", finalFile);

      const apiKey = await getOpenAIKey();
      const model = new OpenAI({ apiKey });

      // Transcribe (OpenAI handles the stream; we do NOT decode to WAV ourselves)
      const transcription = await model.audio.transcriptions.create({
        file: fileStream,
        model: "whisper-1",
      });

      try { fileStream.destroy(); } catch {}
      const text = (transcription?.text || "").trim();
      console.log("✅ Transcription result length:", text.length);

      assertHeadroom();
      logMemory("before-lang");

      // Detect language (JSON)
      const completion = await model.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `What language is this text written in?

Return the result as JSON with the format:
{"language":"<language name comma seperated>"}

Here is the text:
"${text}"`,
          },
        ],
        response_format: { type: "json_object" },
      });

      let detectedLanguage = null;
      try {
        detectedLanguage = JSON.parse(completion.choices[0].message.content).language || null;
      } catch {
        detectedLanguage = null;
      }

      console.log("detectedLanguage:", detectedLanguage);

      return {
        language: detectedLanguage,
        duration: duration || null,
        text,
      };
    } catch (error) {
      console.error("Error processing voice input:", error);
      throw error;
    } finally {
      if (tempFile) deleteFile(tempFile);
      logMemory("after-voice");
    }
  });
}

/* ------------------------------ Text & others ----------------------------- */

async function processText(userInput) {
  try {
    console.log("Processing text input:");
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
]}`;

    const apiKey = await getOpenAIKey();
    const model = new OpenAI({ apiKey });

    const llmMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ];

    const llmResponse = await model.chat.completions.create({
      model: "gpt-4o-mini",
      messages: llmMessages,
      response_format: { type: "json_object" },
    });

    const out = llmResponse.choices[0].message.content;
    console.log(out);
    return out;
  } catch (error) {
    console.error("Error calling LLM for post categorization:", error.message);
    throw new Error("Failed to classify posts with LLM");
  }
}

// Note: videoToneIdentifier still references `videoIntelligence` which must be required elsewhere.
// Left untouched to keep "no new packages" promise.
async function videoToneIdentifier(videoUri) {
  const client = new videoIntelligence.VideoIntelligenceServiceClient();

  const request = {
    inputUri: videoUri,
    features: ["SPEECH_TRANSCRIPTION", "LABEL_DETECTION"],
    videoContext: {
      speechTranscriptionConfig: {
        languageCode: "en-US",
        enableAutomaticPunctuation: true,
      },
    },
  };

  console.log("Processing video...");
  const [operation] = await client.annotateVideo(request);
  const [response] = await operation.promise();
  console.log("Processing complete.\n");

  const annotationResults = response.annotationResults[0];

  if (annotationResults.speechTranscriptions.length > 0) {
    console.log("🗣️ Speech Detected:");
    annotationResults.speechTranscriptions.forEach((transcription, i) => {
      const alt = transcription.alternatives[0];
      console.log(`  [${i}] ${alt.transcript}`);
    });
  } else {
    console.log("❌ No speech detected.");
  }

  console.log("\n🔎 Labels Detected:");
  annotationResults.segmentLabelAnnotations.forEach((label) => {
    console.log(`  Label: ${label.entity.description}`);
    label.segments.forEach((segment) => {
      const start = segment.segment.startTimeOffset.seconds || 0;
      const end = segment.segment.endTimeOffset.seconds || 0;
      console.log(`    Duration: ${start}s to ${end}s`);
    });
  });
}

async function profileBioIdentifier(bio) {
  try {
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
          "email":<comma seperate in came multiple else empty >,
          "mobile":<comma seperate in came multiple else empty >,
          "other ":<comma seperate in came multiple with type and details else empty >
        }
    }

rules :
  1.always follow same structure structure.
  2. if any field is empty then return same structure wuth empty strings.
`;

    const apiKey = await getOpenAIKey();
    const model = new OpenAI({ apiKey });

    const message = [
      { role: "system", content: systemPrompt },
      { role: "user", content: bio },
    ];

    const completion = await model.chat.completions.create({
      model: "gpt-4o-mini",
      messages: message,
      response_format: { type: "json_object" },
    });

    const out = completion.choices[0].message.content;
    console.log(out);
    return out;
  } catch (error) {
    console.error("Error calling LLM for profile bio categorization:", error.message);
    throw new Error("Failed to classify posts with LLM");
  }
}

module.exports = { processUserInput, processVoice, processText, videoToneIdentifier, profileBioIdentifier };
