(function (window) {
    "use strict";

    function ChessClock(time, callback) {
        this.white = { time: time }
        this.black = { time: time }

        this.currentTurn = this.white;

        this.callback = callback;
    };

    ChessClock.prototype.start = function() {
        if (this.interval) {
            return;
        }

        this.lastUpdateTime = Date.now();

        var self = this;
        this.interval = setInterval(function () {
            self.update(self.currentTurn); // self.update.call(self); // why would I need that?
        }, 100);
    };

    function seconds(ms) {
        return Math.floor(ms/1000);
    }

    function minutesSeconds(ms) {
        var sec = seconds(ms);
        return {
            minutes: Math.floor(sec / 60),
            seconds: sec % 60
        }
    }

    ChessClock.prototype.update = function () {
        var now = Date.now();
        var timeSpent = now - this.lastUpdateTime;
        this.lastUpdateTime = now;
        this.currentTurn.time -= timeSpent;

        if (seconds(this.currentTurn.time) < seconds(this.currentTurn.time + timeSpent)) {
            if (this.currentTurn.time < 0) {
                this.stop();
            }
            this.callback(minutesSeconds(this.white.time), minutesSeconds(this.black.time));
        }
    };

    ChessClock.prototype.switch = function (time) {
        this.stop();
        this.currentTurn = (this.currentTurn == this.white) ? this.black : this.white;
        if (time) {
            this.currentTurn.time = time;
        }
        this.start();
    }

    ChessClock.prototype.stop = function () {
        clearInterval(this.interval);
        this.interval = null;
        this.update();
    };

    window.ChessClock = ChessClock;
}(window));
