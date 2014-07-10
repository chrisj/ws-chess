var jwt = require('jsonwebtoken');
var jwt_secret = 'foo bar big secret';

var util = require('util');

module.exports = function (app, passport) {
    app.get('/', function (req, res) {
        res.render('index.ejs');
        if (req.user) {
            console.log("user", req.user.local.username);
        } else {
            console.log("no user");
        }
    });

    app.post('/login', function (req, res) {
        // console.log("request " + util.inspect(req) + " response:" + util.inspect(res));
        passport.authenticate('local-login', function (err, user, info) {
            console.log("hello" + err + user + info)
            if (err || !user) {
                res.json({token: false});
            } else {
                res.json({token: getTokenForUser(user)});
            }
        })(req, res);
    });

    app.post('/signup', function (req, res) {
        // console.log("request " + util.inspect(req) + " response:" + util.inspect(res));
        passport.authenticate('local-signup', function (err, user, info) {
            console.log("hello" + err + user + info)
            if (err || !user) {
                res.json({token: false});
            } else {
                res.json({token: getTokenForUser(user)});
            }
        })(req, res);
    });

    function getTokenForUser (user) {
        return jwt.sign(user, jwt_secret, { expiresInMinutes: 60*5 });
    }

    // app.post('/checkifsignedin', function (req, res) {
    //     console.log("user", req.user);
    //     if (req.user) {
    //         res.json({token: getTokenForUser(req.user)});
    //     } else {
    //         res.json({token: false});
    //     }
    // });

    // app.get('/logout', function(req, res) {
    //     req.logout();
    //     res.redirect('/');
    // });
}

// function isLoggedIn(req, res, next) {
//     if (req.isAuthenticated()) {
//         return next();
//     }

//     res.redirect('/');
// }