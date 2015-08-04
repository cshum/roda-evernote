var rodabase = require('rodabase'),
    evernote = require('../'),
    express  = require('express'),
    rest     = require('roda-rest');

var roda = rodabase('./db');
var blobs = require('fs-blob-store')('./blobs');
var ever = evernote(roda('evernote'), { blobs: blobs });

var app = express();
app.get('/api/sync/:token', function(req, res){
  ever.sync(req.params.token, function(err, state){
    res.redirect('/api/evernote');
  });
});
app.use('/api', rest(roda)); //roda rest api
app.use('/blobs/:hash', function(req, res){
  blobs.createReadStream({
    key: req.params.hash
  }).pipe(res);
}); //roda rest api
app.listen(3000);
console.log('roda-evernote is listening on port '+ 3000);
