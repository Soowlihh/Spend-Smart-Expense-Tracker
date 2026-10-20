const rateLimit = require("express-rate-limit");
const { createHash } = require('node:crypto');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    handler: (req,res) => {
        res.status(429).json({
            ok:false,
            message:"Too many login attempts try again later"
        });
    }
});


const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    handler: (req,res) => {
        res.status(429).json({
            ok:false,
            message:"Too many registration attempts, try again later"
        });
    }
});


const transactionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    handler: (req,res) => {
        res.status(429).json({
            ok:false,
            message:"Too many requests, try again later"
        });
    }
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    handler: (_req, res) => res.status(429).json({
        ok: false, message: 'Too many reset requests. Try again in 15 minutes.'
    })
});

const forgotPasswordEmailLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1,
    keyGenerator: (req) => createHash('sha256').update(req.body.email).digest('hex'),
    handler: (_req, res) => res.status(202).json({
        ok: true, message: 'If an account matches that email, a reset link will be sent.'
    })
});

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    handler: (_req, res) => res.status(429).json({
        ok: false, message: 'Too many reset attempts. Try again in 15 minutes.'
    })
});

module.exports = {
    loginLimiter, registerLimiter, transactionLimiter,
    forgotPasswordLimiter, forgotPasswordEmailLimiter, resetPasswordLimiter
};
