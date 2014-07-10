var mongoose = require('mongoose');
var bcrypt  = require('bcrypt-nodejs');

var userScheme = mongoose.Schema({
    local           : {
        username    : String,
        password    : String,
    },
    // currentSocket : String,
    chess: {
        wins : { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        ties: { type: Number, default: 0 },
        elo: { type: Number, default: 1000 }
    }
});

userScheme.methods.generateHash = function (password) {
    return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
}

userScheme.methods.validPassword = function (password) {
    return bcrypt.compareSync(password, this.local.password);
}

module.exports = mongoose.model('User', userScheme);