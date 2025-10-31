const axios = require('axios');

// Simple in-memory cache
const cache = {
  solUsd: { value: null, expiresAt: 0 },
  usdtUsd: { value: null, expiresAt: 0 },
};

const ONE_MINUTE_MS = 60 * 1000;

async function getSolUsdRate() {
  const now = Date.now();
  if (cache.solUsd.value && cache.solUsd.expiresAt > now) {
    return cache.solUsd.value;
  }

  try {
    const coingeckoUrl = process.env.SOLANA_COINGECKO_API;
    const response = await axios.get(coingeckoUrl, { timeout: 4000 });
    const rate = response?.data?.solana?.usd;
    if (typeof rate !== 'number' || rate <= 0) {
      throw new Error('Invalid SOL/USD rate from provider');
    }
    cache.solUsd = { value: rate, expiresAt: now + ONE_MINUTE_MS };
    return rate;
  } catch (err) {
    // Optional fallback: fixed rate via env (not recommended for prod)
    if (process.env.SOL_USD_FALLBACK_RATE) {
      const fallback = parseFloat(process.env.SOL_USD_FALLBACK_RATE);
      if (!Number.isNaN(fallback) && fallback > 0) {
        return fallback;
      }
    }
    throw err;
  }
}

async function getUsdtUsdRate() {
    const now = Date.now();
    if (cache.usdtUsd.value && cache.usdtUsd.expiresAt > now) {
      return cache.usdtUsd.value;
    }
  
    try {
      const coingeckoUrl = process.env.BSC_COINGECKO_API;
      const response = await axios.get(coingeckoUrl, { timeout: 4000 });
      const rate = response?.data?.tether?.usd;
      if (typeof rate !== 'number' || rate <= 0) {
        throw new Error('Invalid USDT/USD rate from provider');
      }
      cache.usdtUsd = { value: rate, expiresAt: now + ONE_MINUTE_MS };
      return rate;
    } catch (err) {
      // USDT is generally 1:1 with USD, so use 1.0 as fallback
      const fallback = 1.0;
      if (process.env.USDT_USD_FALLBACK_RATE) {
        const envFallback = parseFloat(process.env.USDT_USD_FALLBACK_RATE);
        if (!Number.isNaN(envFallback) && envFallback > 0) {
          cache.usdtUsd = { value: envFallback, expiresAt: now + ONE_MINUTE_MS };
          return envFallback;
        }
      }
      cache.usdtUsd = { value: fallback, expiresAt: now + ONE_MINUTE_MS };
      return fallback;
    }
  }
  
  module.exports = { getSolUsdRate, getUsdtUsdRate };


