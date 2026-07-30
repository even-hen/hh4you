/**
 * YooKassa Payment Gateway Helper
 *
 * Wraps the YooKassa REST API v3:
 *   - createPayment(userId, userEmail) -> { paymentId, confirmationToken }
 *   - getPayment(paymentId)            -> raw YooKassa payment object
 *
 * Authentication: HTTP Basic Auth (shopId : secretKey)
 * Docs: https://yookassa.ru/developers/api
 */

const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const YOOKASSA_API_BASE = 'https://api.yookassa.ru/v3';

/**
 * Makes an authenticated request to the YooKassa API.
 */
async function apiCall(method, path, body, idempotencyKey) {
  const credentials = Buffer.from(
    `${config.yookassaShopId}:${config.yookassaSecretKey}`
  ).toString('base64');

  const headers = {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json',
  };

  if (idempotencyKey) {
    headers['Idempotence-Key'] = idempotencyKey;
  }

  const url = `${YOOKASSA_API_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = (data && (data.description || data.message)) || `YooKassa API error ${response.status}`;
    throw new Error(`YooKassa: ${errMsg}`);
  }

  return data;
}

/**
 * Creates a new payment in YooKassa using the Embedded Checkout Widget flow.
 *
 * @param {number} userId     Internal user ID (stored in payment metadata)
 * @param {string} userEmail  User email (for payment description)
 * @returns {{ paymentId: string, confirmationToken: string }}
 */
async function createPayment(userId, userEmail) {
  if (!config.yookassaShopId || !config.yookassaSecretKey) {
    throw new Error('YooKassa is not configured. Set YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY in .env');
  }

  const idempotencyKey = uuidv4();

  const payload = {
    amount: {
      value: config.yookassaAmount,
      currency: config.yookassaCurrency,
    },
    capture: true,
    confirmation: {
      type: 'embedded',
    },
    description: `Подписка HH4YOU на месяц — ${userEmail}`,
    metadata: {
      userId: String(userId),
      userEmail,
    },
  };

  console.log(`[YooKassa] Creating payment for user ${userId} (${userEmail}), amount: ${config.yookassaAmount} ${config.yookassaCurrency}`);
  const payment = await apiCall('POST', '/payments', payload, idempotencyKey);

  const confirmationToken = payment.confirmation && payment.confirmation.confirmation_token;
  if (!confirmationToken) {
    throw new Error('YooKassa did not return a confirmation_token. Check your shop ID and secret key.');
  }

  console.log(`[YooKassa] Payment created: ${payment.id}, status: ${payment.status}`);
  return {
    paymentId: payment.id,
    confirmationToken,
  };
}

/**
 * Fetches the current status of a payment from YooKassa.
 * Always re-fetch for webhook verification — never trust the webhook payload alone.
 *
 * @param {string} paymentId  YooKassa payment ID
 * @returns {object}  Full YooKassa payment object
 */
async function getPayment(paymentId) {
  return apiCall('GET', `/payments/${paymentId}`);
}

module.exports = { createPayment, getPayment };
