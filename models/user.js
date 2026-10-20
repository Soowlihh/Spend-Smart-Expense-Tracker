const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new Schema ({
    email: {
        type : String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    tokenVersion: { type: Number, default: 0 },
    resetTokenHash: { type: String, select: false },
    resetTokenExpiresAt: { type: Date, select: false }
});
UserSchema.plugin(passportLocalMongoose.default);

module.exports = mongoose.model('User', UserSchema);
