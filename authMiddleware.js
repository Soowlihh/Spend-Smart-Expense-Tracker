const Transaction = require('./models/Transaction');
const User = require('./models/user');
const jwt = require('jsonwebtoken');

module.exports.isLoggedInAPI = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), process.env.ACCESS_TOKEN_SECRET);
    if (!decoded || !/^[a-f\d]{24}$/i.test(decoded.userId)) throw new Error('Invalid user');
  } catch {
    return res.status(401).json({ ok: false, message: 'Invalid or expired token' });
  }
  try {
    const user = await User.findById(decoded.userId).select('tokenVersion').lean();
    if (!user || (decoded.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ ok: false, message: 'Your session has expired. Sign in again.' });
    }
    req.user = { _id: user._id };
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports.isOwner = async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ ok: false, message: 'Not Found' });
    if (!transaction.owner.equals(req.user._id)) {
      return res.status(403).json({ ok: false, message: 'Forbidden' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
