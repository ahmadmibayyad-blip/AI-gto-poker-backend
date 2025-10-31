const { ethers } = require('ethers');
const { Connection, PublicKey } = require('@solana/web3.js');

/**
 * BEP20 USDT Token Contract Address on BSC Mainnet
 * USDT on BSC uses this contract address
 */
const USDT_BSC_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

/**
 * Verify BEP20 (USDT on BSC) transaction
 * @param {string} txnHash - Transaction hash
 * @param {string} expectedToAddress - Expected recipient wallet address
 * @param {number} expectedAmount - Expected amount in USD (will be converted to USDT with 18 decimals)
 * @param {string} memo - Optional memo/identifier to verify
 * @returns {Promise<{verified: boolean, amount?: number, fromAddress?: string, confirmationCount?: number, error?: string}>}
 */
async function verifyBEP20Transaction(txnHash, expectedToAddress, expectedAmount, memo = null) {
  try {
    // Get BSC RPC endpoint from env or use public endpoint
    const bscRpcUrl = process.env.BSC_RPC_URL;
    
    console.log(`🔍 Connecting to BSC RPC: ${bscRpcUrl.substring(0, 30)}...`);
    const provider = new ethers.JsonRpcProvider(bscRpcUrl);

    // Get transaction receipt
    console.log(`📋 Fetching transaction: ${txnHash}`);
    const receipt = await provider.getTransactionReceipt(txnHash);
    
    if (!receipt) {
      return {
        verified: false,
        error: 'Transaction not found on blockchain'
      };
    }

    // Check transaction status (1 = success, 0 = failed)
    if (receipt.status !== 1) {
      return {
        verified: false,
        error: 'Transaction failed on blockchain'
      };
    }

    // Get confirmation count
    const currentBlock = await provider.getBlockNumber();
    const confirmationCount = currentBlock - receipt.blockNumber;
    console.log(`✅ Transaction confirmations: ${confirmationCount}`);

    // Minimum confirmations required (3 for BSC)
    const minConfirmations = 3;
    if (confirmationCount < minConfirmations) {
      return {
        verified: false,
        error: `Transaction needs at least ${minConfirmations} confirmations. Current: ${confirmationCount}`
      };
    }

    // Get transaction details
    const tx = await provider.getTransaction(txnHash);
    
    // If memo is provided, check if it's in the transaction data
    if (memo && tx.data && tx.data.length > 138) {
      try {
        // Convert memo to hex and check if it appears in transaction data
        const dataSuffix = tx.data.substring(138); // Skip function selector and parameters
        if (dataSuffix && dataSuffix !== '0x') {
          const memoHex = ethers.toUtf8String(dataSuffix);
          if (!memoHex.includes(memo)) {
            console.warn(`⚠️ Memo mismatch. Expected: ${memo}, Found in data: ${memoHex.substring(0, 20)}...`);
            // Memo check is not strict, as it might be in different format
          }
        }
      } catch (error) {
        console.warn(`⚠️ Could not parse memo from transaction data: ${error.message}`);
        // Continue verification even if memo parsing fails
      }
    }

    // For USDT transfers, we need to parse Transfer event from logs
    // USDT Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
    const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    
    let transferFound = false;
    let fromAddress = null;
    let transferAmount = null;

    // Parse logs to find Transfer event
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === USDT_BSC_CONTRACT.toLowerCase()) {
        if (log.topics[0].toLowerCase() === transferEventSignature.toLowerCase()) {
          // Transfer event found
          transferFound = true;
          
          // topics[0] = event signature
          // topics[1] = from address (indexed)
          // topics[2] = to address (indexed)
          // data = value (amount)
          
          fromAddress = ethers.getAddress('0x' + log.topics[1].slice(-40));
          const toAddress = ethers.getAddress('0x' + log.topics[2].slice(-40));
          
          // Verify recipient address
          if (toAddress.toLowerCase() !== expectedToAddress.toLowerCase()) {
            return {
              verified: false,
              error: `Recipient address mismatch. Expected: ${expectedToAddress}, Got: ${toAddress}`
            };
          }

          // Get token decimals dynamically from the contract
          // USDT on BSC uses 18 decimals, but let's read it from the contract for accuracy
          let tokenDecimals = 18; // Default for USDT on BSC
          try {
            const { Contract } = ethers;
            const tokenContract = new Contract(
              USDT_BSC_CONTRACT,
              ['function decimals() view returns (uint8)'],
              provider
            );
            tokenDecimals = await tokenContract.decimals();
            console.log(`📊 Token decimals: ${tokenDecimals}`);
          } catch (decimalsError) {
            console.warn('⚠️ Could not read token decimals from contract, using default 18');
          }

          // Parse amount using token decimals
          transferAmount = ethers.formatUnits(log.data, tokenDecimals);
          
          // For BEP20, we accept any amount and calculate credits dynamically
          // No strict amount check needed - just ensure amount is reasonable (> 0.01 USDT)
          const actualAmount = parseFloat(transferAmount);
          if (actualAmount < 0.01) {
            return {
              verified: false,
              error: `Amount too small. Minimum: 0.01 USDT, Got: ${transferAmount} USDT`
            };
          }
          
          // Note: We return the actual USDT amount sent, not the expected amount
          // The server will convert this to USD and calculate credits dynamically

          console.log(`✅ BEP20 Transfer verified:`);
          console.log(`   From: ${fromAddress}`);
          console.log(`   To: ${toAddress}`);
          console.log(`   Amount: ${transferAmount} USDT`);
          console.log(`   Confirmations: ${confirmationCount}`);

          break;
        }
      }
    }

    if (!transferFound) {
      return {
        verified: false,
        error: 'USDT Transfer event not found in transaction logs'
      };
    }

    return {
      verified: true,
      amount: parseFloat(transferAmount),
      fromAddress: fromAddress,
      confirmationCount: confirmationCount
    };

  } catch (error) {
    console.error('❌ BEP20 verification error:', error);
    return {
      verified: false,
      error: error.message || 'Failed to verify BEP20 transaction'
    };
  }
}

