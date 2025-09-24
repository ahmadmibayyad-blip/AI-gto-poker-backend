const OpenAI = require("openai");
require('dotenv').config();

async function testOpenAI() {
  console.log('🧪 Testing OpenAI API connectivity...');
  
  // Check environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in environment variables');
    console.log('💡 Please check your .env file or environment configuration');
    return;
  }
  
  console.log('✅ OPENAI_API_KEY found');
  console.log('🔑 API Key starts with:', process.env.OPENAI_API_KEY.substring(0, 10) + '...');
  
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
    });

    console.log('🤖 Testing simple text completion...');
    
    const response = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: "Say 'Hello, OpenAI is working!'"
        }
      ],
      max_tokens: 50,
    });

    console.log('✅ OpenAI API test successful!');
    console.log('📝 Response:', response.choices[0].message.content);
    
  } catch (error) {
    console.error('❌ OpenAI API test failed:');
    console.error('Status:', error.status);
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Type:', error.type);
    
    if (error.status === 403 && error.code === 'unsupported_country_region_territory') {
      console.log('\n🌍 REGIONAL RESTRICTION DETECTED');
      console.log('This means OpenAI services are not available in your current location.');
      console.log('\n💡 Solutions:');
      console.log('1. Use a VPN to connect from a supported region (US, UK, EU, etc.)');
      console.log('2. Contact OpenAI support for regional access');
      console.log('3. Use the local GTO engine fallback (already implemented)');
      console.log('\n🔄 The app will automatically fall back to local analysis when OpenAI is unavailable.');
    } else if (error.status === 401) {
      console.log('\n🔑 AUTHENTICATION ERROR');
      console.log('Your API key is invalid or expired.');
      console.log('Please check your OpenAI account and regenerate the key.');
    } else if (error.status === 429) {
      console.log('\n⏰ RATE LIMIT EXCEEDED');
      console.log('You have exceeded your OpenAI API usage limits.');
      console.log('Please wait or upgrade your plan.');
    }
  }
}

// Run the test
testOpenAI().catch(console.error); 