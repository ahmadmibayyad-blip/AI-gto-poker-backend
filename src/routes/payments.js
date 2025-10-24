const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const PaymentPlan = require('../models/PaymentPlan');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');

// Test route to verify payments router is working
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Payments router is working' });
});

// Test POST route without auth
router.post('/test-post', (req, res) => {
  console.log('🧪 Test POST route called');
  res.json({ 
    success: true, 
    message: 'Test POST route working', 
    data: {
      quotaAdded: 20,
      newAvailableUsage: 20,
      transactionId: 'test-123',
      amount: 10
    }
  });
});

// Simple test route for confirm-payment-with-card
router.post('/test-confirm', (req, res) => {
  console.log('🧪 Test confirm route called');
  res.json({ success: true, message: 'Test confirm route working' });
});

// Full Stripe payment processing with card details
router.post('/confirm-payment-with-card-simple', authenticateToken, async (req, res) => {
  console.log('🔍 Stripe payment confirmation route called');
  
  try {
    const userId = req.user.id;
    const { paymentIntentId, cardNumber, expiryMonth, expiryYear, cvc, cardholderName, country } = req.body;

    console.log('📝 Received payment data:', {
      userId: userId.toString(),
      paymentIntentId,
      cardNumber: cardNumber ? `${cardNumber.substring(0, 4)}****` : 'missing',
      expiryMonth,
      expiryYear,
      cvc: cvc ? '***' : 'missing',
      cardholderName,
      country
    });

    // Validate required fields
    if (!paymentIntentId || !cardNumber || !expiryMonth || !expiryYear || !cvc) {
      return res.status(400).json({
        success: false,
        error: 'Missing required payment information'
      });
    }

    // Check Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Payment system is not configured. Please contact support.'
      });
    }

    const stripe = getStripeInstance();

    // Find the transaction
    console.log('🔎 Searching for transaction with:', { 
      paymentIntentId: paymentIntentId, 
      userId: userId.toString() 
    });
    
    const transaction = await Transaction.findOne({
      stripePaymentIntentId: paymentIntentId,
      userId
    });
    
    console.log('📝 Transaction found:', transaction ? transaction._id : 'None');
    console.log('📝 Transaction details:', transaction ? {
      id: transaction._id,
      stripePaymentIntentId: transaction.stripePaymentIntentId,
      userId: transaction.userId,
      status: transaction.status
    } : 'No transaction found');

    if (!transaction) {
      console.log('❌ No transaction found for paymentIntentId:', paymentIntentId);
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Additional card validation
    const cleanCardNumber = cardNumber.replace(/\s/g, '');
    
    // Basic card number validation
    if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
      return res.status(400).json({
        success: false,
        error: 'Invalid card number length'
      });
    }

    // Basic expiry validation
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    if (parseInt(expiryYear) < currentYear || 
        (parseInt(expiryYear) === currentYear && parseInt(expiryMonth) < currentMonth)) {
      return res.status(400).json({
        success: false,
        error: 'Card has expired'
      });
    }

    // Basic CVC validation
    if (cvc.length < 3 || cvc.length > 4) {
      return res.status(400).json({
        success: false,
        error: 'Invalid CVC length'
      });
    }

    console.log('💳 Processing Stripe payment...');

    // Create payment method
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cleanCardNumber,
        exp_month: parseInt(expiryMonth),
        exp_year: parseInt(expiryYear),
        cvc: cvc,
      },
      billing_details: {
        name: cardholderName,
        address: {
          country: countryCode,
        },
      },
    });

    console.log('✅ Payment method created:', paymentMethod.id);

    // Confirm payment intent
    const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethod.id,
    });

    console.log('💳 Payment intent status:', confirmedPaymentIntent.status);

    if (confirmedPaymentIntent.status !== 'succeeded') {
      transaction.status = 'failed';
      transaction.failureReason = `Payment status: ${confirmedPaymentIntent.status}`;
      await transaction.save();

      // Provide more specific error messages based on Stripe status
      let errorMessage = 'Payment was not successful';
      if (confirmedPaymentIntent.status === 'requires_payment_method') {
        errorMessage = 'Invalid card details. Please check your card information.';
      } else if (confirmedPaymentIntent.status === 'requires_action') {
        errorMessage = 'Additional authentication required. Please try again.';
      } else if (confirmedPaymentIntent.status === 'canceled') {
        errorMessage = 'Payment was canceled.';
      }

      return res.status(400).json({
        success: false,
        error: errorMessage,
        status: confirmedPaymentIntent.status
      });
    }

    // Update transaction status
    transaction.status = 'succeeded';
    await transaction.save();

    // Update user quota
    const user = await User.findById(userId);
    if (user) {
      await user.addQuota(transaction.quotaAmount, transaction._id);
      user.totalSpent = (user.totalSpent || 0) + (transaction.amount / 100);
      await user.save();

      console.log(`✅ Payment successful: User ${user.email} received ${transaction.quotaAmount} quota`);
    }

    res.json({
      success: true,
      data: {
        quotaAdded: transaction.quotaAmount,
        newAvailableUsage: user.availableUsage,
        transactionId: transaction._id,
        amount: transaction.amount / 100
      }
    });

  } catch (error) {
    console.error('❌ Error processing payment:', error);
    
    // Handle specific Stripe errors
    let errorMessage = 'Failed to process payment';
    if (error.type === 'StripeCardError') {
      errorMessage = error.message || 'Invalid card details';
    } else if (error.type === 'StripeRateLimitError') {
      errorMessage = 'Too many requests. Please try again later.';
    } else if (error.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid payment request. Please check your information.';
    } else if (error.type === 'StripeAPIError') {
      errorMessage = 'Payment service temporarily unavailable. Please try again.';
    } else if (error.type === 'StripeConnectionError') {
      errorMessage = 'Network error. Please check your connection and try again.';
    } else if (error.type === 'StripeAuthenticationError') {
      errorMessage = 'Payment authentication failed. Please try again.';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Initialize Stripe with proper error handling
const getStripeInstance = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
};

/**
 * GET /api/payments/plans
 * Get available payment plans
 */
router.get('/plans', async (req, res) => {
  try {
    const plans = await PaymentPlan.getActivePlans();
    
    res.json({
      success: true,
      data: plans.map(plan => ({
        id: plan._id,
        name: plan.name,
        description: plan.description,
        quotaAmount: plan.quotaAmount,
        price: plan.price,
        formattedPrice: plan.formattedPrice,
        pricePerQuota: plan.pricePerQuota,
        isPopular: plan.isPopular,
        features: plan.features,
        stripePriceId: plan.stripePriceId
      }))
    });
  } catch (error) {
    console.error('❌ Error fetching payment plans:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment plans'
    });
  }
});

