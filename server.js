// compile sass
var fs = require('fs');
var sass = require('node-sass');
var sassstats = {};

sass.render({
    file: './public/css/omni.scss',
    success: function (css) {
        fs.writeFile('./public/omni.css', css, function (err) {
            if (err) {
                console.log(err)
            } else {
                console.log('SCSS saved');
            }
        })
        // console.log(css);
        console.log(sassstats);
    },
    stats: sassstats
});

var http     = require('http');
var express  = require('express');
var app      = express();
var port     = process.env.PORT || 8888;
var mongoose = require('mongoose');
var passport = require('passport');
var flash    = require('connect-flash');

// sockets
var io = require('socket.io');
var socketio_jwt = require('socketio-jwt');
var jwt = require('jsonwebtoken');
var jwt_secret = 'foo bar big secret';

// express 4 dependencies
var morgan       = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser   = require('body-parser');
var session      = require('express-session');

// database
var configDB = require('./config/database.js');
mongoose.connect(configDB.url);

require('./config/passport')(passport);

app.set('views', __dirname + "/views");
app.set('view engine', 'ejs');
app.use(express.static(__dirname + "/public"));
app.use(morgan('dev'));
app.use(cookieParser());
app.use(bodyParser());
app.use(session({ secret: 'letsgorobben'}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

require('./app/routes.js')(app, passport);

var server = http.createServer(app);

server.listen(port, function () {
    console.log('The magic happens on port ' + port);
});

// socket
var sio = io.listen(server);

sio.use(socketio_jwt.authorize({
    secret: jwt_secret,
    handshake: true
}));




// usernames -> ChessPlayer
var clients = {};
var chess = require('./app/chess.js');


function similarStuff(player) {
    registerChessEventsForPlayer(player);
    player.get_reconnection_info(function (info) {
        player.socket.emit('reconnection_info', info);
    });
};

sio.sockets.on('connection', function (socket) {
    console.log('connection', socket.decoded_token.local.username);
    if (clients[socket.decoded_token.local.username]) {
        var player = clients[socket.decoded_token.local.username];
        console.log('disconnecting old socket for', player.username);
        // player.socket.emit('newsocket'); // TODO, not used yet
        player.socket.disconnect();
        player.socket = socket;

        similarStuff(player);
    } else { // new client
        var player = new chess.Player(socket, function (user) {
            if (user) {
                similarStuff(player);
                sio.sockets.emit('clients', Object.keys(clients));
            } else {
                // TODO: how can this happen? We already logged in? (Disconnect and log it?)
            }
        });

        clients[player.username] = player; 
    }
});

function registerChessEventsForPlayer(player) {
    player.socket.on('disconnect', function () {
        // TODO we should wait a little while for a potential reconnect
        console.log(player.username, 'disconnected');

        // TODO, don't do this now because they could reconnect. Wait 30 seconds?
        // probably tell the opponent to wait for client.
        if (player.game) {
            player.game.opponent.socket.emit('opponentlostconnection');

            var playerStillNotBack = false;
            if (playerStillNotBack) {
                opponent.socket.emit('end', {agree: true, result: true});
            }
        }
    });

    player.socket.on('reconnect', function () {
        player.get_reconnection_info(function (info) {
            player.socket.emit('reconnection_info', info);
        });
    });

    player.socket.on('message', function (msg) {
        console.log('message', msg);
        player.socket.broadcast.emit('message', msg);
    });

    player.socket.on('ready', function () {
        console.log('ready');
        chess.GameManager.ready(player, function () { // callback for acknowledge ready, only called if we don't start game
            player.socket.emit('ready');
        },
        function (white, black) { // callback for starting game
            white.socket.emit('start', { white: true, opponent: black.username, time: white.game.time() });
            black.socket.emit('start', { white: false, opponent: white.username, time: black.game.time() });
        });
    });

    player.socket.on('move', function (json) {
        player.move(json, function (opponent) { // only called if move succeeds
            console.log("sending move from " + player.username + " to " + opponent.username);
            json['time'] = opponent.game.time(); // TODO, don't like this
            // console.log('time', opponent.game.time(), player.game.time());
            opponent.socket.emit('move', json); // TODO, better way to forward?
        });
    });

    player.socket.on('end', function (json) {
        console.log('end', player.username, json);
        player.game.setResultClaim(json.result); // TODO, move and clean this

        player.game.check_for_agreement(function (agreement, change) {
            console.log("agreement", agreement);
            var opponent = player.game.opponent;
            player.socket.emit('end', {agree: agreement, result: player.game.resultClaim(), elochange: change});
            opponent.socket.emit('end', {agree: agreement, result: opponent.game.resultClaim(), elochange: -change});
        },
        function (player) { // save callback
            player.socket.emit('stats', player.user.chess);
        });
    });
};
