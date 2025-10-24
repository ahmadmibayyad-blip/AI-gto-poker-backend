const mongoose = require('mongoose');

const paymentPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  quotaAmount: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'usd',
    uppercase: true
  },
  stripePriceId: {
    type: String,
    unique: true,
    sparse: true // Allows null values but ensures uniqueness when present
  },
  stripeProductId: {
    type: String,
    unique: true,
    sparse: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  features: [{
    type: String,
    trim: true
  }],
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes
paymentPlanSchema.index({ isActive: 1, sortOrder: 1 });
paymentPlanSchema.index({ quotaAmount: 1 });

// Virtual for price per quota
paymentPlanSchema.virtual('pricePerQuota').get(function() {
  return (this.price / this.quotaAmount).toFixed(4);
});

// Virtual for formatted price
paymentPlanSchema.virtual('formattedPrice').get(function() {
  return `$${this.price.toFixed(2)}`;
});

// Static method to get active plans
paymentPlanSchema.statics.getActivePlans = function() {
  return this.find({ isActive: true })
    .sort({ sortOrder: 1, quotaAmount: 1 });
};

// Static method to get plan by quota amount
paymentPlanSchema.statics.getPlanByQuota = function(quotaAmount) {
  return this.findOne({ quotaAmount, isActive: true });
};

// Static method to initialize default plans
paymentPlanSchema.statics.initializeDefaultPlans = async function() {
  const defaultPlans = [
    {
      name: 'Starter Pack',
      description: 'Perfect for casual players',
      quotaAmount: 20,
      price: 10,
      isPopular: false,
      sortOrder: 1,
      features: ['20 Analysis Credits', 'Basic Support', 'Basic Validity']
    },
    {
      name: 'Player Pack',
      description: 'Great for regular players',
      quotaAmount: 55,
      price: 25,
      isPopular: true,
      sortOrder: 2,
      features: ['55 Analysis Credits', 'Priority Support', 'Best Value']
    },
    {
      name: 'Pro Pack',
      description: 'For serious poker players',
      quotaAmount: 120,
      price: 50,
      isPopular: false,
      sortOrder: 3,
      features: ['120 Analysis Credits', 'Premium Support', 'Advanced Analytics']
    }
  ];

  for (const planData of defaultPlans) {
    const existingPlan = await this.findOne({ quotaAmount: planData.quotaAmount });
    if (!existingPlan) {
      await this.create(planData);
      console.log(`✅ Created default plan: ${planData.name}`);
    }
  }
};

module.exports = mongoose.model('PaymentPlan', paymentPlanSchema);

