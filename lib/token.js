import { ethers } from "ethers";
import { queryOne, queryAll, execute } from "@/lib/db";

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function getConfig() {
  return {
    tokenAddress: (process.env.OPENWORK_TOKEN_ADDRESS || "").toLowerCase(),
    clinicWallet: (process.env.CLINIC_WALLET_ADDRESS || "").toLowerCase(),
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    healthCheckFee: process.env.HEALTH_CHECK_FEE || "1000",
    reportViewFee: process.env.REPORT_VIEW_FEE || "500",
    counselorSharePercent: parseInt(process.env.COUNSELOR_SHARE_PERCENT || "80", 10),
    minConfirmations: parseInt(process.env.MIN_BLOCK_CONFIRMATIONS || "5", 10),
  };
}

/**
 * Verify an on-chain $OPENWORK token payment.
 *
 * @param {string} txHash - Transaction hash
 * @param {string} purpose - "health_check" or "report_view"
 * @param {string|null} sessionId - Associated session ID
 * @param {string|null} agentId - Agent who paid
 * @returns {{ ok: boolean, error?: string, amount?: string, from?: string }}
 */
export async function verifyPayment(txHash, purpose, sessionId = null, agentId = null) {
  const config = getConfig();

  // Validate tx hash format
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, error: "无效的交易哈希格式" };
  }

  // Check replay — tx hash must not have been used before
  const existing = await queryOne("SELECT tx_hash FROM payments WHERE tx_hash = ?", [txHash.toLowerCase()]);
  if (existing) {
    return { ok: false, error: "该交易哈希已被使用" };
  }

  // Determine required amount based on purpose
  const requiredAmount = purpose === "health_check"
    ? config.healthCheckFee
    : purpose === "report_view"
      ? config.reportViewFee
      : null;

  if (!requiredAmount) {
    return { ok: false, error: "未知的付款用途" };
  }

  // Fetch transaction receipt from Base RPC
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(config.rpcUrl, 8453);
  } catch (err) {
    return { ok: false, error: "无法连接到 Base 网络" };
  }

  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (err) {
    return { ok: false, error: "无法获取交易回执" };
  }

  if (!receipt) {
    return { ok: false, error: "交易不存在或尚未被打包" };
  }

  // Verify transaction was successful
  if (receipt.status !== 1) {
    return { ok: false, error: "交易执行失败" };
  }

  // Verify the transaction was sent to the $OPENWORK token contract
  if (receipt.to?.toLowerCase() !== config.tokenAddress) {
    return { ok: false, error: "交易目标不是 $OPENWORK 合约" };
  }

  // Check block confirmations
  let currentBlock;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (err) {
    return { ok: false, error: "无法获取当前区块高度" };
  }

  const confirmations = currentBlock - receipt.blockNumber;
  if (confirmations < config.minConfirmations) {
    return { ok: false, error: `交易确认数不足（当前 ${confirmations}，需要 ${config.minConfirmations}）` };
  }

  // Find the ERC-20 Transfer event log that sends to the clinic wallet
  // Transfer(address from, address to, uint256 value)
  let transferFound = false;
  let transferAmount = BigInt(0);
  let fromAddress = "";

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === config.tokenAddress &&
      log.topics[0] === ERC20_TRANSFER_TOPIC &&
      log.topics.length === 3
    ) {
      const to = "0x" + log.topics[2].slice(26).toLowerCase();
      if (to === config.clinicWallet) {
        const from = "0x" + log.topics[1].slice(26).toLowerCase();
        const value = BigInt(log.data);
        transferAmount = value;
        fromAddress = from;
        transferFound = true;
        break;
      }
    }
  }

  if (!transferFound) {
    return { ok: false, error: "未找到向诊所钱包的 $OPENWORK 转账记录" };
  }

  // $OPENWORK is ERC-20 with 18 decimals
  const requiredWei = ethers.parseUnits(requiredAmount, 18);
  if (transferAmount < requiredWei) {
    const actual = ethers.formatUnits(transferAmount, 18);
    return { ok: false, error: `转账金额不足（实际 ${actual}，需要 ${requiredAmount} $OPENWORK）` };
  }

  const amountFormatted = ethers.formatUnits(transferAmount, 18);

  // Record payment in database
  await execute(
    `INSERT INTO payments (tx_hash, from_address, to_address, token_address, amount, purpose, session_id, agent_id, block_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      txHash.toLowerCase(),
      fromAddress,
      config.clinicWallet,
      config.tokenAddress,
      amountFormatted,
      purpose,
      sessionId,
      agentId,
      receipt.blockNumber,
    ]
  );

  return { ok: true, amount: amountFormatted, from: fromAddress };
}

/**
 * Return public pricing information.
 */
export function getPricing() {
  const config = getConfig();
  return {
    health_check_fee: "0",
    health_check_fee_note: "体检免费",
    report_view_fee: config.reportViewFee,
    token: {
      name: "$OPENWORK",
      address: config.tokenAddress,
      chain: "Base",
      chain_id: 8453,
      decimals: 18,
    },
    clinic_wallet: config.clinicWallet,
    counselor_share_percent: config.counselorSharePercent,
    platform_share_percent: 100 - config.counselorSharePercent,
    basescan_url: `https://basescan.org/token/${config.tokenAddress}`,
  };
}

/**
 * Get revenue statistics from the payments table.
 */
export async function getRevenueStats() {
  const config = getConfig();

  const totalRow = await queryOne(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM payments"
  );

  const total = parseFloat(totalRow?.total || 0);
  const count = parseInt(totalRow?.count || 0, 10);
  const counselorShare = total * (config.counselorSharePercent / 100);
  const platformShare = total - counselorShare;

  const byPurpose = await queryAll(
    "SELECT purpose, COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM payments GROUP BY purpose"
  );

  return {
    total_revenue: total.toString(),
    counselor_share: counselorShare.toString(),
    platform_share: platformShare.toString(),
    transaction_count: count,
    by_purpose: byPurpose.reduce((acc, row) => {
      acc[row.purpose] = { total: parseFloat(row.total).toString(), count: parseInt(row.count, 10) };
      return acc;
    }, {}),
  };
}
