const mongoose = require('mongoose');
const PaymentPlan = require('./src/models/PaymentPlan');
require('dotenv').config();

async function initializePaymentPlans() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Initialize default payment plans
    await PaymentPlan.initializeDefaultPlans();
    
    console.log('✅ Payment plans initialized successfully');
    
    // List all active plans
    const plans = await PaymentPlan.getActivePlans();
    console.log('\n📋 Active Payment Plans:');
    plans.forEach(plan => {
      console.log(`- ${plan.name}: ${plan.quotaAmount} credits for $${plan.price} ($${plan.pricePerQuota}/credit)`);
    });

  } catch (error) {
    console.error('❌ Error initializing payment plans:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the initialization
initializePaymentPlans();