/**
 * POST /api/payments/create-payment-intent
 * Create a Stripe payment intent for quota purchase
 */
router.post('/create-payment-intent', authenticateToken, async (req, res) => {
  try {
    const { planId, quotaAmount, price } = req.body;
    const userId = req.user.id;

    // Check if Stripe is properly configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Payment system is not configured. Please contact support.'
      });
    }

    // Validate input
    if (!planId || !quotaAmount || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: planId, quotaAmount, price'
      });
    }

    // Verify the plan exists and is active
    const plan = await PaymentPlan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({
        success: false,
        error: 'Payment plan not found or inactive'
      });
    }

    // Verify price matches plan
    if (plan.price !== price || plan.quotaAmount !== quotaAmount) {
      return res.status(400).json({
        success: false,
        error: 'Price or quota amount mismatch'
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create or get Stripe customer
    const stripe = getStripeInstance();
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName,
        metadata: {
          userId: userId.toString()
        }
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(price * 100), // Convert to cents
      currency: process.env.STRIPE_CURRENCY || 'usd',
      customer: stripeCustomerId,
      metadata: {
        userId: userId.toString(),
        planId: planId.toString(),
        quotaAmount: quotaAmount.toString(),
        planName: plan.name
      },
      description: `Purchase ${quotaAmount} analysis credits - ${plan.name}`,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never', // Prevent redirect-based payment methods
      },
    });

    // Create transaction record
    const transaction = await Transaction.create({
      userId: userId,
      stripePaymentIntentId: paymentIntent.id,
      amount: Math.round(price * 100),
      currency: process.env.STRIPE_CURRENCY || 'usd',
      quotaAmount: quotaAmount,
      status: 'pending',
      description: `Purchase ${quotaAmount} analysis credits - ${plan.name}`,
      metadata: {
        planId: planId,
        planName: plan.name
      }
    });

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        transactionId: transaction._id,
        amount: price,
        quotaAmount: quotaAmount,
        planName: plan.name
      }
    });

  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent'
    });
  }
});

