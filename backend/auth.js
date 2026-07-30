const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { dbQuery } = require('./db');

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hashed_password) {
  try {
    return bcrypt.compareSync(password, hashed_password);
  } catch (e) {
    return false;
  }
}

function generateToken(email) {
  return jwt.sign({ sub: email }, config.secretKey, {
    expiresIn: `${config.tokenExpireMinutes}m`
  });
}

// Guest token: 48-hour expiry, same signing key
function generateGuestToken(guestEmail) {
  return jwt.sign({ sub: guestEmail, is_guest: true }, config.secretKey, {
    expiresIn: '48h'
  });
}

async function authenticateToken(req, res, next) {
  // 1. Try header
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Try cookie
  if (!token && req.cookies) {
    token = req.cookies['access_token'];
  }

  if (!token) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, config.secretKey);
    const email = payload.sub;

    const user = await dbQuery.get(
      'SELECT id, email, created_at, subscription_ends_at, notified_sub_end, is_guest, guest_expires_at, is_trial FROM users WHERE email = ?',
      [email]
    );
    if (!user) {
      return res.status(401).json({ detail: 'User not found' });
    }

    // Active: subscription not expired (guests use subscription_ends_at = now+48h)
    user.isActive = () => {
      const now = Date.now();
      if (user.subscription_ends_at && new Date(user.subscription_ends_at).getTime() > now) return true;
      return false;
    };

    user.is_guest = !!user.is_guest;
    user.is_trial = !!user.is_trial;
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ detail: 'Invalid or expired credentials' });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  generateGuestToken,
  authenticateToken
};
