var rodabase = require('rodabase'),
    evernote = require('./'),
    express  = require('express'),
    rest     = require('roda-rest');

var roda = rodabase('./db');
var ever = evernote(roda, 'evernote');

var app = express();
app.get('/api/sync/:token', function(req, res){
  ever.sync(req.params.token, function(err, state){
    console.log(err, state);
    res.redirect('/api/evernote?index=notes&reverse=true');
  });
});
app.use('/api', rest(roda)); //roda rest api
app.listen(3000);
console.log('roda-evernote is listening on port '+ 3000);