/**
 * POST /api/payments/confirm-payment
 * Confirm payment and add quota to user
 */
router.post('/confirm-payment', authenticateToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user.id;

    // Check if Stripe is properly configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Payment system is not configured. Please contact support.'
      });
    }

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'Payment intent ID is required'
      });
    }

    // Retrieve payment intent from Stripe
    const stripe = getStripeInstance();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Find transaction
    const transaction = await Transaction.findOne({
      stripePaymentIntentId: paymentIntentId,
      userId: userId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Check if payment was successful
    if (paymentIntent.status !== 'succeeded') {
      transaction.status = 'failed';
      transaction.failureReason = `Payment status: ${paymentIntent.status}`;
      await transaction.save();

      return res.status(400).json({
        success: false,
        error: 'Payment was not successful',
        status: paymentIntent.status
      });
    }

    // Update transaction status
    transaction.status = 'succeeded';
    await transaction.save();

    // Add quota to user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update user's total spent BEFORE calling addQuota
    user.totalSpent = (user.totalSpent || 0) + (transaction.amount / 100);
    
    // Add quota to user (this will save the user with updated totalSpent)
    await user.addQuota(transaction.quotaAmount, transaction._id);

    console.log(`✅ Payment confirmed: User ${user.email} received ${transaction.quotaAmount} quota`);
    console.log(`📊 New available usage: ${user.availableUsage}`);

    res.json({
      success: true,
      data: {
        quotaAdded: transaction.quotaAmount,
        newAvailableUsage: user.availableUsage,
        transactionId: transaction._id,
        amount: transaction.amount / 100
      }
    });

  } catch (error) {
    console.error('❌ Error confirming payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment'
    });
  }
});

/**
 * POST /api/payments/confirm-payment-with-card
 * Confirm payment with card details (supports both test and live modes)
 * 
 * TEST MODE (sk_test_...):
 * - Accepts raw card data (cardNumber, expiryMonth, expiryYear, cvc)
 * - Creates payment method directly with Stripe API
 * - Falls back to simulation if Stripe API fails
 * 
 * LIVE MODE (sk_live_...):
 * - Requires paymentMethodId from Stripe Elements on frontend
 * - Uses secure Stripe Elements integration
 * - No raw card data sent to backend
 * 
 * Frontend should detect mode and send appropriate data:
 * - Test mode: Send card details
 * - Live mode: Send paymentMethodId from Stripe Elements
 */
