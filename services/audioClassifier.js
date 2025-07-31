const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const wav = require('node-wav');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { tmpdir } = require('os');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function convertMp3ToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioFrequency(16000)
            .audioChannels(1)
            .format('wav')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

// convertMp3ToWav('/home/shresth/beans/tiktok/audio/7189996872361806597.mp3','/tmp/audio_1752560086602.wav')

async function getYamnetLabels() {
    const text = fs.readFileSync(path.join(__dirname, 'yamnet_class_map.csv'), 'utf8');
    return text.trim().split('\n').slice(1).map(line => {
        const parts = line.split(',');
        return parts[parts.length - 1].replace(/"/g, '').trim();
    });
}

async function classifyAudio(mp3Path) {
    const tempWavPath = path.join(tmpdir(), `audio_${Date.now()}.wav`);
    console.log(`Converting MP3 to WAV: ${tempWavPath}`);
    await convertMp3ToWav(mp3Path, tempWavPath);

    const buffer = fs.readFileSync(tempWavPath);
    const result = wav.decode(buffer);

    const samples = result.channelData[0];
    console.log(`Decoded WAV: ${samples.length} samples @ ${result.sampleRate}Hz`);

    const inputTensor = tf.tensor(samples).reshape([samples.length]);

    console.log(`Tensor shape:`, inputTensor.shape);

    // ✅ Load TFJS model
    const model = await tf.loadGraphModel('file://./model/model.json');

    const logitsTensor = model.execute({ 'waveform': inputTensor });

    console.log("Logits tensor:", logitsTensor);
    const logitsTensor0 = logitsTensor[0];  // first tensor has logits
    
    const logits = await logitsTensor0.array();
    console.log("Logits shape:", logits.length, logits[0].length);

    console.log(`Model output shape: [${logits.length}, ${logits[0].length}]`);

    // Average over frames
    const meanLogits = logits.reduce((acc, cur) => acc.map((v, i) => v + cur[i]), new Array(logits[0].length).fill(0));
    const averaged = meanLogits.map(v => v / logits.length);

    // Softmax
    const probsTensor = tf.softmax(tf.tensor1d(averaged));
    const probs = await probsTensor.array();

    const topK = probs
        .map((prob, idx) => ({ prob, idx }))
        .sort((a, b) => b.prob - a.prob)
        .slice(0, 5);

    const labels = await getYamnetLabels();

    console.log(`\n🎧 Top 5 predictions:`);

    let x=''
    topK.forEach(({ prob, idx }) => {
        console.log(` - ${labels[idx]}: ${(prob * 100).toFixed(2)}%`);
        x+=labels[idx]+','
    });

    fs.unlinkSync(tempWavPath);
    return x;
}

// classifyAudio('./audio/tiktok_audio.mp3')
//     .catch(console.error);

    module.exports = { classifyAudio};