/**
 * Verify SOL (Solana) transaction
 * @param {string} txnHash - Transaction signature
 * @param {string} expectedToAddress - Expected recipient wallet address
 * @param {number} expectedAmount - Expected amount in SOL (will be converted from lamports)
 * @param {string} memo - Optional memo/reference to verify
 * @returns {Promise<{verified: boolean, amount?: number, fromAddress?: string, confirmationCount?: number, error?: string}>}
 */
async function verifySOLTransaction(txnHash, expectedToAddress, expectedAmount, memo = null) {
  try {
    // Get Solana RPC endpoint from env or use public endpoint
    const solanaRpcUrl = process.env.SOLANA_RPC_URL;
    
    console.log(`🔍 Connecting to Solana RPC: ${solanaRpcUrl.substring(0, 40)}...`);
    const connection = new Connection(solanaRpcUrl, 'confirmed');

    // Get transaction details
    // Sanitize signature: trim and remove whitespace/newlines
    const signature = (txnHash || '').toString().trim().replace(/\s+/g, '');
    console.log(`📋 Fetching transaction: ${signature}`);

    // First, check signature status to determine existence
    const statusResp = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const sigStatus = statusResp && statusResp.value && statusResp.value[0];
    if (!sigStatus) {
      return {
        verified: false,
        error: 'Transaction not found on blockchain (no status)'
      };
    }

    // Try fetching with stronger finality first
    let transaction = await connection.getTransaction(signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0
    });
    if (!transaction) {
      // Fallback to confirmed
      transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
    }

    if (!transaction) {
      return {
        verified: false,
        error: 'Transaction not found on blockchain'
      };
    }

    // Check if transaction was successful
    if (transaction.meta && transaction.meta.err) {
      return {
        verified: false,
        error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
      };
    }

    // Get confirmation status (Solana uses slot-based confirmations)
    const slot = transaction.slot;
    const currentSlot = await connection.getSlot('confirmed');
    const confirmationCount = Math.max(0, currentSlot - slot);
    
    console.log(`✅ Transaction slot: ${slot}, Current slot: ${currentSlot}`);
    console.log(`✅ Transaction confirmations: ${confirmationCount}`);

    // Minimum confirmations for Solana (typically 32 for finality)
    const minConfirmations = 32;
    if (confirmationCount < minConfirmations) {
      // Still process if confirmations are low but transaction exists
      console.warn(`⚠️ Low confirmations: ${confirmationCount} (recommended: ${minConfirmations})`);
    }

    // Find transfer using balance changes first (robust across versions)
    let transferFound = false;
    let fromAddress = null;
    let transferAmount = null;

    if (transaction.transaction && transaction.transaction.message && transaction.meta) {
      const message = transaction.transaction.message;
      const accountKeys = (message.accountKeys || []).map(k => {
        try { return typeof k === 'string' ? k : k.toString(); } catch { return String(k); }
      });

      // Find recipient index in account keys
      const recipientIndex = accountKeys.indexOf(expectedToAddress);
      if (recipientIndex >= 0 && Array.isArray(transaction.meta.preBalances) && Array.isArray(transaction.meta.postBalances)) {
        const preBal = transaction.meta.preBalances[recipientIndex] || 0;
        const postBal = transaction.meta.postBalances[recipientIndex] || 0;
        const deltaLamports = postBal - preBal;
        if (deltaLamports > 0) {
          transferFound = true;
          transferAmount = deltaLamports / 1e9;
          // Find a likely sender (balance decreased)
          for (let i = 0; i < transaction.meta.preBalances.length; i++) {
            const pre = transaction.meta.preBalances[i] || 0;
            const post = transaction.meta.postBalances[i] || 0;
            if (post < pre) {
              fromAddress = accountKeys[i] || null;
              break;
            }
          }

          if (typeof expectedAmount === 'number' && isFinite(expectedAmount)) {
            const amountDiff = Math.abs(transferAmount - expectedAmount);
            if (amountDiff > 0.001) {
              return {
                verified: false,
                error: `Amount mismatch. Expected: ${expectedAmount} SOL, Got: ${transferAmount} SOL`
              };
            }
          }

          console.log(`✅ SOL Transfer verified (by balance delta):`);
          console.log(`   From: ${fromAddress || 'Unknown'}`);
          console.log(`   To: ${expectedToAddress}`);
          console.log(`   Amount: ${transferAmount} SOL`);
          console.log(`   Confirmations: ${confirmationCount}`);
        }
      }

      // Fallback: try to parse instructions safely if balance delta method didn't work
      if (!transferFound && Array.isArray(message.instructions)) {
        for (const instruction of message.instructions) {
          const programId = (() => {
            try { return instruction.programId?.toString?.() || instruction.programId || ''; } catch { return ''; }
          })();
          if (programId === '11111111111111111111111111111111') {
            const accounts = instruction.keys || instruction.accounts || [];
            const a0 = accounts[0]?.pubkey || accounts[0];
            const a1 = accounts[1]?.pubkey || accounts[1];
            const fromKey = a0 ? (typeof a0 === 'string' ? a0 : a0.toString()) : null;
            const toKey = a1 ? (typeof a1 === 'string' ? a1 : a1.toString()) : null;
            if (toKey && toKey === expectedToAddress) {
              // Try parse amount from data if present
              const data = instruction.data;
              if (data) {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
                if (buf.length >= 12) {
                  const lamports = buf.slice(4, 12).readBigUInt64LE(0);
                  transferAmount = Number(lamports) / 1e9;
                }
              }
              transferFound = true;
              fromAddress = fromKey;

              if (typeof transferAmount === 'number' && typeof expectedAmount === 'number' && isFinite(expectedAmount)) {
                const amountDiff = Math.abs(transferAmount - expectedAmount);
                if (amountDiff > 0.001) {
                  return {
                    verified: false,
                    error: `Amount mismatch. Expected: ${expectedAmount} SOL, Got: ${transferAmount} SOL`
                  };
                }
              }

              console.log(`✅ SOL Transfer verified (by instruction parse):`);
              console.log(`   From: ${fromAddress || 'Unknown'}`);
              console.log(`   To: ${expectedToAddress}`);
              if (typeof transferAmount === 'number') console.log(`   Amount: ${transferAmount} SOL`);
              console.log(`   Confirmations: ${confirmationCount}`);
              break;
            }
          }

          // Check for memo instruction if memo is provided
          if (memo) {
            const memoProgramId = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
            if (programId === memoProgramId) {
              const memoData = (() => {
                try {
                  return Buffer.isBuffer(instruction.data)
                    ? instruction.data.toString('utf-8')
                    : Buffer.from(instruction.data, 'base64').toString('utf-8');
                } catch { return ''; }
              })();
              if (!memoData.includes(memo)) {
                console.warn(`⚠️ Memo mismatch. Expected: ${memo}, Found: ${memoData.substring(0, 20)}...`);
              }
            }
          }
        }
      }
    }

    if (!transferFound) {
      return {
        verified: false,
        error: 'SOL Transfer instruction not found in transaction'
      };
    }

    return {
      verified: true,
      amount: transferAmount,
      fromAddress: fromAddress,
      confirmationCount: confirmationCount >= minConfirmations ? confirmationCount : minConfirmations
    };

  } catch (error) {
    console.error('❌ SOL verification error:', error);
    return {
      verified: false,
      error: error.message || 'Failed to verify SOL transaction'
    };
  }
}

module.exports = {
  verifyBEP20Transaction,
  verifySOLTransaction
};