router.post('/confirm-payment-with-card', authenticateToken, async (req, res) => {
  console.log('✨ ROUTE HIT: /confirm-payment-with-card');
  console.log('🔍 confirm-payment-with-card route called');
  console.log('📝 Request body:', req.body);
  console.log('👤 User:', req.user);
  
  try {
    const userId = req.user.id;
    console.log('🆔 User ID:', userId);
    
    const { 
      paymentIntentId, 
      cardNumber, 
      expiryMonth, 
      expiryYear, 
      cvc, 
      cardholderName, 
      country 
    } = req.body;

    console.log('💳 Payment data received:', {
      paymentIntentId,
      cardNumber: cardNumber ? `${cardNumber.substring(0, 4)}****` : 'missing',
      expiryMonth,
      expiryYear,
      cvc: cvc ? '***' : 'missing',
      cardholderName,
      country
    });

    // Validate required fields
    if (!paymentIntentId || !cardNumber || !expiryMonth || !expiryYear || !cvc) {
      return res.status(400).json({
        success: false,
        error: 'Missing required payment information'
      });
    }

    // Check if Stripe is properly configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Payment system is not configured. Please contact support.'
      });
    }

    const stripe = getStripeInstance();

    // Find the transaction
    const transaction = await Transaction.findOne({ 
      stripePaymentIntentId: paymentIntentId, 
      userId 
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Convert country name to ISO code
    const countryCodeMap = {
          'United States': 'US',
          'Canada': 'CA',
          'United Kingdom': 'GB',
          'Australia': 'AU',
          'Germany': 'DE',
          'France': 'FR',
          'Spain': 'ES',
          'Italy': 'IT',
          'Japan': 'JP',
          'China': 'CN',
          'India': 'IN',
          'Brazil': 'BR',
          'Mexico': 'MX',
          'Argentina': 'AR',
          'South Africa': 'ZA',
          'Nigeria': 'NG',
          'Egypt': 'EG',
          'Saudi Arabia': 'SA',
          'United Arab Emirates': 'AE',
          'Russia': 'RU',
          'South Korea': 'KR',
          'Indonesia': 'ID',
          'Malaysia': 'MY',
          'Philippines': 'PH',
          'Thailand': 'TH',
          'Vietnam': 'VN',
          'New Zealand': 'NZ',
          'Ireland': 'IE',
          'Netherlands': 'NL',
          'Belgium': 'BE',
          'Switzerland': 'CH',
          'Sweden': 'SE',
          'Norway': 'NO',
          'Denmark': 'DK',
          'Finland': 'FI',
          'Austria': 'AT',
          'Portugal': 'PT',
          'Greece': 'GR',
          'Poland': 'PL',
          'Czech Republic': 'CZ',
          'Hungary': 'HU',
          'Romania': 'RO',
          'Turkey': 'TR',
          'Israel': 'IL',
          'Singapore': 'SG',
          'Hong Kong': 'HK',
          'Taiwan': 'TW',
          'Chile': 'CL',
          'Colombia': 'CO',
          'Peru': 'PE',
          'Venezuela': 'VE',
          'Pakistan': 'PK',
          'Bangladesh': 'BD',
          'Ukraine': 'UA',
          'Kazakhstan': 'KZ',
          'Algeria': 'DZ',
          'Morocco': 'MA',
          'Kenya': 'KE',
          'Ethiopia': 'ET',
          'Ghana': 'GH',
          'Angola': 'AO',
          'Uzbekistan': 'UZ',
          'Sri Lanka': 'LK',
          'Myanmar': 'MM',
          'Nepal': 'NP',
          'Cambodia': 'KH',
          'Laos': 'LA',
          'Mongolia': 'MN',
          'Fiji': 'FJ',
          'Papua New Guinea': 'PG',
          'Afghanistan': 'AF',
          'Albania': 'AL',
          'Armenia': 'AM',
          'Azerbaijan': 'AZ',
          'Bahrain': 'BH',
          'Belarus': 'BY',
          'Bolivia': 'BO',
          'Bosnia and Herzegovina': 'BA',
          'Bulgaria': 'BG',
          'Costa Rica': 'CR',
          'Croatia': 'HR',
          'Cuba': 'CU',
          'Cyprus': 'CY',
          'Dominican Republic': 'DO',
          'Ecuador': 'EC',
          'El Salvador': 'SV',
          'Estonia': 'EE',
          'Georgia': 'GE',
          'Guatemala': 'GT',
          'Honduras': 'HN',
          'Iceland': 'IS',
          'Iran': 'IR',
          'Iraq': 'IQ',
          'Jamaica': 'JM',
          'Jordan': 'JO',
          'Kuwait': 'KW',
          'Latvia': 'LV',
          'Lebanon': 'LB',
          'Libya': 'LY',
          'Lithuania': 'LT',
          'Luxembourg': 'LU',
          'Malta': 'MT',
          'Moldova': 'MD',
          'Montenegro': 'ME',
          'North Macedonia': 'MK',
          'Oman': 'OM',
          'Panama': 'PA',
          'Paraguay': 'PY',
          'Qatar': 'QA',
          'Serbia': 'RS',
          'Slovakia': 'SK',
          'Slovenia': 'SI',
          'Syria': 'SY',
          'Tanzania': 'TZ',
          'Tunisia': 'TN',
          'Uruguay': 'UY',
          'Yemen': 'YE',
          'Zambia': 'ZM',
          'Zimbabwe': 'ZW'
    };
  
    const countryCode = countryCodeMap[country] || 'US'; // Default to US if not found
    console.log('🌍 Country conversion:', { country, countryCode });

    // Additional card validation
    const cleanCardNumber = cardNumber.replace(/\s/g, '');
    
    // Basic card number validation
    if (cleanCardNumber.length < 13 || cleanCardNumber.length > 19) {
      return res.status(400).json({
        success: false,
        error: 'Invalid card number length'
      });
    }

    // Basic expiry validation
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;
    
    if (parseInt(expiryYear) < currentYear || 
        (parseInt(expiryYear) === currentYear && parseInt(expiryMonth) < currentMonth)) {
      return res.status(400).json({
        success: false,
        error: 'Card has expired'
      });
    }

    // Basic CVC validation
    if (cvc.length < 3 || cvc.length > 4) {
      return res.status(400).json({
        success: false,
        error: 'Invalid CVC length'
      });
    }

    console.log('💳 Processing Stripe payment...');
    
    let paymentIntent;
    
    // Check if we're in test mode or live mode
    if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      console.log('🧪 Test mode: Using Stripe test tokens for validation');
      
      // For test mode, we use Stripe test tokens for known test cards
      // Map common test card numbers to Stripe test tokens
      const testTokenMap = {
        '4242424242424242': 'tok_visa',           // Visa - Success
        '4000000000000002': 'tok_chargeDeclined', // Visa - Declined
        '5555555555554444': 'tok_mastercard',     // Mastercard - Success
        '378282246310005': 'tok_amex',            // American Express - Success
        '4000000000000010': 'tok_chargeDeclinedInsufficientFunds', // Insufficient funds
        '4000000000009995': 'tok_chargeDeclinedLostCard', // Lost card
      };
      
      let stripeToken = testTokenMap[cleanCardNumber];
      
      try {
        if (stripeToken) {
          // Known test card - use token
          console.log('✅ Using Stripe test token for card:', cleanCardNumber.substring(0, 4) + '****');
          
          paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
            payment_method_data: {
              type: 'card',
              card: {
                token: stripeToken,
              },
              billing_details: {
                name: cardholderName,
                address: {
                  country: countryCode,
                },
              },
            },
          });

          console.log('💳 Test payment intent status:', paymentIntent.status);
          
        } else {
          // Unknown card - treat as invalid card for proper error handling
          console.log('⚠️ Unknown card number in test mode:', cleanCardNumber.substring(0, 4) + '****');
          console.log('📋 Valid test cards: 4242..., 5555..., 3782..., 4000...0002 (declined)');
          
          // Update transaction as failed
          transaction.status = 'failed';
          transaction.failureReason = 'Invalid test card number. Please use a valid Stripe test card.';
          await transaction.save();
          
          return res.status(400).json({
            success: false,
            error: 'Invalid card number. In test mode, please use valid Stripe test cards:\n' +
                   '• 4242 4242 4242 4242 (Success)\n' +
                   '• 5555 5555 5555 4444 (Mastercard)\n' +
                   '• 3782 822463 10005 (Amex)\n' +
                   '• 4000 0000 0000 0002 (Declined)'
          });
        }
      } catch (testError) {
        console.error('❌ Test mode payment failed:', testError.message);
        
        // Update transaction as failed
        transaction.status = 'failed';
        transaction.failureReason = testError.message;
        await transaction.save();
        
        // Handle specific Stripe errors
        let errorMessage = 'Payment failed';
        if (testError.type === 'StripeCardError') {
          errorMessage = testError.message || 'Your card was declined';
        } else if (testError.type === 'StripeInvalidRequestError') {
          errorMessage = testError.message || 'Invalid payment information';
        }
        
        return res.status(400).json({
          success: false,
          error: errorMessage
        });
      }
      
    } else {
      console.log('🚀 Live mode: Processing real payments');
      
      // For live mode, we'll use the same approach but with real Stripe processing
      // WARNING: This sends card data to Stripe. For better security, use Stripe Elements on frontend.
      
      try {
        // Create payment method with real card data
        const paymentMethod = await stripe.paymentMethods.create({
          type: 'card',
          card: {
            number: cleanCardNumber,
            exp_month: parseInt(expiryMonth),
            exp_year: parseInt(expiryYear),
            cvc: cvc,
          },
          billing_details: {
            name: cardholderName,
            address: {
              country: countryCode,
            },
          },
        });

        console.log('✅ Live payment method created:', paymentMethod.id);

        // Confirm the payment intent with the payment method
        paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
          payment_method: paymentMethod.id,
        });

        console.log('💳 Live payment intent status:', paymentIntent.status);
        
      } catch (liveError) {
        console.error('❌ Live mode payment confirmation failed:', liveError);
        
        // Handle live mode errors with detailed messages
        let errorMessage = 'Payment confirmation failed';
        
        if (liveError.type === 'StripeCardError') {
          // Card was declined or invalid
          errorMessage = liveError.message || 'Your card was declined. Please check your card details or try a different card.';
        } else if (liveError.type === 'StripeRateLimitError') {
          errorMessage = 'Too many requests. Please try again later.';
        } else if (liveError.type === 'StripeInvalidRequestError') {
          errorMessage = liveError.message || 'Invalid payment request. Please check your information.';
        } else if (liveError.type === 'StripeAPIError') {
          errorMessage = 'Payment service temporarily unavailable. Please try again.';
        } else if (liveError.type === 'StripeConnectionError') {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (liveError.type === 'StripeAuthenticationError') {
          errorMessage = 'Payment authentication failed. Please try again.';
        }
        
        // Update transaction as failed
        transaction.status = 'failed';
        transaction.failureReason = errorMessage;
        await transaction.save();
        
        return res.status(400).json({
          success: false,
          error: errorMessage
        });
      }
    }

    // Check if payment was successful
    if (paymentIntent.status !== 'succeeded') {
      transaction.status = 'failed';
      transaction.failureReason = `Payment status: ${paymentIntent.status}`;
      await transaction.save();

      // Provide specific error messages based on status
      let errorMessage = 'Payment was not successful';
      if (paymentIntent.status === 'requires_payment_method') {
        errorMessage = 'Your card was declined. Please check your card details or try a different card.';
      } else if (paymentIntent.status === 'requires_action') {
        errorMessage = 'Additional authentication required. Please try again.';
      } else if (paymentIntent.status === 'canceled') {
        errorMessage = 'Payment was canceled.';
      } else if (paymentIntent.status === 'processing') {
        errorMessage = 'Payment is still processing. Please wait a moment and check your account.';
      }

      console.log(`❌ Payment failed: ${errorMessage} (Status: ${paymentIntent.status})`);

      return res.status(400).json({
        success: false,
        error: errorMessage,
        status: paymentIntent.status
      });
    }

    // Update transaction status
    transaction.status = 'succeeded';
    await transaction.save();

    // Add quota to user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update user's total spent BEFORE calling addQuota
    user.totalSpent = (user.totalSpent || 0) + (transaction.amount / 100);
    
    // Add quota to user (this will save the user with updated totalSpent)
    await user.addQuota(transaction.quotaAmount, transaction._id);

    console.log(`✅ Payment confirmed with card: User ${user.email} received ${transaction.quotaAmount} quota`);
    console.log(`📊 New available usage: ${user.availableUsage}`);

    res.json({
      success: true,
      data: {
        quotaAdded: transaction.quotaAmount,
        newAvailableUsage: user.availableUsage,
        transactionId: transaction._id,
        amount: transaction.amount / 100
      }
    });

  } catch (error) {
    console.error('❌ Error confirming payment with card:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment with card'
    });
  }
});

