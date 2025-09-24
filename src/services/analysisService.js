const sharp = require('sharp');
const OpenAI = require("openai");
const fs = require('fs');
const vision = require('@google-cloud/vision');
const Tesseract = require('tesseract.js');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
 * Call OpenAI API with proper error handling
 */
async function callOpenAIAPI(imageBuffer, gameFormat) {
  try {
    const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

    // Check if API key is available
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    console.log('🤖 Calling OpenAI API...');

    const prompt = `
      You are a structured-data extractor and ${gameFormat} GTO poker strategy assistant. 
      You will read a poker-table screenshot and produce a JSON object containing both the parsed table state, betting actions, and a GTO recommendation.
        
      Color → Suit mapping:
      - black card color -> spade (♠)
      - red card color -> heart (♥)
      - blue card color -> diamond (♦)
      - green card color -> club (♣)
        
      Card ranks use these characters: A, K, Q, J, T (for Ten), 9, 8, 7, 6, 5, 4, 3, 2.
      When producing cards use the format "<RANK><SUIT_SYMBOL>" (examples: "A♠", "Q♥", "T♦").
        
      Return ONLY a single valid JSON object — no commentary, no markdown, no extra text — with the following structure:
        
      {
        "hero_card": [<2 strings>],
        "board_card": [<strings>], // exactly the cards on the board in left-to-right order
        "pot": "<string like '16.5 BB'>",
        "stacks": {
          "<seat>": "<stack string like '92.5 BB'>",
          ...
        },
        "actions": [
          { "seat": "<seat name>", "action": "<Bet | Raise | Call | Check | Fold>", "amount": "<string like '8.5 BB' or 'All-in'>" },
          ...
        ],
        "recommended_action": "<string: e.g. 'Bet 50%', 'Check', 'Fold', 'Call'>",
        "confidence": "<number between 0 and 100 representing % confidence in this recommendation>",
        "analysis_notes": "<string: brief explanation of why this action is recommended>"
      }
        
      Important:
      - If any field cannot be determined with confidence, set its value to null.
      - Preserve card order exactly as they appear left→right on the board.
      - Seat names should match what's visible on the table (e.g., "CO (Hero)", "UTG", "BTN", "SB", "BB", "HJ"). If seat not visible, omit it.
      - The "actions" array should reflect the betting sequence visible in the screenshot (bets, raises, calls, checks, folds), in the order they occurred.
      - Recommended action should be based on GTO poker strategy, given the cards, stacks, and actions shown.
      - Confidence must be expressed as a number between 0 and 100.
      - Analysis notes should be short but strategic, explaining the reasoning behind the recommendation.
        
      Now analyze the provided image and return the JSON above.`;

    const response = await client.responses.create({
      model: MODEL,
      // Use an array input: first the textual instructions, then the image
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl }
          ]
        }
      ],
      max_output_tokens: 700
    });

    let cleanJson = response.output_text
      .replace(/```json\s*/i, '') // remove starting ```json
      .replace(/```\s*$/i, '')    // remove ending ```
      .trim();                    // remove extra whitespace

    let resultObj = JSON.parse(cleanJson);

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

    // Step 1: Try OpenAI API first
    let openAIResult = null;
    try {
      // let iamgeAnalyzeResult = await analyzeGoogleVisionBuffer(imageBuffer);
      // let imageAnalyzeResult = await analyzeTeseractBuffer(imageBuffer);

      openAIResult = await callOpenAIAPI(imageBuffer, gameFormat);

      // Parse OpenAI response and extract GTO decision
      const openAIContent = openAIResult;

      return openAIContent;
    } catch (openAIError) {
      console.log(`⚠️ OpenAI analysis failed: ${openAIError.message}`);
      console.log("🔄 Falling back to local GTO analysis...");
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