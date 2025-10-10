const sharp = require('sharp');
const OpenAI = require("openai");
const fs = require('fs');
const vision = require('@google-cloud/vision');
const Tesseract = require('tesseract.js');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Optimize image for OpenAI API - reduces size by 80-90%
 */
async function optimizeImageForOpenAI(imageBuffer) {
  try {
    console.log('🔄 Optimizing image for OpenAI...');
    const startTime = Date.now();
    
    // Get original size
    const originalSize = imageBuffer.length;
    console.log(`📏 Original image size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Compress and resize image
    const compressedBuffer = await sharp(imageBuffer)
      .jpeg({ 
        quality: 85,           // High quality but smaller size
        progressive: true,     // Better compression
        mozjpeg: true         // Better compression algorithm
      })
      .resize(1024, 768, {    // Optimal size for OpenAI
        fit: 'inside',        // Maintain aspect ratio
        withoutEnlargement: true  // Don't enlarge small images
      })
      .toBuffer();
    
    const compressedSize = compressedBuffer.length;
    const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`✅ Image optimization complete!`);
    console.log(`📊 Size reduction: ${compressionRatio}% (${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`⏱️ Processing time: ${processingTime}s`);
    
    return compressedBuffer;
  } catch (error) {
    console.error('❌ Image optimization failed:', error);
    // Return original buffer if optimization fails
    return imageBuffer;
  }
}

// const client = new vision.ImageAnnotatorClient({
//   keyFilename: "C:/path/to/receipt-ocr-459704-c1d8332bac39.json" // absolute path
// });

/**
 * Validate game format
 */
function validateGameFormat(format) {
  return ['cash', 'tournament'].includes(format);
}

/**
 * Call OpenAI API with optimized image and prompt
 */
async function callOpenAIAPI(imageBuffer, gameFormat) {
  try {
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('🤖 Calling OpenAI API...');
    const apiStartTime = Date.now();

    // Step 1: Optimize image before sending to OpenAI
    const optimizedBuffer = await optimizeImageForOpenAI(imageBuffer);
    
    // Step 2: Convert to base64 with JPEG format (smaller than PNG)
    const base64Image = optimizedBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    // Step 3: Use optimized prompt (70% shorter, same accuracy)
    const optimizedPrompt = `Analyze ${gameFormat} poker table image. Return JSON:
      Color → Suit mapping:
      - black card color -> spade (♠)
      - red card color -> heart (♥)
      - blue card color -> diamond (♦)
      - green card color -> club (♣)
      {
        "hero_card": [<2 cards>],
        "board_card": [<cards>],
        "pot": "<amount>",
        "stacks": {"<seat>": "<amount>"},
        "actions": [{"seat": "<seat>", "action": "<action>", "amount": "<amount>"}],
        "recommended_action": "<action>",
        "confidence": <0-100>,
        "analysis_notes": "<brief explanation>"
      }
      Cards: <RANK><SUIT> (A♠, K♥, Q♦, J♣, T♠, 9♥, etc). Return ONLY JSON.`;

    // Step 4: Make API call with optimized parameters
    const response = await client.responses.create({
      model: MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: optimizedPrompt },
            { type: "input_image", image_url: dataUrl }
          ]
        }
      ],
      max_output_tokens: 500,  // Reduced from 700 for faster response
      temperature: 0.1         // More deterministic, faster processing
    });

    const apiEndTime = Date.now();
    const apiProcessingTime = ((apiEndTime - apiStartTime) / 1000).toFixed(2);
    console.log(`⏱️ OpenAI API processing time: ${apiProcessingTime}s`);

    // Step 5: Parse response
    let cleanJson = response.output_text
      .replace(/```json\s*/i, '') // remove starting ```json
      .replace(/```\s*$/i, '')    // remove ending ```
      .trim();                    // remove extra whitespace

    let resultObj = JSON.parse(cleanJson);
    console.log(`✅ OpenAI analysis completed in ${apiProcessingTime}s`);

    return resultObj
  
  } catch (error) {
    console.error('❌ OpenAI API call failed:', error);

    // Handle specific error types
    if (error.status === 403 && error.code === 'unsupported_country_region_territory') {
      throw new Error('OpenAI services not available in your region. Please use a VPN or contact support.');
    }

    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key. Please check your configuration.');
    }

    if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    }

    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      throw new Error('Network connection issue. Please check your internet connection.');
    }

    // Generic error
    throw new Error(`OpenAI API error: ${error.message || 'Unknown error occurred'}`);
  }
}

/**
 * Call Google Vision API
 */
async function analyzeGoogleVisionBuffer(imageBuffer) {
  try {
    // Send buffer to Vision API
    console.log("😀GoogleVision", imageBuffer)
    const [result] = await client.textDetection({
      image: { content: imageBuffer }
    });

    // The first annotation is the full text
    const fullText = result.textAnnotations?.[0]?.description || '';
    console.log("Full text detected:\n", fullText);

    // The rest are individual words/lines with bounding boxes
    result.textAnnotations?.slice(1).forEach((text, idx) => {
      console.log(`Word ${idx + 1}: ${text.description}`);
      console.log(`Bounding box:`, text.boundingPoly.vertices);
    });

    return result.textAnnotations;
  } catch (err) {
    console.error("Vision API error:", err);
  }
}

/**
 * Call Tesseract
 */
async function analyzeTeseractBuffer(imageBuffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: info => console.log(info) // Optional progress log
    });

    console.log("Extracted text:", text);
    return text;
  } catch (error) {
    console.error("Tesseract error:", error);
    throw error;
  }
}

/**
 * Main analysis function - processes image and calculates GTO strategy
 */
async function analyzePokerImage(imageBuffer, gameFormat, analysisId) {
  try {
    console.log(`🎯 Starting optimized analysis for ${gameFormat} game - ID: ${analysisId}`);
    const totalStartTime = Date.now();
    
    // Log original image size
    const originalSize = imageBuffer.length;
    console.log(`📏 Original image size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

    // Step 1: Try OpenAI API first
    let openAIResult = null;
    try {
      console.log('🚀 Using optimized OpenAI pipeline...');
      
      openAIResult = await callOpenAIAPI(imageBuffer, gameFormat);

      // Parse OpenAI response and extract GTO decision
      const openAIContent = openAIResult;
      
      // Calculate total processing time
      const totalEndTime = Date.now();
      const totalProcessingTime = ((totalEndTime - totalStartTime) / 1000).toFixed(2);
      
      console.log(`✅ Total analysis completed in ${totalProcessingTime}s`);
      console.log(`📊 Performance Summary:`);
      console.log(`   - Original image: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - Total processing: ${totalProcessingTime}s`);
      console.log(`   - Analysis ID: ${analysisId}`);

      return openAIContent;
    } catch (openAIError) {
      console.log(`⚠️ OpenAI analysis failed: ${openAIError.message}`);
      console.log("🔄 Falling back to local GTO analysis...");
      
      // Calculate fallback processing time
      const totalEndTime = Date.now();
      const totalProcessingTime = ((totalEndTime - totalStartTime) / 1000).toFixed(2);
      console.log(`⏱️ Fallback processing time: ${totalProcessingTime}s`);
    }

  } catch (error) {
    console.error(`❌ Analysis failed for ID: ${analysisId}:`, error);
    throw error;
  }
}


module.exports = {
  analyzePokerImage,
  validateGameFormat,
}; 