/**
 * GET /api/payments/transactions
 * Get user's transaction history
 */
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, skip = 0 } = req.query;

    const transactions = await Transaction.getUserTransactions(
      userId, 
      parseInt(limit), 
      parseInt(skip)
    );

    res.json({
      success: true,
      data: transactions.map(transaction => ({
        id: transaction._id,
        amount: transaction.amount / 100,
        currency: transaction.currency,
        quotaAmount: transaction.quotaAmount,
        status: transaction.status,
        description: transaction.description,
        createdAt: transaction.createdAt,
        failureReason: transaction.failureReason
      }))
    });

  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transactions'
    });
  }
});

/**
 * GET /api/payments/summary
 * Get user's payment summary
 */
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const summary = user.getPaymentSummary();

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Error fetching payment summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment summary'
    });
  }
});

/**
 * POST /api/payments/webhook
 * Handle Stripe webhooks
 */
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Check if Stripe is properly configured
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('❌ Stripe configuration missing for webhook');
      return res.status(500).send('Webhook configuration error');
    }

    const stripe = getStripeInstance();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('✅ PaymentIntent succeeded:', paymentIntent.id);
      
      // Update transaction status
      await Transaction.findOneAndUpdate(
        { stripePaymentIntentId: paymentIntent.id },
        { status: 'succeeded' }
      );
      
      // Add quota to user
      const transaction = await Transaction.findOne({ 
        stripePaymentIntentId: paymentIntent.id 
      });
      
      if (transaction) {
        const user = await User.findById(transaction.userId);
        if (user) {
          // Update user's total spent BEFORE calling addQuota
          user.totalSpent = (user.totalSpent || 0) + (transaction.amount / 100);
          
          // Add quota to user (this will save the user with updated totalSpent)
          await user.addQuota(transaction.quotaAmount, transaction._id);
          
          console.log(`✅ Webhook: Added ${transaction.quotaAmount} quota to user ${user.email}`);
          console.log(`📊 Webhook: New available usage: ${user.availableUsage}`);
        }
      }
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('❌ PaymentIntent failed:', failedPayment.id);
      
      await Transaction.findOneAndUpdate(
        { stripePaymentIntentId: failedPayment.id },
        { 
          status: 'failed',
          failureReason: failedPayment.last_payment_error?.message || 'Payment failed'
        }
      );
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

// Get revenue statistics for admin dashboard
router.get('/revenue/stats', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Fetching revenue statistics...');
    console.log('👤 Admin user:', req.user.email, '| Admin allowed:', req.user.adminAllowed);

    // Get current month date range
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    // Get last month date range
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Aggregate current month revenue
    const currentMonthStats = await Transaction.aggregate([
      {
        $match: {
          status: 'succeeded',
          createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    // Aggregate last month revenue for comparison
    const lastMonthStats = await Transaction.aggregate([
      {
        $match: {
          status: 'succeeded',
          createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' }
        }
      }
    ]);

    // Get revenue breakdown by product type (based on quotaAmount)
    const revenueBreakdown = await Transaction.aggregate([
      {
        $match: {
          status: 'succeeded',
          createdAt: { $gte: currentMonthStart, $lte: currentMonthEnd }
        }
      },
      {
        $group: {
          _id: '$quotaAmount',
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
          description: { $first: '$description' }
        }
      },
      {
        $sort: { revenue: -1 }
      }
    ]);

    // Calculate totals
    const currentRevenue = currentMonthStats[0]?.totalRevenue || 0;
    const lastRevenue = lastMonthStats[0]?.totalRevenue || 0;
    const totalTransactions = currentMonthStats[0]?.totalTransactions || 0;

    // Calculate growth percentage
    let growthPercentage = 0;
    if (lastRevenue > 0) {
      growthPercentage = ((currentRevenue - lastRevenue) / lastRevenue) * 100;
    } else if (currentRevenue > 0) {
      growthPercentage = 100;
    }

    // Categorize revenue by type
    let subscriptionRevenue = 0;
    let oneTimeRevenue = 0;
    const breakdown = {
      premium: 0,      // 120 quota (Pro Pack)
      basic: 0,        // 55 quota (Player Pack)
      starter: 0,      // 20 quota (Starter Pack)
      other: 0
    };

    revenueBreakdown.forEach(item => {
      const revenue = item.revenue;
      
      // Categorize based on quota amount (matching PaymentPlan quotas)
      if (item._id === 120) {
        breakdown.premium = revenue;
        subscriptionRevenue += revenue; // Consider Pro Pack as subscription
      } else if (item._id === 55) {
        breakdown.basic = revenue;
        subscriptionRevenue += revenue; // Consider Player Pack as subscription
      } else if (item._id === 20) {
        breakdown.starter = revenue;
        oneTimeRevenue += revenue; // Consider Starter Pack as one-time
      } else {
        breakdown.other = revenue;
        oneTimeRevenue += revenue;
      }
    });

    // Calculate percentages
    const subscriptionPercentage = currentRevenue > 0 
      ? ((subscriptionRevenue / currentRevenue) * 100).toFixed(1)
      : 0;
    const oneTimePercentage = currentRevenue > 0 
      ? ((oneTimeRevenue / currentRevenue) * 100).toFixed(1)
      : 0;

    const stats = {
      currentMonth: {
        totalRevenue: currentRevenue / 100, // Convert cents to dollars
        totalTransactions,
        subscriptionRevenue: subscriptionRevenue / 100,
        oneTimeRevenue: oneTimeRevenue / 100,
        subscriptionPercentage: parseFloat(subscriptionPercentage),
        oneTimePercentage: parseFloat(oneTimePercentage)
      },
      lastMonth: {
        totalRevenue: lastRevenue / 100
      },
      growth: {
        percentage: parseFloat(growthPercentage.toFixed(1)),
        isPositive: growthPercentage >= 0
      },
      breakdown: {
        premium: breakdown.premium / 100,
        basic: breakdown.basic / 100,
        starter: breakdown.starter / 100,
        other: breakdown.other / 100
      },
      revenueDetails: revenueBreakdown.map(item => ({
        quotaAmount: item._id,
        revenue: item.revenue / 100,
        transactionCount: item.count,
        description: item.description
      }))
    };

    console.log('✅ Revenue statistics calculated:', {
      totalRevenue: stats.currentMonth.totalRevenue,
      transactions: totalTransactions,
      growth: stats.growth.percentage
    });

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Error fetching revenue statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch revenue statistics'
    });
  }
});

module.exports = router;

